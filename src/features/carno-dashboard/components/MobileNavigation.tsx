'use client';

import React from 'react';
import { DashboardIcon, VerifiedUserIcon, GroupAddIcon, PersonIcon } from '../icons/DashboardIcons';

interface MobileNavigationProps {
  activeTab?: string;
  onTabClick: (tab: string) => void;
}

export function MobileNavigation({ activeTab = 'dashboard', onTabClick }: MobileNavigationProps) {
  const scrollTo = (id: string, tabName: string) => {
    onTabClick(tabName);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className="md:hidden fixed bottom-0 w-full z-50 pb-safe bg-[#0a0e1a]/95 backdrop-blur-xl border-t border-[#1E293B] shadow-[0_-2px_12px_rgba(0,0,0,0.35)]">
      <div className="h-16 px-4 flex items-center justify-around">
        
        {/* Dashboard Tab */}
        <button 
          type="button"
          onClick={() => scrollTo('top', 'dashboard')}
          aria-current={activeTab === 'dashboard' ? 'page' : undefined}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 transition-all cursor-pointer ${
            activeTab === 'dashboard' 
              ? 'text-primary font-semibold' 
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <DashboardIcon size={22} className={activeTab === 'dashboard' ? 'text-[#E31C4E]' : 'text-on-surface-variant'} />
          <span className="text-xs">داشبورد</span>
        </button>

        {/* Access Tab */}
        <button 
          type="button"
          onClick={() => scrollTo('membership-card', 'access')}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 transition-all cursor-pointer ${
            activeTab === 'access' 
              ? 'text-primary font-semibold' 
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <VerifiedUserIcon size={22} className={activeTab === 'access' ? 'text-[#E31C4E]' : 'text-on-surface-variant'} />
          <span className="text-xs">دسترسی</span>
        </button>

        {/* Invite Tab */}
        <button 
          type="button"
          onClick={() => scrollTo('referral-card', 'invite')}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 transition-all cursor-pointer ${
            activeTab === 'invite' 
              ? 'text-primary font-semibold' 
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <GroupAddIcon size={22} className={activeTab === 'invite' ? 'text-[#E31C4E]' : 'text-on-surface-variant'} />
          <span className="text-xs">دعوت</span>
        </button>

        {/* Account Tab */}
        <button 
          type="button"
          onClick={() => scrollTo('top', 'account')}
          className={`flex flex-col items-center justify-center min-w-[56px] min-h-[44px] gap-1 transition-all cursor-pointer ${
            activeTab === 'account' 
              ? 'text-primary font-semibold' 
              : 'text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <PersonIcon size={22} className={activeTab === 'account' ? 'text-[#E31C4E]' : 'text-on-surface-variant'} />
          <span className="text-xs">حساب کاربری</span>
        </button>

      </div>
    </nav>
  );
}
