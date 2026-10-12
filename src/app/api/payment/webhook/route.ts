import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    // 0. Shared secret verification (only n8n or trusted internal network can call this webhook)
    const authHeader = req.headers.get('authorization');
    if (!process.env.PAYMENT_WEBHOOK_SECRET || authHeader !== `Bearer ${process.env.PAYMENT_WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { amount, referenceId, date } = body;

    // 1. Amount validation
    const parsedAmount = typeof amount === 'number' ? amount : parseInt(String(amount), 10);
    if (isNaN(parsedAmount) || parsedAmount < 299001 || parsedAmount > 299999) {
      return NextResponse.json({ error: 'مبلغ پرداختی نامعتبر است' }, { status: 400 });
    }

    const now = new Date();

    // 2. Deterministic Resolver: Resolve ALL active PENDING intents without LIMIT 1
    const matchingIntents = await prisma.paymentIntent.findMany({
      where: {
        totalAmount: parsedAmount,
        status: 'PENDING',
        expiresAt: { gt: now },
      },
    });

    // 3. Evaluate Resolution Cases

    // Case A: Multiple matching active intents -> Data Integrity Anomaly -> FAIL CLOSED
    if (matchingIntents.length > 1) {
      console.error(
        `[CRITICAL_INTEGRITY_ALERT] Ambiguous resolution: ${matchingIntents.length} active PENDING intents match totalAmount ${parsedAmount}. Failing closed.`
      );
      return NextResponse.json(
        { error: 'خطای بحرانی در یکپارچگی داده‌ها: چند درخواست پرداخت همزمان برای یک مبلغ یافت شد.' },
        { status: 500 }
      );
    }

    // Case B: Exactly 0 matching active intents -> Safe Ignore (Already handled, expired, or unknown)
    if (matchingIntents.length === 0) {
      const historicalIntent = await prisma.paymentIntent.findFirst({
        where: { totalAmount: parsedAmount },
        orderBy: { createdAt: 'desc' },
      });

      console.info(
        `[WEBHOOK_SAFE_IGNORE] Amount ${parsedAmount} resolved 0 active PENDING intents. ` +
        `Historical record status: ${historicalIntent?.status || 'UNKNOWN'}. Returning HTTP 200 IGNORE.`
      );

      return NextResponse.json({
        success: true,
        status: 'IGNORED',
        reason: historicalIntent ? `Intent already ${historicalIntent.status}` : 'Unknown or stale transfer',
      });
    }

    // Case C: Exactly 1 matching active intent -> Atomic Interactive Transaction
    const targetIntent = matchingIntents[0];

    const txResult = await prisma.$transaction(async (tx) => {
      // Step 1: Atomic conditional update with PENDING and unexpired guards
      const updateResult = await tx.paymentIntent.updateMany({
        where: {
          id: targetIntent.id,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        data: {
          status: 'PAID',
          confirmedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        // Concurrently claimed by another worker or expired during resolution
        return { processed: false, reason: 'CONCURRENT_CLAIM_OR_EXPIRED' };
      }

      // Step 2: Insert PaymentLog (guarded by PaymentLog_paymentId_confirmed_key)
      await tx.paymentLog.create({
        data: {
          paymentId: targetIntent.id,
          action: 'CONFIRMED',
          metadata: {
            referenceId: referenceId ? String(referenceId) : null,
            date: date ? String(date) : new Date().toISOString(),
            amount: parsedAmount,
            source: 'n8n_sms_webhook',
          },
        },
      });

      // Step 3: Promote user status to EARLY_ACCESS
      await tx.user.update({
        where: { id: targetIntent.userId },
        data: { status: 'EARLY_ACCESS' },
      });

      return { processed: true, intentId: targetIntent.id };
    });

    if (!txResult.processed) {
      return NextResponse.json({
        success: true,
        status: 'IGNORED',
        reason: 'Payment already processed by concurrent worker',
      });
    }

    return NextResponse.json({
      success: true,
      status: 'CONFIRMED',
      intentId: targetIntent.id,
    });
  } catch (error) {
    console.error('Error in /api/payment/webhook:', error);
    // Infrastructure, DB, or Transaction errors strictly return 5xx so caller can retry
    return NextResponse.json({ error: 'خطای سرور در پردازش وبهوک پرداخت' }, { status: 500 });
  }
}
