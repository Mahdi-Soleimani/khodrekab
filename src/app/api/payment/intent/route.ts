import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

    // Assign a unique code between 1 and 999 and ensure no collisions among PENDING intents
    let uniqueCode = Math.floor(Math.random() * 999) + 1;
    let intent;
    let retries = 0;

    while (retries < 10) {
      try {
        intent = await prisma.paymentIntent.create({
          data: {
            userId: user.id,
            amount: 299000,
            uniqueCode,
            totalAmount: 299000 + uniqueCode,
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins
          }
        });
        break; // Successfully created
      } catch (err: any) {
        if (err.code === 'P2002') {
          // Unique constraint failed, try another code
          uniqueCode = Math.floor(Math.random() * 999) + 1;
          retries++;
        } else {
          throw err;
        }
      }
    }

    if (!intent) {
      return NextResponse.json({ error: 'خطا در ایجاد کد یکتا. لطفا دوباره تلاش کنید' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        intentId: intent.id,
        totalAmount: intent.totalAmount,
        uniqueCode: intent.uniqueCode,
        expiresAt: intent.expiresAt,
      }
    });

  } catch (error) {
    console.error('Error in /api/payment/intent:', error);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
