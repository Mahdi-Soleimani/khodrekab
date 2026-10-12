import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { normalizeIranianPhone, maskPhone } from '@/lib/sms/phone';
import { resolveClientIp } from '@/lib/security/ip';
import { checkSmsRateLimits } from '@/lib/security/limiter';
import { verifyPoWSolution, validateHoneypotAndTiming } from '@/lib/security/pow';
import { computeOtpHash } from '@/lib/security/otp';
import { enqueueSmsDispatch } from '@/lib/security/queue';
import { validateOrigin } from '@/lib/security/origin';

export async function POST(req: Request) {
  try {
    // 0. Origin validation
    const originCheck = validateOrigin(req);
    if (!originCheck.valid) {
      return NextResponse.json(
        { error: 'درخواست نامعتبر از مبدأ غیرمجاز شناسایی شد.' },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { phone: rawPhone, pow, _hp, fillTimeMs } = body;

    // 1. Bot Challenge & Honeypot Validation
    const honeypotCheck = validateHoneypotAndTiming({ _hp, fillTimeMs });
    if (!honeypotCheck.valid) {
      return NextResponse.json(
        { error: honeypotCheck.reason || 'اعتبارسنجی امنیتی با خطا مواجه شد.' },
        { status: 400 }
      );
    }

    // In production, PoW solution is strictly required
    if (process.env.NODE_ENV === 'production' || pow) {
      const powCheck = verifyPoWSolution(pow);
      if (!powCheck.valid) {
        return NextResponse.json(
          { error: powCheck.reason || 'اعتبارسنجی امنیتی با خطا مواجه شد. لطفاً صفحه را بازنگری کنید.' },
          { status: 400 }
        );
      }
    }

    // 2. Canonical phone normalization (handles Persian/Arabic digits, +98, spaces)
    const normalizedPhone = normalizeIranianPhone(rawPhone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { error: 'شماره موبایل وارد شده معتبر نیست. لطفاً شماره ۱۱ رقمی با ۰۹ وارد کنید.' },
        { status: 400 }
      );
    }

    const masked = maskPhone(normalizedPhone);

    // 3. Trusted IP Resolution (A3)
    const clientIp = resolveClientIp(req);

    // 4. Rate Limiting Check (Multi-key atomic sliding window / Kill switch)
    const limitResult = await checkSmsRateLimits({
      phone: normalizedPhone,
      clientIp,
    });

    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: limitResult.userMessage },
        { status: limitResult.statusCode || 429 }
      );
    }

    // 5. Generate cryptographically secure 5-digit OTP (10000 - 99999)
    const otp = crypto.randomInt(10000, 100000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // 6. Invalidate prior unverified challenges (expire them immediately, strictly keep verified = false)
    await prisma.oTPVerification.updateMany({
      where: { phone: normalizedPhone, verified: false },
      data: { expiresAt: new Date(0) },
    });

    // 7. Persist challenge with HMAC-SHA256 (D5 / B.2)
    // Create first to get unique challenge ID
    const placeholderHash = 'PENDING_CREATION';
    const challenge = await prisma.oTPVerification.create({
      data: {
        phone: normalizedPhone,
        codeHash: placeholderHash,
        expiresAt: otpExpiry,
        pepperVersion: 1,
      },
    });

    const finalHmac = computeOtpHash(normalizedPhone, challenge.id, otp);
    await prisma.oTPVerification.update({
      where: { id: challenge.id },
      data: { codeHash: finalHmac },
    });

    // 8. Enqueue SMS dispatch via Redis Queue (Asynchronous & Fail-Closed in Prod)
    try {
      await enqueueSmsDispatch({
        phone: normalizedPhone,
        code: otp,
        challengeId: challenge.id,
      });
    } catch (queueErr) {
      // Invalidate the challenge if queue dispatch failed: immediately expire it while verified = false
      await prisma.oTPVerification.update({
        where: { id: challenge.id },
        data: {
          expiresAt: new Date(),
          verified: false,
        },
      });

      console.error(`[OTP_QUEUE_FAILED] Could not enqueue OTP for ${masked}:`, queueErr);
      return NextResponse.json(
        { error: 'سرویس ارسال پیامک موقتاً جهت بهینه‌سازی در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید.' },
        { status: 503 }
      );
    }

    console.log(`[OTP_CHALLENGE_CREATED] Active challenge initiated for ${masked}`);

    // 9. Return Uniform Neutral Response (Amendment 1)
    return NextResponse.json({
      success: true,
      message: 'اگر شماره درست باشد، کد ارسال می‌شود.',
      maskedPhone: masked,
      cooldownSeconds: limitResult.cooldownSeconds || 60,
    });
  } catch (error) {
    console.error('Error in /api/waitlist/register:', error);
    return NextResponse.json(
      { error: 'سرویس ثبت‌نام و ارسال پیامک موقتاً در دسترس نیست. لطفاً دقایقی دیگر تلاش کنید.' },
      { status: 503 }
    );
  }
}
