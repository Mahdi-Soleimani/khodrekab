import { NextResponse } from 'next/server';
import { generatePoWChallenge } from '@/lib/security/pow';

export async function GET() {
  try {
    const challengeData = generatePoWChallenge(3); // 3 leading zeros
    return NextResponse.json(challengeData);
  } catch (error) {
    console.error('Error generating PoW challenge:', error);
    return NextResponse.json(
      { error: 'خطا در ایجاد چالش امنیتی.' },
      { status: 500 }
    );
  }
}
