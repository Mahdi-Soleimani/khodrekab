import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';

export async function POST(req: Request) {
  try {
    const { phone, otp, referredByCode, source } = await req.json();

    if (!phone || !otp) {
      return NextResponse.json({ error: 'اطلاعات ناقص است' }, { status: 400 });
    }

    const otpRecord = await prisma.oTPVerification.findFirst({
      where: { phone, verified: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' }
    });

    if (!otpRecord) {
      return NextResponse.json({ error: 'کد یافت نشد یا منقضی شده است' }, { status: 400 });
    }

    if (otpRecord.attempts >= 3) {
      return NextResponse.json({ error: 'تعداد دفعات مجاز به پایان رسیده است' }, { status: 429 });
    }

    const isValid = await bcrypt.compare(otp, otpRecord.codeHash);
    if (!isValid) {
      await prisma.oTPVerification.update({
        where: { id: otpRecord.id },
        data: { attempts: { increment: 1 } }
      });
      return NextResponse.json({ error: 'کد تایید اشتباه است' }, { status: 400 });
    }

    await prisma.oTPVerification.update({
      where: { id: otpRecord.id },
      data: { verified: true, attempts: { increment: 1 } }
    });

    let user = await prisma.user.findUnique({ where: { phone } });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
          phoneVerified: true,
        }
      });

      let inviterId = null;
      if (referredByCode) {
        const inviterEntry = await prisma.waitlistEntry.findUnique({ where: { referralCode: referredByCode } });
        if (inviterEntry) {
          inviterId = inviterEntry.userId;
          // Increase inviter score
          await prisma.waitlistEntry.update({
            where: { id: inviterEntry.id },
            data: { priorityScore: { increment: 50 } }
          });
          // Track referral
          await prisma.referral.create({
            data: {
              inviterId,
              invitedUserId: user.id,
              status: 'CONVERTED'
            }
          });
        }
      }

      await prisma.waitlistEntry.create({
        data: {
          userId: user.id,
          referralCode: nanoid(8),
          referredBy: inviterId,
          source: source || 'direct'
        }
      });
    }

    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, {
      expiresIn: '7d',
    });

    const response = NextResponse.json({ success: true, message: 'تایید موفقیت‌آمیز' });
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
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
