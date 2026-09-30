import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('token')?.value;

    if (!token) {
      return NextResponse.json({ error: 'احراز هویت نشده است' }, { status: 401 });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: 'توکن نامعتبر است' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { 
        waitlistEntry: true,
        _count: { select: { referralsSent: true } } 
      },
    });

    if (!user || !user.waitlistEntry) {
      return NextResponse.json({ error: 'کاربر یا لیست انتظار یافت نشد' }, { status: 404 });
    }

    // Rank based on priority score (descending) and join date (ascending)
    const usersAhead = await prisma.waitlistEntry.count({
      where: {
        OR: [
          { priorityScore: { gt: user.waitlistEntry.priorityScore } },
          {
            priorityScore: user.waitlistEntry.priorityScore,
            joinedAt: { lt: user.waitlistEntry.joinedAt }
          }
        ]
      }
    });

    let currentRank = usersAhead + 1;

    if (user.status === 'EARLY_ACCESS') {
      currentRank = Math.min(currentRank, 1000); 
    }

    return NextResponse.json({
      success: true,
      data: {
        rank: currentRank,
        refCode: user.waitlistEntry.referralCode,
        referralCount: user._count.referralsSent,
        status: user.status,
      }
    });
  } catch (error) {
    console.error('Error in /api/waitlist/status:', error);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
