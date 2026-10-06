import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { validateSessionToken, getSessionCookieConfig } from '@/lib/security/session';
import { maskPhone } from '@/lib/sms/phone';
import { CarnoDashboardView } from '@/features/carno-dashboard/pages/CarnoDashboardView';
import { DashboardUserData } from '@/features/carno-dashboard/types/dashboard';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const cookieConfig = getSessionCookieConfig();
  const sessionToken = 
    cookieStore.get(cookieConfig.name)?.value ||
    cookieStore.get('carno_session')?.value ||
    cookieStore.get('__Host-carno_session')?.value ||
    cookieStore.get('token')?.value;

  if (!sessionToken) {
    redirect('/?auth=required#waitlist-registration');
  }

  const auth = await validateSessionToken(sessionToken);
  if (!auth.valid || !auth.userId) {
    redirect('/?auth=expired#waitlist-registration');
  }

  // Load real user and waitlist data
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: {
      waitlistEntry: true,
      _count: { select: { referralsSent: true } },
    },
  });

  if (!user || !user.waitlistEntry) {
    redirect('/?auth=required#waitlist-registration');
  }

  // Calculate real rank based on priorityScore (desc) and joinedAt (asc)
  const usersAhead = await prisma.waitlistEntry.count({
    where: {
      OR: [
        { priorityScore: { gt: user.waitlistEntry.priorityScore } },
        {
          priorityScore: user.waitlistEntry.priorityScore,
          joinedAt: { lt: user.waitlistEntry.joinedAt },
        },
      ],
    },
  });

  let currentRank = usersAhead + 1;
  if (user.status === 'EARLY_ACCESS') {
    currentRank = Math.min(currentRank, 1000);
  }

  const AVATAR_OPTIONS = [
    '/images/avatars/bmw-avatar-1.jpg',
    '/images/avatars/bmw-avatar-2.jpg',
  ];
  const charCodeSum = user.phone.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const avatarUrl = AVATAR_OPTIONS[charCodeSum % AVATAR_OPTIONS.length];

  const dashboardUser: DashboardUserData = {
    id: user.id,
    phone: user.phone,
    maskedPhone: user.phone, // Fully visible unmasked phone
    avatarUrl,
    rank: currentRank,
    refCode: user.waitlistEntry.referralCode,
    referralCount: user._count.referralsSent,
    status: user.status as DashboardUserData['status'],
    priorityScore: user.waitlistEntry.priorityScore,
    pendingScore: user.waitlistEntry.pendingScore,
    joinedAt: user.waitlistEntry.joinedAt.toISOString(),
  };

  return <CarnoDashboardView user={dashboardUser} />;
}
