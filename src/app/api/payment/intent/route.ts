import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { validateSession } from '@/lib/security/session';
import { validateOrigin } from '@/lib/security/origin';

export async function POST(req: Request) {
  try {
    const originCheck = validateOrigin(req);
    if (!originCheck.valid) {
      return NextResponse.json(
        { error: 'درخواست نامعتبر از مبدأ غیرمجاز شناسایی شد.' },
        { status: 403 }
      );
    }

    const auth = await validateSession(req);
    if (!auth.valid || !auth.userId) {
      const response = NextResponse.json(
        { error: 'نشست کاربری شما منقضی شده است. لطفاً دوباره وارد شوید.' },
        { status: auth.status || 401 }
      );
      if (auth.shouldDeleteLegacy) {
        response.cookies.set('token', '', { path: '/', maxAge: 0 });
      }
      return response;
    }

    const user = await prisma.user.findUnique({ where: { id: auth.userId } });

    if (!user) {
      return NextResponse.json({ error: 'کاربر یافت نشد' }, { status: 404 });
    }

    const now = new Date();

    // 1. Lazy-expire past unhandled PENDING intents across database
    await prisma.paymentIntent.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        expiredAt: now,
      },
    });

    // 2. Enforce exactly one active PENDING intent per user
    const existingActiveIntent = await prisma.paymentIntent.findFirst({
      where: {
        userId: user.id,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
    });

    if (existingActiveIntent) {
      return NextResponse.json({
        success: true,
        data: {
          intentId: existingActiveIntent.id,
          totalAmount: existingActiveIntent.totalAmount,
          uniqueCode: existingActiveIntent.uniqueCode,
          expiresAt: existingActiveIntent.expiresAt,
        },
      });
    }

    // 3. Compute locked uniqueCodes based on C3 Quarantine Policy:
    // - PENDING intents (currently active)
    // - EXPIRED intents within 30-minute quarantine (COALESCE(expiredAt, expiresAt) > NOW - 30m)
    // - PAID intents within 24-hour quarantine (confirmedAt > NOW - 24h)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const lockedIntents = await prisma.paymentIntent.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          {
            status: 'EXPIRED',
            OR: [
              { expiredAt: { gt: thirtyMinutesAgo } },
              { expiredAt: null, expiresAt: { gt: thirtyMinutesAgo } },
            ],
          },
          {
            status: 'PAID',
            confirmedAt: { gt: twentyFourHoursAgo },
          },
        ],
      },
      select: { uniqueCode: true },
    });

    const lockedCodes = new Set(lockedIntents.map((i) => i.uniqueCode));
    const availableCandidates: number[] = [];
    for (let c = 1; c <= 999; c++) {
      if (!lockedCodes.has(c)) {
        availableCandidates.push(c);
      }
    }

    if (availableCandidates.length === 0) {
      // Pool capacity exhausted (all 999 codes active or quarantined)
      return NextResponse.json(
        { error: 'ظرفیت پرداخت این ساعت تکمیل است. لطفاً دقایقی دیگر مجدداً تلاش فرمایید.' },
        { status: 503 }
      );
    }

    // 4. Concurrency-safe allocation with max 3 attempts
    let intent;
    let attempts = 0;
    const maxAttempts = Math.min(3, availableCandidates.length);

    while (attempts < maxAttempts) {
      attempts++;
      const randomIndex = Math.floor(Math.random() * availableCandidates.length);
      const candidateCode = availableCandidates[randomIndex];
      availableCandidates.splice(randomIndex, 1);

      try {
        intent = await prisma.paymentIntent.create({
          data: {
            userId: user.id,
            amount: 299000,
            uniqueCode: candidateCode,
            totalAmount: 299000 + candidateCode,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins window
          },
        });
        break; // Successfully reserved
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Parallel collision on PaymentIntent_uniqueCode_pending_key; try next candidate
          continue;
        }
        throw err;
      }
    }

    if (!intent) {
      return NextResponse.json(
        { error: 'ظرفیت پرداخت این ساعت تکمیل است. لطفاً دقایقی دیگر مجدداً تلاش فرمایید.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        intentId: intent.id,
        totalAmount: intent.totalAmount,
        uniqueCode: intent.uniqueCode,
        expiresAt: intent.expiresAt,
      },
    });
  } catch (error) {
    console.error('Error in /api/payment/intent:', error);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
