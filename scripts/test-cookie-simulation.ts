import { prisma } from '../src/lib/prisma';
import { createSession } from '../src/lib/security/session';

async function testCookieSimulation() {
  console.log('====================================================');
  console.log('🧪 SIMULATING LEGACY carno_session COOKIE FALLBACK');
  console.log('====================================================');

  const testPhone = '09121234567';

  // 1. Clean existing test user if any
  const existing = await prisma.user.findUnique({ where: { phone: testPhone } });
  if (existing) {
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    await prisma.waitlistEntry.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
  }

  // 2. Create user + waitlistEntry
  const user = await prisma.user.create({
    data: {
      phone: testPhone,
      phoneVerified: true,
      status: 'WAITLIST',
      waitlistEntry: {
        create: {
          referralCode: 'KHOD-7777',
          priorityScore: 200,
        },
      },
    },
    include: { waitlistEntry: true },
  });

  console.log(`✅ [1/4] Test User Created: ${user.phone}, Referral: ${user.waitlistEntry?.referralCode}`);

  // 3. Create active session token
  const sessionResult = await createSession(user.id);
  console.log(`✅ [2/4] Active Session Token Created with JTI: ${sessionResult.jti}`);

  // 4. Test accessing /dashboard with LEGACY carno_session cookie
  console.log('⏳ [3/4] Sending GET /dashboard with Cookie: carno_session=<token> ...');
  const legacyRes = await fetch('http://127.0.0.1:3000/dashboard', {
    headers: {
      Cookie: `carno_session=${sessionResult.token}`,
    },
    redirect: 'manual',
  });

  console.log(`   → HTTP Status: ${legacyRes.status}`);
  if (legacyRes.status !== 200) {
    const errorBody = await legacyRes.text();
    console.error('❌ Failed to authenticate with legacy carno_session cookie:', legacyRes.status, errorBody.slice(0, 300));
    process.exit(1);
  }

  const legacyHtml = await legacyRes.text();
  if (!legacyHtml.includes('09121234567') && !legacyHtml.includes('۰۹۱۲۱۲۳۴۵۶۷')) {
    console.error('❌ User phone not found in dashboard HTML with carno_session');
    process.exit(1);
  }
  if (!legacyHtml.includes('KHOD-7777')) {
    console.error('❌ Referral code not found in dashboard HTML with carno_session');
    process.exit(1);
  }
  if (!legacyHtml.includes('خودرکاب')) {
    console.error('❌ Khodrekab brand not found in dashboard HTML with carno_session');
    process.exit(1);
  }
  console.log('✅ [3/4] SUCCESS: Legacy carno_session cookie accepted! User data, referral code, and Khodrekab brand verified.');

  // 5. Test accessing /dashboard with NEW khodrekab_session cookie
  console.log('⏳ [4/4] Sending GET /dashboard with Cookie: khodrekab_session=<token> ...');
  const newRes = await fetch('http://127.0.0.1:3000/dashboard', {
    headers: {
      Cookie: `khodrekab_session=${sessionResult.token}`,
    },
    redirect: 'manual',
  });

  console.log(`   → HTTP Status: ${newRes.status}`);
  if (newRes.status !== 200) {
    const errorBody = await newRes.text();
    console.error('❌ Failed to authenticate with new khodrekab_session cookie:', newRes.status, errorBody.slice(0, 300));
    process.exit(1);
  }

  const newHtml = await newRes.text();
  if (!newHtml.includes('09121234567') && !newHtml.includes('۰۹۱۲۱۲۳۴۵۶۷')) {
    console.error('❌ User phone not found in dashboard HTML with khodrekab_session');
    process.exit(1);
  }
  if (!newHtml.includes('KHOD-7777')) {
    console.error('❌ Referral code not found in dashboard HTML with khodrekab_session');
    process.exit(1);
  }
  if (!newHtml.includes('خودرکاب')) {
    console.error('❌ Khodrekab brand not found in dashboard HTML with khodrekab_session');
    process.exit(1);
  }
  console.log('✅ [4/4] SUCCESS: New khodrekab_session cookie accepted! User data, referral code, and Khodrekab brand verified.');

  console.log('\n🎉 ALL COOKIE DUAL-FALLBACK CHECKS PASSED PERFECTLY!\n');
}

testCookieSimulation()
  .catch((err) => {
    console.error('Fatal test error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
