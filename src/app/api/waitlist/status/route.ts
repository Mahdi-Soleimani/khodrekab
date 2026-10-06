import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/security/session';
import { checkStatusRateLimit } from '@/lib/security/limiter';
import { maskPhone } from '@/lib/sms/phone';

export async function GET(req: Request) {
  try {
    // 1. Authenticate user from session (HS256 stateful session)
    // CRITICAL: Unauthenticated requests get 401 BEFORE touching Redis!
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

    // 2. Redis Rate Limiting (60 req/min per userId, 503 if Redis fails)
    const rateLimit = await checkStatusRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: rateLimit.error || 'تعداد درخواست‌ها بیش از حد مجاز است.' },
        { status: rateLimit.status || 429 }
      );
    }

    // 3. Retrieve user and waitlist entry
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        waitlistEntry: true,
        _count: { select: { referralsSent: true } },
      },
    });

    if (!user || !user.waitlistEntry) {
      return NextResponse.json({ error: 'کاربر یا لیست انتظار یافت نشد' }, { status: 404 });
    }

    // 4. Lazy-on-read maturity settlement for current user's referrals
    try {
      const maturedReferrals = await prisma.referral.findMany({
        where: {
          inviterId: user.id,
          isMatured: false,
          isFlagged: false,
          maturesAt: { lte: new Date() },
        },
        select: { id: true },
      });

      if (maturedReferrals.length > 0) {
        const scoreToAdd = maturedReferrals.length * 50;
        const referralIds = maturedReferrals.map((r) => r.id);

        // Ensure pendingScore never goes negative (Amendment 4)
        const currentPending = user.waitlistEntry.pendingScore || 0;
        const pendingDecrement = Math.min(currentPending, scoreToAdd);

        await prisma.$transaction([
          prisma.referral.updateMany({
            where: { id: { in: referralIds } },
            data: { isMatured: true },
          }),
          prisma.waitlistEntry.update({
            where: { userId: user.id },
            data: {
              priorityScore: { increment: scoreToAdd },
              pendingScore: { decrement: pendingDecrement },
            },
          }),
        ]);

        user.waitlistEntry.priorityScore += scoreToAdd;
        user.waitlistEntry.pendingScore = Math.max(0, currentPending - pendingDecrement);
      }
    } catch (settleErr: any) {
      if (settleErr.code === 'P2021' || settleErr.code === 'P2022') {
        return NextResponse.json(
          { error: 'سرویس موقتاً در دسترس نیست (مایگریشن دیتابیس در حال انجام است).' },
          { status: 503 }
        );
      }
      console.warn(`[LAZY_MATURITY_WARN] Could not settle referrals for user ${user.id}:`, settleErr.message);
    }

    // 5. Rank query based on priorityScore (descending) and joinedAt (ascending)
    // Note: pendingScore is strictly isolated and excluded from rank calculation!
    const usersAhead = await prisma.waitlistEntry.count({
      where: {
        OR: [
          { priorityScore: { gt: user.waitlistEntry.priorityScore } },
          {
            priorityScore: user.waitlistEntry.priorityScore,
            joinedAt: { lt: user.waitlistEntry.joinedAt },
          },
        ],
      },
    });

    let currentRank = usersAhead + 1;

    if (user.status === 'EARLY_ACCESS') {
      currentRank = Math.min(currentRank, 1000);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        rank: currentRank,
        refCode: user.waitlistEntry.referralCode,
        referralCount: user._count.referralsSent,
        status: user.status,
        priorityScore: user.waitlistEntry.priorityScore,
        pendingScore: user.waitlistEntry.pendingScore,
        maskedPhone: maskPhone(user.phone),
      },
    });

    if (auth.shouldDeleteLegacy) {
      response.cookies.set('token', '', { path: '/', maxAge: 0 });
    }

    return response;
  } catch (error: any) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      return NextResponse.json(
        { error: 'سرویس موقتاً در دسترس نیست (مایگریشن دیتابیس در حال انجام است).' },
        { status: 503 }
      );
    }
    console.error('Error in /api/waitlist/status:', error);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
