import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { smsService } from '@/lib/sms';
import { normalizeIranianPhone, maskPhone } from '@/lib/sms/phone';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawPhone = body?.phone;

    // 1. Canonical phone normalization (handles Persian/Arabic digits, +98, spaces)
    const normalizedPhone = normalizeIranianPhone(rawPhone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'شماره موبایل وارد شده معتبر نیست. لطفاً شماره ۱۱ رقمی با ۰۹ وارد کنید.' },
        { status: 400 }
      );
    }

    const masked = maskPhone(normalizedPhone);

    // 2. Rate limiting: enforce 60-second cooldown per phone number
    const recentOtp = await prisma.oTPVerification.findFirst({
      where: {
        phone: normalizedPhone,
        createdAt: { gt: new Date(Date.now() - 60 * 1000) },
      },
    });

    if (recentOtp) {
      return NextResponse.json(
        { error: 'کد قبلی به تازگی ارسال شده است. لطفاً یک دقیقه صبر کنید.' },
        { status: 429 }
      );
    }

    // 3. Cryptographically secure 5-digit OTP generation (10000 - 99999)
    const otp = crypto.randomInt(10000, 100000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const codeHash = await bcrypt.hash(otp, 10);

    // 4. Invalidate prior unverified challenges to prevent multiple active codes
    await prisma.oTPVerification.updateMany({
      where: { phone: normalizedPhone, verified: false },
      data: { verified: true },
    });

    // 5. Persist hashed OTP challenge
    const challenge = await prisma.oTPVerification.create({
      data: {
        phone: normalizedPhone,
        codeHash,
        expiresAt: otpExpiry,
      },
    });

    // 6. Deliver via SMS provider (BaseServiceNumber)
    const sendResult = await smsService.sendOtp({
      phone: normalizedPhone,
      code: otp,
    });

    if (!sendResult.success) {
      // Invalidate the challenge if SMS dispatch failed
      await prisma.oTPVerification.update({
        where: { id: challenge.id },
        data: { verified: true },
      });

      console.error(`[OTP_DISPATCH_FAILED] Could not send OTP to ${masked}: ${sendResult.error}`);
      return NextResponse.json(
        { error: sendResult.userMessage || 'ارسال کد با مشکل مواجه شد. لطفاً چند لحظه بعد دوباره امتحان کنید.' },
        { status: 502 }
      );
    }

    console.log(`[OTP_CHALLENGE_CREATED] Active challenge initiated for ${masked}`);
    return NextResponse.json({
      success: true,
      message: 'کد تایید ارسال شد.',
      maskedPhone: masked,
    });
  } catch (error) {
    console.error('Error in /api/waitlist/register:', error);
    return NextResponse.json({ error: 'خطای سرور. لطفاً دوباره تلاش کنید.' }, { status: 500 });
  }
}

