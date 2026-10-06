'use client';

import React, { useState } from 'react';
import { GroupAddIcon, ContentCopyIcon, DoneIcon } from '../icons/DashboardIcons';

interface ReferralCardProps {
  refCode: string;
  priorityScore: number;
}

export function ReferralCard({ refCode, priorityScore }: ReferralCardProps) {
  const [copied, setCopied] = useState(false);

  const getFullReferralLink = () => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/?ref=${refCode}`;
    }
    return `https://carno.ir/?ref=${refCode}`;
  };

  const referralLink = getFullReferralLink();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div 
      id="referral-card"
      className="w-full bg-[#131c31] p-7 md:p-10 rounded-2xl shadow-2xl flex flex-col justify-between border border-slate-800/80 text-right"
    >
      <div className="flex flex-col gap-4">
        
        {/* Header Row */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center border border-emerald-500/30 text-emerald-400">
              <GroupAddIcon size={24} />
            </div>
            <h3 className="text-2xl md:text-3xl text-white font-extrabold tracking-tight">
              با دعوت دوستان، اولویت دسترسی‌ات را بهتر کن
            </h3>
          </div>
          
          <span className="font-mono text-sm md:text-base text-emerald-300 bg-emerald-500/15 px-4 py-1.5 rounded-full border border-emerald-500/30 font-bold">
            +50 PTS
          </span>
        </div>

        {/* Copy text */}
        <p className="text-base md:text-lg text-slate-200 font-semibold leading-relaxed mt-1">
          برای هر ثبت‌نام موفق، +۵۰ امتیاز اولویت.
        </p>

        {/* Meta badges */}
        <div className="flex items-center gap-4 flex-wrap mt-2 text-sm md:text-base text-slate-300">
          <span className="flex items-center gap-2">
            <span>کد اختصاصی شما:</span>
            <strong className="font-mono text-base md:text-lg text-rose-300 bg-rose-500/10 px-3 py-1 rounded-lg border border-rose-500/20 font-bold">
              {refCode}
            </strong>
          </span>
          <span className="text-slate-600 hidden sm:inline">•</span>
          <span className="flex items-center gap-2">
            <span>امتیاز اولویت فعلی:</span>
            <strong className="font-mono text-base md:text-lg text-emerald-400 font-bold">
              +{priorityScore} امتیاز
            </strong>
          </span>
        </div>

      </div>

      {/* Input & Copy Action Bar */}
      <div className="mt-8 flex flex-col gap-2.5">
        <label className="text-sm text-slate-300 font-semibold">لینک دعوت اختصاصی شما:</label>
        <div className="flex items-center gap-3">
          <input 
            readOnly 
            type="text" 
            value={referralLink}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="w-full h-14 bg-[#0a0e1a] text-white font-mono text-sm md:text-base px-5 rounded-xl border border-slate-700 outline-none dir-ltr shadow-inner select-all focus:border-rose-500 transition-colors"
          />
          <button 
            type="button"
            onClick={handleCopy}
            className={`shrink-0 h-14 px-6 md:px-8 font-bold text-base rounded-xl transition-all flex items-center gap-2.5 shadow-md active:scale-95 cursor-pointer border ${
              copied 
                ? 'bg-emerald-500 text-slate-950 border-emerald-400' 
                : 'bg-slate-800 hover:bg-slate-700 text-white border-slate-600'
            }`}
          >
            {copied ? <DoneIcon size={20} /> : <ContentCopyIcon size={20} />}
            <span>{copied ? 'کپی شد!' : 'کپی لینک'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
