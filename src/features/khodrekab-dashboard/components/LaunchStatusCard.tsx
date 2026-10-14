import React from 'react';
import { LockClockIcon } from '../icons/DashboardIcons';

export function LaunchStatusCard() {
  return (
    <div 
      id="launch-status-card"
      className="w-full bg-[#131c31] p-7 md:p-10 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-6 border border-slate-800 text-right"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="w-3 h-3 rounded-full bg-emerald-400" />
          <h3 className="text-xl md:text-2xl text-white font-bold tracking-tight">
            خودرکاب در حال آماده‌سازی است
          </h3>
        </div>
        <p className="text-base md:text-lg text-slate-200 font-medium leading-relaxed">
          تیم فنی در حال آماده‌سازی بستر پردازش داده‌ها برای دسترسی اولین گروه کاربران است.
        </p>
      </div>

      <div className="flex items-center gap-3 px-6 py-3.5 rounded-xl bg-[#0a0e1a] border border-slate-700 self-start sm:self-auto shrink-0 shadow-inner">
        <LockClockIcon size={22} className="text-rose-400" />
        <span className="text-base md:text-lg font-bold text-white">
          لانچ حدود یک ماه دیگر
        </span>
      </div>
    </div>
  );
}
