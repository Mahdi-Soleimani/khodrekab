import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { normalizeIranianPhone, convertDigitsToEnglish, maskPhone } from '@/lib/sms/phone';

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

    // 1. Find the latest active unverified challenge
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

    // 2. Enforce maximum 3 attempts
    if (otpRecord.attempts >= 3) {
      return NextResponse.json(
        { error: 'تعداد دفعات مجاز وارد کردن کد به پایان رسیده است. لطفاً کد جدید دریافت کنید.' },
        { status: 429 }
      );
    }

    // 3. Constant-time bcrypt comparison
    const isValid = await bcrypt.compare(cleanOtp, otpRecord.codeHash);
    if (!isValid) {
      await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json({ error: 'کد تایید اشتباه است.' }, { status: 400 });
    }

    // 4. Mark challenge as verified immediately to prevent replay
    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { verified: true, attempts: { increment: 1 } },
    });

    // 5. Account and Waitlist registration under atomic state
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

    // 6. Sign secure JWT session token
    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, {
      expiresIn: '7d',
    });

    console.log(`[AUTH_SUCCESS] OTP verified for ${masked}`);

    const response = NextResponse.json({
      success: true,
      message: 'تایید موفقیت‌آمیز',
    });

    // 7. Attach secure httpOnly cookie
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
    return NextResponse.json({ error: 'خطای سرور در تایید کد.' }, { status: 500 });
  }
}

