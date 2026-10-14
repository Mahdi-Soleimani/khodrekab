'use client';

import React, { useState } from 'react';
import { DashboardUserData } from '../types/dashboard';
import { DashboardHeader } from '../components/DashboardHeader';
import { GreetingSection } from '../components/GreetingSection';
import { MembershipCard } from '../components/MembershipCard';
import { EarlyAccessCard } from '../components/EarlyAccessCard';
import { ReferralCard } from '../components/ReferralCard';
import { ProductPreviewSection } from '../components/ProductPreviewSection';
import { LaunchStatusCard } from '../components/LaunchStatusCard';
import { MobileNavigation } from '../components/MobileNavigation';
import { DashboardFooter } from '../components/DashboardFooter';

interface KhodrekabDashboardViewProps {
  user: DashboardUserData;
}

export function KhodrekabDashboardView({ user }: KhodrekabDashboardViewProps) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const isEarlyAccess = user.status === 'EARLY_ACCESS';

  return (
    <div className="bg-[#0a0e1a] font-sans text-slate-100 antialiased selection:bg-rose-500/30 selection:text-white min-h-screen flex flex-col relative">
      
      {/* Top Header (Desktop & Mobile) */}
      <DashboardHeader 
        maskedPhone={user.maskedPhone} 
        avatarUrl={user.avatarUrl}
      />

      {/* Main Content Area */}
      <main className="w-full pt-24 md:pt-28 flex-1 bg-[#0a0e1a] relative pb-28 md:pb-16">
        
        {/* Subtle Ambient Radial Glow */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,rgba(227,28,78,0.07),transparent_50%)]" />

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-6">
          <div className="flex flex-col w-full gap-8 md:gap-10">
            
            {/* 1. Welcome / Identity */}
            <GreetingSection 
              maskedPhone={user.maskedPhone} 
              isEarlyAccess={isEarlyAccess}
              avatarUrl={user.avatarUrl}
            />

            {/* 2 & 3 & 4. Membership (Real Rank) & Early Access Pass */}
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
              <MembershipCard 
                rank={user.rank} 
                status={user.status}
                priorityScore={user.priorityScore}
              />
              <EarlyAccessCard 
                status={user.status}
              />
            </section>

            {/* 5. Referral Acceleration */}
            <section className="grid grid-cols-1 gap-6 md:gap-8">
              <ReferralCard 
                refCode={user.refCode}
                priorityScore={user.priorityScore}
              />
            </section>

            {/* 6. Future Product Preview (3 Concise Capability Cards) */}
            <ProductPreviewSection />

            {/* 7. Simple Launch Status */}
            <LaunchStatusCard />

          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <MobileNavigation 
        activeTab={activeTab}
        onTabClick={setActiveTab}
      />

      {/* Footer */}
      <DashboardFooter />

    </div>
  );
}
