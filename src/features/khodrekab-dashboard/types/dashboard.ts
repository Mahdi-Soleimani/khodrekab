export interface DashboardUserData {
  id: string;
  phone: string;
  maskedPhone: string;
  avatarUrl: string;
  rank: number;
  refCode: string;
  referralCount: number;
  status: 'WAITLIST' | 'EARLY_ACCESS' | 'ACTIVE' | 'BLOCKED';
  priorityScore: number;
  pendingScore: number;
  joinedAt: string;
}

export interface OpportunityVehicle {
  id: string;
  title: string;
  year: string;
  specs: string;
  deviationLabel: string;
  deviationAmount: string;
  khodrekabScore: number;
  tag: string;
}
