import assert from 'node:assert';
import { PrismaClient } from '@prisma/client';
import { POST as webhookHandler } from '../src/app/api/payment/webhook/route';

const prisma = new PrismaClient();

// Helper to generate unique synthetic phone
function genSyntheticPhone(): string {
  const rand = Math.floor(1000000 + Math.random() * 9000000);
  return `0999${rand}`;
}

// Helper to construct Request object for /api/payment/webhook
function makeWebhookRequest(
  body: { amount: number; referenceId?: string; date?: string },
  secret: string = process.env.PAYMENT_WEBHOOK_SECRET || ''
) {
  return new Request('http://localhost:3000/api/payment/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
}

async function runDatabaseFailureRollbackTest() {
  console.log('====================================================');
  console.log('   CARNO GATE C3 DATABASE FAILURE & ROLLBACK TEST   ');
  console.log('====================================================\n');

  // Verify DB connection & webhook secret
  process.env.PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'test-secret';

  // 1. Create synthetic user
  const phone = genSyntheticPhone();
  const user = await prisma.user.create({
    data: {
      phone,
      phoneVerified: true,
      status: 'WAITLIST',
    },
  });

  const uniqueCode = 739;
  const totalAmount = 299000 + uniqueCode; // 299739

  console.log(`[SETUP] Created synthetic user: ${user.id} (${phone})`);

  try {
    // 2. Create synthetic PaymentIntent in PENDING status
    const intent = await prisma.paymentIntent.create({
      data: {
        userId: user.id,
        amount: 299000,
        uniqueCode,
        totalAmount,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 mins in future
      },
    });

    console.log(`[SETUP] Created synthetic PaymentIntent: ${intent.id}, code=${uniqueCode}, totalAmount=${totalAmount}`);

    // Verify initial pre-transaction state
    assert.strictEqual(intent.status, 'PENDING');
    assert.strictEqual(intent.confirmedAt, null);
    assert.strictEqual(user.status, 'WAITLIST');

    // 3. Pre-create a conflicting CONFIRMED PaymentLog for this exact paymentId.
    // The database index PaymentLog_paymentId_confirmed_key enforces uniqueness:
    // exactly one CONFIRMED log per paymentId.
    const preExistingLog = await prisma.paymentLog.create({
      data: {
        paymentId: intent.id,
        action: 'CONFIRMED',
        metadata: { source: 'pre_existing_synthetic_log_for_failure_injection' },
      },
    });
    console.log(`[FAILURE_INJECTION] Pre-created conflicting CONFIRMED PaymentLog: ${preExistingLog.id}`);

    const preLogsCount = await prisma.paymentLog.count({
      where: { paymentId: intent.id, action: 'CONFIRMED' },
    });
    assert.strictEqual(preLogsCount, 1, 'Pre-existing CONFIRMED log must exist');

    console.log('\n[EXECUTION] Calling POST /api/payment/webhook with valid amount and secret...');
    console.log('  -> Step 1 in transaction will attempt: update PaymentIntent to PAID (succeeds)');
    console.log('  -> Step 2 in transaction will attempt: insert duplicate CONFIRMED PaymentLog');
    console.log('  -> PostgreSQL unique index PaymentLog_paymentId_confirmed_key will violate P2002');
    console.log('  -> Transaction MUST abort and completely ROLLBACK');
    console.log('  -> Route catch-block MUST return HTTP 500\n');

    // 4. Send valid webhook request for this intent
    const response = await webhookHandler(
      makeWebhookRequest({
        amount: totalAmount,
        referenceId: 'sms-db-failure-injection-ref',
      })
    );

    const resStatus = response.status;
    const resBody = await response.json();

    console.log(`[HTTP_RESPONSE] Status: ${resStatus}`);
    console.log(`[HTTP_RESPONSE] Body: ${JSON.stringify(resBody)}`);

    // 5. Assert HTTP 500 (Never 200 on DB failure)
    assert.strictEqual(resStatus, 500, `Expected HTTP 500, got ${resStatus}`);
    assert.notStrictEqual(resStatus, 200, 'CRITICAL: Must never return HTTP 200 on DB/transaction failure');
    assert.strictEqual(resBody.error, 'خطای سرور در پردازش وبهوک پرداخت');

    // 6. Inspect database state post-failure to prove transactional rollback
    console.log('\n[POST_TRANSACTION_INSPECTION] Querying live database...');

    const postIntent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    console.log(`  - PaymentIntent status: ${postIntent.status}`);
    console.log(`  - PaymentIntent confirmedAt: ${postIntent.confirmedAt}`);

    const postLogs = await prisma.paymentLog.findMany({
      where: { paymentId: intent.id, action: 'CONFIRMED' },
    });
    console.log(`  - CONFIRMED PaymentLog count: ${postLogs.length}`);

    const postUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    console.log(`  - User status: ${postUser.status}`);

    // Critical Rollback Assertions
    assert.strictEqual(
      postIntent.status,
      'PENDING',
      'ROLLBACK_FAILED: PaymentIntent was not rolled back to PENDING'
    );
    assert.strictEqual(
      postIntent.confirmedAt,
      null,
      'ROLLBACK_FAILED: confirmedAt must remain null after rollback'
    );
    assert.strictEqual(
      postLogs.length,
      1,
      'ROLLBACK_FAILED: A duplicate CONFIRMED log was committed'
    );
    assert.strictEqual(
      postLogs[0].id,
      preExistingLog.id,
      'Only the pre-existing synthetic log must remain'
    );
    assert.strictEqual(
      postUser.status,
      'WAITLIST',
      'ROLLBACK_FAILED: User status was illegally updated to EARLY_ACCESS'
    );
    assert.notStrictEqual(
      postUser.status,
      'EARLY_ACCESS',
      'User must NOT have EARLY_ACCESS status'
    );

    console.log('\n====================================================');
    console.log('   TRANSACTION ROLLBACK & HTTP 500 VERIFIED (PASS)  ');
    console.log('====================================================\n');
  } finally {
    // 7. Cleanup synthetic test data
    console.log('[CLEANUP] Cleaning up synthetic test data...');
    await prisma.paymentLog.deleteMany({ where: { payment: { userId: user.id } } });
    await prisma.paymentIntent.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    // Verify cleanup
    const leftoverUsers = await prisma.user.count({ where: { id: user.id } });
    const leftoverIntents = await prisma.paymentIntent.count({ where: { userId: user.id } });
    assert.strictEqual(leftoverUsers, 0, 'Synthetic user must be deleted');
    assert.strictEqual(leftoverIntents, 0, 'Synthetic payment intent must be deleted');
    console.log('[CLEANUP] Verification clean: 0 leftover records.\n');
  }
}

runDatabaseFailureRollbackTest()
  .then(() => {
    console.log('Test execution completed with code: 0');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test execution failed with error:', err);
    process.exit(1);
  });
