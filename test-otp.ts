import { sendOtpAction, verifyOtpAction } from './src/app/actions/auth';
import { prisma } from './src/lib/prisma';
import bcrypt from 'bcryptjs';

async function run() {
  const phone = '09121111111';
  console.log('--- Testing Send OTP ---');
  const res1 = await sendOtpAction(phone);
  console.log('Send Result:', res1);

  // We need to fetch the OTP from DB to test
  const otpRec = await prisma.oTPVerification.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!otpRec) {
    console.error('No OTP generated!');
    return;
  }
  
  const knownCode = '12345';
  const codeHash = await bcrypt.hash(knownCode, 10);
  
  await prisma.oTPVerification.create({
    data: {
      phone: '09122222222',
      codeHash,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    }
  });

  console.log('\n--- Testing Verify OTP ---');
  const res2 = await verifyOtpAction('09122222222', '12345');
  console.log('Verify Result:', res2);

  // Check waitlist position
  const user = await prisma.user.findUnique({
    where: { phone: '09122222222' },
    include: { waitlistEntry: true }
  });
  console.log('Waitlist Entry Created:', user ? 'Yes' : 'No');
}

run().catch(console.error);
