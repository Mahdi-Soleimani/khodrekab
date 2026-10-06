'use server';

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { smsService } from '@/lib/sms';
import { normalizeIranianPhone, convertDigitsToEnglish, maskPhone } from '@/lib/sms/phone';

export async function sendOtpAction(phoneNumber: string) {
  try {
    const normalizedPhone = normalizeIranianPhone(phoneNumber);
    if (!normalizedPhone) {
      return { success: false, error: 'شماره موبایل وارد شده معتبر نیست. لطفاً شماره ۱۱ رقمی با ۰۹ وارد کنید.' };
    }

    // Generate cryptographically secure 5-digit code
    const code = crypto.randomInt(10000, 100000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    
    // Invalidate prior pending challenges
    await prisma.oTPVerification.updateMany({
      where: { phone: normalizedPhone, verified: false },
      data: { verified: true },
    });

    // Create OTP record (expires in 5 minutes)
    const challenge = await prisma.oTPVerification.create({
      data: {
        phone: normalizedPhone,
        codeHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      }
    });

    // Dispatch via unified SMS service
    const sendResult = await smsService.sendOtp({
      phone: normalizedPhone,
      code,
    });

    if (!sendResult.success) {
      await prisma.oTPVerification.update({
        where: { id: challenge.id },
        data: { verified: true },
      });
      return {
        success: false,
        error: sendResult.userMessage || 'خطایی در ارسال کد رخ داد. لطفاً دوباره تلاش کنید.',
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Send OTP Action Error:', error);
    return { success: false, error: 'خطایی در ارسال کد رخ داد. لطفاً دوباره تلاش کنید.' };
  }
}

export async function verifyOtpAction(phoneNumber: string, code: string, referredByCode?: string | null, source?: string | null) {
  try {
    const normalizedPhone = normalizeIranianPhone(phoneNumber);
    if (!normalizedPhone) {
      return { success: false, error: 'شماره موبایل نامعتبر است.' };
    }

    const cleanCode = convertDigitsToEnglish(code ? String(code).trim() : '');
    if (!cleanCode) {
      return { success: false, error: 'کد تایید وارد نشده است.' };
    }

    // Find latest OTP for phone
    const otp = await prisma.oTPVerification.findFirst({
      where: { phone: normalizedPhone, verified: false },
      orderBy: { createdAt: 'desc' }
    });

    if (!otp) return { success: false, error: 'کدی برای این شماره یافت نشد.' };
    
    if (otp.expiresAt < new Date()) {
      return { success: false, error: 'کد منقضی شده است.' };
    }
    
    if (otp.attempts >= 3) {
      return { success: false, error: 'تعداد دفعات مجاز به پایان رسیده است.' };
    }

    const isValid = await bcrypt.compare(cleanCode, otp.codeHash);
    
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
