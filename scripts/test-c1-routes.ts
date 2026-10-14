import assert from 'assert';
import { generatePoWChallenge, solvePoW } from '../src/lib/security/pow';
import { clearOtpFailure } from '../src/lib/security/otp';
import { closeRedisConnection } from '../src/lib/security/redis';

// Mock prisma for isolated route test without touching any database
const mockChallenges: any[] = [];

// Intercept prisma methods in memory
import { prisma } from '../src/lib/prisma';
(prisma.oTPVerification as any).create = async ({ data }: any) => {
  const record = { id: 'test_cuid_' + Math.random().toString(36).substring(7), ...data, attempts: 0, verified: false, createdAt: new Date() };
  mockChallenges.push(record);
  return record;
};
(prisma.oTPVerification as any).updateMany = async () => ({ count: 1 });
(prisma.oTPVerification as any).update = async ({ where, data }: any) => {
  const found = mockChallenges.find(c => c.id === where.id);
  if (found) Object.assign(found, data);
  return found || { id: where.id, ...data };
};
(prisma.oTPVerification as any).findFirst = async () => {
  return mockChallenges[mockChallenges.length - 1] || null;
};
(prisma.otpFailureCounter as any) = {
  findUnique: async () => null,
  upsert: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
};
(prisma.user as any).findUnique = async () => null;
(prisma.user as any).create = async ({ data }: any) => ({ id: 'usr_test', ...data });
(prisma.waitlistEntry as any).findUnique = async () => null;
(prisma.waitlistEntry as any).create = async ({ data }: any) => ({ id: 'wl_test', ...data, priorityScore: 10 });

import { POST as registerHandler } from '../src/app/api/waitlist/register/route';
import { POST as verifyHandler } from '../src/app/api/waitlist/verify/route';

async function testRoutes() {
  console.log('--- Testing /api/waitlist/register & /api/waitlist/verify (Isolated) ---');
  const freshPhone = '0912' + Math.floor(1000000 + Math.random() * 8999999).toString();

  // 1. Register with honeypot -> 400
  const reqBot = new Request('http://localhost:3000/api/waitlist/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: freshPhone, _hp: 'spam' }),
  });
  const resBot = await registerHandler(reqBot);
  assert.strictEqual(resBot.status, 400, 'Honeypot submission must return 400');
  const jsonBot = await resBot.json();
  console.log('  [PASS] Honeypot rejection:', jsonBot.error);

  // 2. Register with valid PoW -> 200 with uniform neutral response
  const chal = generatePoWChallenge(3);
  const solution = solvePoW(chal.challenge, 3);

  const reqHuman = new Request('http://localhost:3000/api/waitlist/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: freshPhone,
      pow: { challenge: chal.challenge, solution },
      _hp: '',
      fillTimeMs: 2000,
    }),
  });
  const resHuman = await registerHandler(reqHuman);
  assert.strictEqual(resHuman.status, 200, 'Valid human submission must return 200');
  const jsonHuman = await resHuman.json();
  assert.strictEqual(jsonHuman.message, 'اگر شماره درست باشد، کد ارسال می‌شود.');
  console.log('  [PASS] Neutral response:', jsonHuman.message);

  // 3. Verify with wrong code -> 400
  await clearOtpFailure(freshPhone);

  const reqVerifyWrong = new Request('http://localhost:3000/api/waitlist/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: freshPhone, otp: '00000' }),
  });
  const resVerifyWrong = await verifyHandler(reqVerifyWrong);
  assert.strictEqual(resVerifyWrong.status, 400, 'Wrong OTP must return 400');
  const jsonVerifyWrong = await resVerifyWrong.json();
  assert.strictEqual(jsonVerifyWrong.error, 'کد تایید وارد شده اشتباه است.');
  console.log('  [PASS] Wrong code rejected with:', jsonVerifyWrong.error);

  await closeRedisConnection();
  console.log('--- All Route Tests Passed cleanly! ---');
}

testRoutes().catch((err) => {
  console.error('Route test failed:', err);
  process.exit(1);
});
