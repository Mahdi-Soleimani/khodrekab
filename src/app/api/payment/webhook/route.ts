import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    // Basic auth to ensure only n8n can call this webhook
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.PAYMENT_WEBHOOK_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { amount, referenceId, date } = await req.json();

    if (!amount) {
      return NextResponse.json({ error: 'Amount is required' }, { status: 400 });
    }

    // Find pending intent by amount
    const intent = await prisma.paymentIntent.findFirst({
      where: {
        totalAmount: parseInt(amount),
        status: 'PENDING',
        expiresAt: { gt: new Date() } // hasn't expired
      },
      include: {
        user: true
      }
    });

    if (!intent) {
      // Could be expired, already paid, or invalid amount
      console.warn('Webhook received but no matching pending intent found for amount:', amount);
      return NextResponse.json({ error: 'Intent not found or expired' }, { status: 404 });
    }

    // Process payment success
    await prisma.$transaction([
      prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'PAID', confirmedAt: new Date() }
      }),
      prisma.paymentLog.create({
        data: {
          paymentId: intent.id,
          action: 'CONFIRMED',
          metadata: { referenceId, date }
        }
      }),
      prisma.user.update({
        where: { id: intent.userId },
        data: { status: 'EARLY_ACCESS' }
      })
    ]);

    return NextResponse.json({ success: true, message: 'Payment processed successfully' });

  } catch (error) {
    console.error('Error in /api/payment/webhook:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
