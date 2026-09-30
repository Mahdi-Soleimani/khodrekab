'use server';

import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

export async function sendOtpAction(phoneNumber: string) {
  try {
    // Generate 5 digit code
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    
    // Create OTP record (expires in 2 minutes)
    await prisma.oTPVerification.create({
      data: {
        phone: phoneNumber,
        codeHash,
        expiresAt: new Date(Date.now() + 2 * 60 * 1000),
      }
    });

    // MeliPayamak API
    const username = process.env.MELIPAYAMAK_USERNAME;
    const password = process.env.MELIPAYAMAK_PASSWORD;
    const from = process.env.MELIPAYAMAK_FROM;
    
    if (username && password && from) {
      await fetch('https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          text: code,
          to: phoneNumber,
          bodyId: 1234 // Replace with actual pattern ID
        })
      }).catch(e => console.error("SMS API Error:", e));
    } else {
      console.log(`\n======================================`);
      console.log(`[DEV MODE] OTP Code for ${phoneNumber} is: ${code}`);
      console.log(`======================================\n`);
    }

    return { success: true };
  } catch (error) {
    console.error('Send OTP Action Error:', error);
    return { success: false, error: 'خطایی در ارسال کد رخ داد. لطفاً دوباره تلاش کنید.' };
  }
}

export async function verifyOtpAction(phoneNumber: string, code: string, referredByCode?: string | null, source?: string | null) {
  try {
    // Find latest OTP for phone
    const otp = await prisma.oTPVerification.findFirst({
      where: { phone: phoneNumber, verified: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otp) return { success: false, error: 'کدی برای این شماره یافت نشد.' };
    
    if (otp.expiresAt < new Date()) {
      return { success: false, error: 'کد منقضی شده است.' };
    }
    
    if (otp.attempts >= 3) {
      return { success: false, error: 'تعداد دفعات مجاز به پایان رسیده است.' };
    }

    const isValid = await bcrypt.compare(code, otp.codeHash);
    
    if (!isValid) {
      await prisma.oTPVerification.update({
        where: { id: otp.id },
        data: { attempts: otp.attempts + 1 }
      });
      return { success: false, error: 'کد وارد شده اشتباه است.' };
    }

    // Mark as verified
    await prisma.oTPVerification.update({
      where: { id: otp.id },
      data: { verified: true }
    });

    // Find or create User
    let user = await prisma.user.findUnique({ where: { phone: phoneNumber } });
    
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone: phoneNumber,
          phoneVerified: true,
          status: 'WAITLIST'
        }
      });
    }

    // Add to Waitlist if not already in it
    let waitlistEntry = await prisma.waitlistEntry.findUnique({
      where: { userId: user.id }
    });

    if (!waitlistEntry) {
      let referrerId = null;
      
      // Handle referral logic
      if (referredByCode) {
        const referrer = await prisma.waitlistEntry.findUnique({
          where: { referralCode: referredByCode }
        });
        if (referrer) {
          referrerId = referrer.userId;
          // Create Referral record
          await prisma.referral.create({
             data: {
               inviterId: referrer.userId,
               invitedUserId: user.id,
               status: 'SIGNED_UP'
             }
          });
        }
      }

      waitlistEntry = await prisma.waitlistEntry.create({
        data: {
          userId: user.id,
          source: source || 'direct',
          referralCode: nanoid(8),
          referredBy: referrerId,
        }
      });
    }

    // Calculate ranking position
    const positionCount = await prisma.waitlistEntry.count({
      where: {
        OR: [
          { priorityScore: { gt: waitlistEntry.priorityScore } },
          { priorityScore: waitlistEntry.priorityScore, joinedAt: { lt: waitlistEntry.joinedAt } }
        ]
      }
    });

    const baseOffset = parseInt(process.env.WAITLIST_BASE_OFFSET || '300', 10);
    const finalPosition = positionCount + baseOffset + 1;

    return { success: true, waitlist_position: finalPosition };
  } catch (error) {
    console.error('Verify OTP Action Error:', error);
    return { success: false, error: 'خطایی در تایید کد رخ داد.' };
  }
}
