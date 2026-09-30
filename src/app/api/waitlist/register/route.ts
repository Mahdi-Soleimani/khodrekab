import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendOTP } from '@/lib/sms';
import bcrypt from 'bcryptjs';

export async function POST(req: Request) {
  try {
    const { phone } = await req.json();

    if (!phone || !/^09\d{9}$/.test(phone)) {
      return NextResponse.json({ error: 'شماره موبایل نامعتبر است' }, { status: 400 });
    }

    // Rate limiting: prevent more than 1 request per minute per phone
    const recentOtp = await prisma.oTPVerification.findFirst({
      where: {
        phone,
        createdAt: { gt: new Date(Date.now() - 60 * 1000) }
      }
    });

    if (recentOtp) {
      return NextResponse.json({ error: 'لطفا یک دقیقه صبر کنید' }, { status: 429 });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 mins
    const codeHash = await bcrypt.hash(otp, 10);

    // Invalidate previous OTPs for this phone
    await prisma.oTPVerification.updateMany({
      where: { phone, verified: false },
      data: { verified: true } // marking as unusable basically, or could delete
    });

    await prisma.oTPVerification.create({
      data: {
        phone,
        codeHash,
        expiresAt: otpExpiry,
      }
    });

    await sendOTP(phone, otp);

    return NextResponse.json({ success: true, message: 'کد تایید ارسال شد' });
  } catch (error) {
    console.error('Error in /api/waitlist/register:', error);
    return NextResponse.json({ error: 'خطای سرور' }, { status: 500 });
  }
}
