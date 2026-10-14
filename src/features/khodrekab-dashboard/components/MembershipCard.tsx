import React from 'react';
import { BadgeIcon, TrendingUpIcon, VerifiedUserIcon } from '../icons/DashboardIcons';

interface MembershipCardProps {
  rank: number;
  status: string;
  priorityScore: number;
}

export function MembershipCard({ rank, status, priorityScore }: MembershipCardProps) {
  const isEarlyAccess = status === 'EARLY_ACCESS';

  return (
    <div 
      id="membership-card"
      className="lg:col-span-7 bg-[#131c31] p-7 md:p-10 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden border border-slate-800/80"
    >
      <div className="flex flex-col gap-6 text-right">
        
        {/* Card Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center border border-rose-500/30 text-rose-400">
              <BadgeIcon size={24} />
            </div>
            <h2 className="text-2xl md:text-3xl text-white font-extrabold tracking-tight">
              عضویت خودرکاب
            </h2>
          </div>
          
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs md:text-sm font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <VerifiedUserIcon size={16} className="text-emerald-400" />
            <span>{isEarlyAccess ? '✓ عضو نسل اول' : '✓ عضو اولین گروه کاربران'}</span>
          </span>
        </div>

        {/* Prominent Rank Display Container */}
        <div className="bg-[#0a0e1a] p-6 md:p-8 rounded-xl flex flex-col gap-4 border border-slate-800/90 shadow-inner">
          <span className="text-base md:text-lg text-slate-200 font-semibold">
            جایگاه فعلی تو در صف دسترسی اولیه
          </span>
          
          <div className="flex items-baseline gap-3 my-1">
            <span className="font-mono text-6xl sm:text-7xl md:text-8xl font-black text-white tracking-tight leading-none">
              #{rank}
            </span>
          </div>

          <div className="flex items-center gap-2 pt-3 border-t border-slate-800">
            <span className="text-base md:text-lg text-emerald-400 font-bold flex items-center gap-2">
              <TrendingUpIcon size={20} className="text-emerald-400" />
              <span>امتیاز اولویت شما: +{priorityScore} امتیاز</span>
            </span>
          </div>
        </div>

      </div>

      {/* Secondary Status Footer */}
      <div className="mt-6 pt-4 border-t border-slate-800/80 text-right">
        <p className="text-base md:text-lg text-slate-300 font-medium leading-relaxed">
          در حال تشکیل اولین گروه کاربران خودرکاب
        </p>
      </div>

    </div>
  );
}
