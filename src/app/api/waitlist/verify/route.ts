import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { normalizeIranianPhone, convertDigitsToEnglish, maskPhone } from '@/lib/sms/phone';
import { computeOtpHash, verifyOtpTimingSafe, checkOtpLockout, recordOtpFailure, clearOtpFailure } from '@/lib/security/otp';
import { createSession } from '@/lib/security/session';
import { validateOrigin } from '@/lib/security/origin';
import { resolveClientIp } from '@/lib/security/ip';

export async function POST(req: Request) {
  try {
    // 0. Origin validation (CSRF defense)
    const originCheck = validateOrigin(req);
    if (!originCheck.valid) {
      return NextResponse.json(
        { error: 'درخواست نامعتبر از مبدأ غیرمجاز شناسایی شد.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { phone, otp, referredByCode, source } = body;

    const normalizedPhone = normalizeIranianPhone(phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'شماره موبایل نامعتبر است.' }, { status: 400 });
    }

    const cleanOtp = convertDigitsToEnglish(otp ? String(otp).trim() : '');
    if (!cleanOtp) {
      return NextResponse.json({ error: 'کد تایید وارد نشده است.' }, { status: 400 });
    }

    const masked = maskPhone(normalizedPhone);

    // 1. Check Cross-Challenge Failed-Attempt Lockout Counters (A1 b, c)
    // Fail-Closed: if counter store cannot be read or times out (>250ms), rejects with 503
    let lockoutState: { locked: boolean; remainingSeconds?: number };
    try {
      lockoutState = await checkOtpLockout(normalizedPhone);
    } catch (lockoutErr) {
      console.error(`[VERIFY_FAIL_CLOSED] Counter store check failed for ${masked}:`, lockoutErr);
      return NextResponse.json(
        { error: 'سرویس تأیید موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.' },
        { status: 503 }
      );
    }

    if (lockoutState.locked) {
      return NextResponse.json(
        { error: 'به دلیل تلاش‌های ناموفق مکرر، ورود برای ۳۰ دقیقه مسدود شد. لطفاً بعداً تلاش فرمایید.' },
        { status: 429 }
      );
    }

    // 2. Find the latest active unverified challenge
    const otpRecord = await prisma.oTPVerification.findFirst({
      where: {
        phone: normalizedPhone,
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      return NextResponse.json(
        { error: 'کد منقضی شده است یا یافت نشد. لطفاً کد جدید درخواست کنید.' },
        { status: 400 }
      );
    }

    // 3. Enforce maximum 3 attempts on single challenge
    if (otpRecord.attempts >= 3) {
      return NextResponse.json(
        { error: 'تعداد تلاش‌های مجاز برای این کد به پایان رسید. لطفاً کد جدید دریافت کنید.' },
        { status: 429 }
      );
    }

    // 4. Timing-safe comparison (HMAC-SHA256 with fallback for pre-existing bcrypt hashes)
    let isValid = false;
    if (otpRecord.codeHash.startsWith('$2')) {
      // Backward compatibility for pre-existing bcrypt challenges
      isValid = await bcrypt.compare(cleanOtp, otpRecord.codeHash);
    } else {
      const expectedHmac = computeOtpHash(normalizedPhone, otpRecord.id, cleanOtp);
      isValid = verifyOtpTimingSafe(expectedHmac, otpRecord.codeHash);
    }

    // 5. Handle Wrong Code: fail-closed on counter write failure (A1 b)
    if (!isValid) {
      await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });

      try {
        await recordOtpFailure(normalizedPhone);
      } catch (writeErr) {
        console.error(`[VERIFY_FAIL_CLOSED] Counter write failed for ${masked}:`, writeErr);
        return NextResponse.json(
          { error: 'سرویس تأیید موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.' },
          { status: 503 }
        );
      }

      return NextResponse.json({ error: 'کد تایید وارد شده اشتباه است.' }, { status: 400 });
    }

    // 6. Handle Valid Code: clear failure counters & mark challenge verified ATOMICALLY
    await clearOtpFailure(normalizedPhone);

    const updateResult = await prisma.oTPVerification.updateMany({
      where: {
        id: otpRecord.id,
        verified: false,
      },
      data: {
        verified: true,
        attempts: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      // Replay / parallel race detected: another concurrent request already marked this challenge verified
      return NextResponse.json(
        { error: 'این کد قبلاً استفاده شده است یا منقضی گردیده است.' },
        { status: 409 }
      );
    }

    // 7. Account and Waitlist registration under concurrency-safe state
    let user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    const isNewUser = !user;

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            phone: normalizedPhone,
            phoneVerified: true,
          },
        });
      } catch (userErr: unknown) {
        if (userErr instanceof Prisma.PrismaClientKnownRequestError && userErr.code === 'P2002') {
          // Concurrently created by a parallel request
          user = await prisma.user.findUniqueOrThrow({ where: { phone: normalizedPhone } });
        } else {
          throw userErr;
        }
      }
    } else if (!user.phoneVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { phoneVerified: true },
      });
    }

    let waitlistEntry = await prisma.waitlistEntry.findUnique({
      where: { userId: user.id },
    });

    if (!waitlistEntry) {
      let inviterId: string | null = null;

      if (referredByCode) {
        const inviterEntry = await prisma.waitlistEntry.findUnique({
          where: { referralCode: String(referredByCode).trim() },
        });

        // 1. Self-referral blocking: Inviter cannot be the invited user
        if (inviterEntry && inviterEntry.userId !== user.id) {
          inviterId = inviterEntry.userId;

          const clientIp = resolveClientIp(req);
          const clientIpHash = clientIp ? crypto.createHash('sha256').update(clientIp).digest('hex') : null;
          const userAgent = req.headers.get('user-agent');
          const clientDeviceHash = userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : null;

          // Check if inviter has active session or activity with the same ipHash in the last 1 hour
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
          const sameIpCluster = clientIpHash
            ? await prisma.session.findFirst({
                where: {
                  userId: inviterEntry.userId,
                  ipHash: clientIpHash,
                  createdAt: { gte: oneHourAgo },
                },
              })
            : null;

          // 2. Atomic Velocity Cap and Point Isolation (count CONVERTED in 24h + create in 1 transaction)
          try {
            await prisma.$transaction(async (tx) => {
              // Ensure user has not already been referred in a race condition
              const existingRef = await tx.referral.findUnique({
                where: { invitedUserId: user.id },
              });
              if (existingRef) {
                return;
              }

              const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
              const recentConvertedCount = await tx.referral.count({
                where: {
                  inviterId: inviterEntry.userId,
                  status: 'CONVERTED',
                  createdAt: { gte: twentyFourHoursAgo },
                },
              });

              if (sameIpCluster) {
                // IP cluster collision: Flagged, points held (pending review), no pendingScore increment
                await tx.referral.create({
                  data: {
                    inviterId: inviterEntry.userId,
                    invitedUserId: user.id,
                    status: 'CONVERTED',
                    isFlagged: true,
                    isMatured: false,
                    maturesAt: null,
                    ipHash: clientIpHash,
                    deviceHash: clientDeviceHash,
                  },
                });
              } else if (recentConvertedCount >= 20) {
                // Velocity cap exceeded (>=20/day): Flagged high volume, points held, no pendingScore increment
                await tx.referral.create({
                  data: {
                    inviterId: inviterEntry.userId,
                    invitedUserId: user.id,
                    status: 'FLAGGED_HIGH_VOLUME',
                    isFlagged: true,
                    isMatured: false,
                    maturesAt: null,
                    ipHash: clientIpHash,
                    deviceHash: clientDeviceHash,
                  },
                });
              } else {
                // Valid referral: 24h maturity, increment pendingScore (NOT priorityScore)
                await tx.waitlistEntry.update({
                  where: { id: inviterEntry.id },
                  data: { pendingScore: { increment: 50 } },
                });

                await tx.referral.create({
                  data: {
                    inviterId: inviterEntry.userId,
                    invitedUserId: user.id,
                    status: 'CONVERTED',
                    isFlagged: false,
                    isMatured: false,
                    maturesAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                    ipHash: clientIpHash,
                    deviceHash: clientDeviceHash,
                  },
                });
              }
            });
          } catch (refErr: unknown) {
            // P2002: unique constraint failed on invitedUserId (duplicate referral)
            const msg = refErr instanceof Error ? refErr.message : String(refErr);
            console.warn(`[REFERRAL_SKIP] Duplicate or concurrent referral attempt for user ${user.id}:`, msg);
          }
        }
      }

      // Concurrency-safe WaitlistEntry creation handling P2002 on userId or referralCode
      let created = false;
      let attempts = 0;
      while (!created && attempts < 5) {
        attempts++;
        const refCode = nanoid(8);
        try {
          waitlistEntry = await prisma.waitlistEntry.create({
            data: {
              userId: user.id,
              referralCode: refCode,
              referredBy: inviterId,
              source: source || 'direct',
            },
          });
          created = true;
        } catch (wlErr: unknown) {
          if (wlErr instanceof Prisma.PrismaClientKnownRequestError && wlErr.code === 'P2002') {
            const existingEntry = await prisma.waitlistEntry.findUnique({
              where: { userId: user.id },
            });
            if (existingEntry) {
              waitlistEntry = existingEntry;
              created = true;
              break;
            }
            // Unique collision on referralCode: retry loop generates fresh nanoid
          } else {
            throw wlErr;
          }
        }
      }
    }

    // 8. Create stateful session (2-hour lifetime, HS256)
    const sessionResult = await createSession(user.id, req);

    console.log(`[AUTH_SUCCESS] OTP verified for ${masked}`);

    const response = NextResponse.json({
      success: true,
      message: 'تایید موفقیت‌آمیز',
      isNewUser,
    });

    // 9. Attach secure session cookie
    response.cookies.set(sessionResult.cookieConfig.name, sessionResult.token, sessionResult.cookieConfig);
    response.cookies.set('token', sessionResult.token, {
      ...sessionResult.cookieConfig,
      name: 'token',
    });

    return response;
  } catch (error) {
    console.error('Error in /api/waitlist/verify:', error);
    return NextResponse.json(
      { error: 'سرویس تأیید موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.' },
      { status: 503 }
    );
  }
}
