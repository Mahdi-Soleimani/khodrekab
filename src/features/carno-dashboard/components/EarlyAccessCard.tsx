'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BoltIcon, VerifiedIcon } from '../icons/DashboardIcons';

interface EarlyAccessCardProps {
  status: string;
}

export function EarlyAccessCard({ status }: EarlyAccessCardProps) {
  const router = useRouter();
  const isPaid = status === 'EARLY_ACCESS';
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleUpgrade = async () => {
    if (loading || isPaid) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const res = await fetch('/api/payment/intent', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.data) {
        localStorage.setItem('paymentIntent', JSON.stringify(data.data));
        router.push('/payment');
      } else {
        setErrorMessage(data.error || 'خطا در ایجاد تراکنش تستی');
      }
    } catch {
      setErrorMessage('خطا در ارتباط با درگاه پرداخت آزمایشی');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      id="early-access-card"
      className="lg:col-span-5 bg-gradient-to-br from-[#1a233a] via-[#131c31] to-[#1a233a] p-7 md:p-10 rounded-2xl shadow-2xl flex flex-col justify-between relative overflow-hidden border border-slate-700/80"
    >
      <div className="absolute top-0 right-0 w-48 h-48 bg-rose-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col gap-4 z-10 text-right">
        
        {/* Status Tag */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          {isPaid ? (
            <span className="px-4 py-1.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs md:text-sm font-bold border border-emerald-500/40 flex items-center gap-2">
              <VerifiedIcon size={16} />
              <span>دسترسی نسل اول فعال</span>
            </span>
          ) : (
            <span className="px-4 py-1.5 rounded-full bg-rose-500/20 text-rose-200 text-xs md:text-sm font-extrabold border border-rose-500/40">
              دسترسی زودهنگام
            </span>
          )}
          <span className="text-xs md:text-sm text-amber-300 font-bold">
            {isPaid ? 'عضو نسل اول' : 'ظرفیت مرحله اول: محدود'}
          </span>
        </div>

        {/* Heading */}
        <h2 className="text-2xl md:text-3xl text-white font-extrabold tracking-tight mt-1">
          {isPaid ? 'دسترسی نسل اول فعال است ✓' : 'دسترسی نسل اول خودرکاب'}
        </h2>

        {/* Simple Truthful Explanation */}
        <p className="text-base md:text-lg text-slate-200 font-medium leading-relaxed">
          {isPaid 
            ? 'دسترسی تو برای ورود زودتر به خودرکاب فعال شده است.'
            : 'برای ورود زودتر به خودرکاب و قرار گرفتن در گروه کاربران نسل اول.'}
        </p>

        {/* Price Row (Unpaid Only) */}
        {!isPaid && (
          <div className="my-2 p-5 bg-[#0a0e1a] rounded-xl flex items-baseline justify-between border border-slate-800 shadow-inner">
            <span className="text-base text-slate-300 font-semibold">مبلغ سرمایه‌گذاری عضویت:</span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-3xl md:text-4xl text-white font-black tracking-tight">۲۹۹٬۰۰۰</span>
              <span className="text-sm md:text-base text-slate-300 font-bold">تومان</span>
            </div>
          </div>
        )}

      </div>

      {/* CTA or Activated State */}
      <div className="flex flex-col gap-2.5 z-10 mt-6">
        {isPaid ? (
          <div className="w-full py-4 px-5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-base md:text-lg rounded-xl flex items-center justify-center gap-2.5">
            <VerifiedIcon size={22} className="text-emerald-400" />
            <span>عضویت نسل اول برای شما فعال است</span>
          </div>
        ) : (
          <>
            {errorMessage && (
              <span className="text-sm text-rose-400 text-center font-bold">{errorMessage}</span>
            )}
            <button 
              type="button"
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full h-14 md:h-16 px-6 bg-[#e31c4e] hover:bg-rose-600 text-white font-extrabold text-base md:text-lg rounded-xl shadow-xl shadow-rose-950/50 transition-all flex items-center justify-center gap-2.5 group cursor-pointer active:scale-98 disabled:opacity-75"
              id="upgradeBtn"
            >
              <span>{loading ? 'در حال اتصال به درگاه...' : 'فعال‌سازی دسترسی نسل اول'}</span>
              <BoltIcon size={22} className="transition-transform group-hover:-translate-x-1" />
            </button>
            <span className="text-xs md:text-sm text-slate-300 font-medium text-center mt-1">
              پرداخت تستی / ضمانت بازگشت وجه کامل تا روز لانچ رسمی
            </span>
          </>
        )}
      </div>

    </div>
  );
}
