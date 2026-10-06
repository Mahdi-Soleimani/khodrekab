import React from 'react';
import Image from 'next/image';
import { VerifiedIcon } from '../icons/DashboardIcons';

interface GreetingSectionProps {
  maskedPhone: string;
  isEarlyAccess?: boolean;
  avatarUrl?: string;
}

export function GreetingSection({ maskedPhone, isEarlyAccess = false, avatarUrl }: GreetingSectionProps) {
  return (
    <section 
      id="top"
      className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 bg-[#131c31] p-7 md:p-10 rounded-2xl shadow-2xl relative overflow-hidden border border-slate-800/80"
    >
      {/* Subtle crimson ambient glow */}
      <div className="absolute -left-20 -top-20 w-64 h-64 bg-rose-600/15 rounded-full blur-3xl pointer-events-none" />
      
      {/* Right Column (Text Content) */}
      <div className="flex flex-col gap-3 z-10 max-w-3xl text-right">
        <div className="flex items-center gap-3.5 flex-wrap">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight">
            خوش آمدی به Carno 👋
          </h1>
          <span className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs md:text-sm font-bold border ${
            isEarlyAccess 
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' 
              : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isEarlyAccess ? 'bg-emerald-400' : 'bg-rose-400'}`} />
            {isEarlyAccess ? 'عضو نسل اول' : 'پیش‌ثبت‌نام اولیه'}
          </span>
        </div>
        
        <p className="text-base md:text-xl text-slate-200 font-medium leading-relaxed">
          عضویتت با موفقیت ثبت شده و از اینجا وضعیت دسترسی خودت را دنبال می‌کنی.
        </p>
      </div>

      {/* Left Column (User Phone Badge & BMW Avatar) */}
      <div className="flex items-center gap-3.5 bg-[#0a0e1a] px-5 py-3.5 rounded-xl shadow-inner border border-slate-700/80 z-10 self-start lg:self-center shrink-0">
        {avatarUrl && (
          <div className="w-12 h-12 rounded-xl overflow-hidden border-2 border-slate-700 shrink-0 shadow-md">
            <Image 
              src={avatarUrl} 
              alt="BMW User Avatar" 
              width={48} 
              height={48} 
              className="w-full h-full object-cover" 
            />
          </div>
        )}
        <div className="flex flex-col text-right">
          <div className="flex items-center gap-1.5">
            <VerifiedIcon size={14} className="text-emerald-400" />
            <span className="text-xs text-slate-400 font-medium">شماره موبایل:</span>
          </div>
          <bdi dir="ltr" className="font-mono text-base md:text-xl text-white font-extrabold tracking-wider mt-0.5 inline-block text-left">
            {maskedPhone}
          </bdi>
        </div>
      </div>
    </section>
  );
}
