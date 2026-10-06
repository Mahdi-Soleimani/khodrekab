import { prisma } from '../src/lib/prisma';
import { createSession } from '../src/lib/security/session';

async function testE2E() {
  console.log('🧪 Starting E2E HTTP Dashboard Test...');
  const testPhone = '09129998877';

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
          referralCode: 'CR-9821',
          priorityScore: 150,
        },
      },
    },
    include: { waitlistEntry: true },
  });

  console.log(`✅ Created test user: ${user.phone}, refCode: ${user.waitlistEntry?.referralCode}`);

  // 3. Create 30-day session
  const sessionResult = await createSession(user.id);
  console.log(`✅ Created 30-day session with JTI: ${sessionResult.jti}`);

  // 4. Request /dashboard with session cookie
  const cookieHeader = `carno_session=${sessionResult.token}; token=${sessionResult.token}`;
  const res = await fetch('http://localhost:3000/dashboard', {
    headers: {
      Cookie: cookieHeader,
    },
    redirect: 'manual',
  });

  console.log(`Dashboard response status: ${res.status}`);
  if (res.status !== 200) {
    const text = await res.text();
    console.error('Failed to access dashboard:', res.status, text.slice(0, 300));
    process.exit(1);
  }

  const html = await res.text();
  
  // Verify real user data is in HTML
  if (!html.includes('۰۹۱۲***۸۸۷۷') && !html.includes('0912***8877')) {
    console.error('❌ Masked phone not found in dashboard HTML');
    process.exit(1);
  }
  console.log('✅ Real masked phone found in HTML');

  if (!html.includes('CR-9821')) {
    console.error('❌ Referral code CR-9821 not found in dashboard HTML');
    process.exit(1);
  }
  console.log('✅ Real referral code CR-9821 found in HTML');

  if (!html.includes('فعال‌سازی دسترسی نسل اول Carno') && !html.includes('دسترسی نسل اول')) {
    console.error('❌ Early access card not found in dashboard HTML');
    process.exit(1);
  }
  console.log('✅ Early Access section found in HTML');

  if (!html.includes('پژو ۲۰۷ اتوماتیک MC')) {
    console.error('❌ Preview market intelligence not found in dashboard HTML');
    process.exit(1);
  }
  console.log('✅ Algorithmic preview tiles found in HTML');

  // 5. Test Logout via API
  const logoutRes = await fetch('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
      Origin: 'http://localhost:3000',
    },
  });
  console.log(`Logout response status: ${logoutRes.status}`);
  const logoutJson = await logoutRes.json();
  console.log('Logout result:', logoutJson);

  // 6. Verify subsequent access is denied and redirects
  const postLogoutRes = await fetch('http://localhost:3000/dashboard', {
    headers: {
      Cookie: cookieHeader,
    },
    redirect: 'manual',
  });
  console.log(`Post-logout dashboard status: ${postLogoutRes.status}`);
  if (postLogoutRes.status !== 307) {
    console.error('❌ Expected 307 redirect after logout, got:', postLogoutRes.status);
    process.exit(1);
  }
  console.log('✅ Dashboard access rejected after logout');

  // 7. Cleanup
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.waitlistEntry.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  console.log('🧹 Cleaned up test user');

  console.log('\n🎉 ALL E2E HTTP DASHBOARD CHECKS PASSED SUCCESSFULLY!');
}

testE2E().catch((err) => {
  console.error(err);
  process.exit(1);
});
