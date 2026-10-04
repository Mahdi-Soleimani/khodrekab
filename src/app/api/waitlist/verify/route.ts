import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { normalizeIranianPhone, convertDigitsToEnglish, maskPhone } from '@/lib/sms/phone';
import { computeOtpHash, verifyOtpTimingSafe, checkOtpLockout, recordOtpFailure, clearOtpFailure } from '@/lib/security/otp';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

export async function POST(req: Request) {
  try {
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

    // 6. Handle Valid Code: clear failure counters & mark challenge verified
    await clearOtpFailure(normalizedPhone);

    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { verified: true, attempts: { increment: 1 } },
    });

    // 7. Account and Waitlist registration under atomic state
    let user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: normalizedPhone,
          phoneVerified: true,
        },
      });
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

        if (inviterEntry && inviterEntry.userId !== user.id) {
          inviterId = inviterEntry.userId;

          // Increment inviter priority score by 50
          await prisma.waitlistEntry.update({
            where: { id: inviterEntry.id },
            data: { priorityScore: { increment: 50 } },
          });

          await prisma.referral
            .create({
              data: {
                inviterId,
                invitedUserId: user.id,
                status: 'CONVERTED',
              },
            })
            .catch(() => {
              // Ignore duplicate referral record errors gracefully
            });
        }
      }

      waitlistEntry = await prisma.waitlistEntry.create({
        data: {
          userId: user.id,
          referralCode: nanoid(8),
          referredBy: inviterId,
          source: source || 'direct',
        },
      });
    }

    // 8. Sign secure JWT session token
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, {
      expiresIn: '7d',
    });

    console.log(`[AUTH_SUCCESS] OTP verified for ${masked}`);

    const response = NextResponse.json({
      success: true,
      message: 'تایید موفقیت‌آمیز',
    });

    // 9. Attach secure httpOnly cookie
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
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
