'use client';
import React from 'react';
import { Button } from '@/components/ui/Button';

export function EarlyAccess() {
  return (
    <section className="w-full py-28 px-6 relative overflow-hidden bg-[#111111]">
      <div className="max-w-2xl mx-auto flex flex-col items-center relative z-10">
        
        {/* Red accent line */}
        <div className="w-10 h-[2px] bg-[#E31C3D] mb-8" />
        
        <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight text-center leading-tight mb-4">
          نسخه اول را با اولین کاربران می‌سازیم
        </h2>
        <p className="text-base text-white/50 text-center max-w-md mb-14 leading-relaxed">
          محصولات بزرگ همیشه از یک گروه کوچک از کاربران اولیه شروع شده‌اند.
        </p>

        {/* The premium pass — dark luxury, white typography, red accent */}
        <div className="max-w-sm w-full">
          <div className="border border-white/10 p-10 rounded-2xl flex flex-col gap-8 items-center text-center relative overflow-hidden">
            {/* Top red line */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-[#E31C3D]" />
            
            {/* Price */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-5xl font-black text-white tabular-nums tracking-tight">
                ۲۹۹,۰۰۰
              </span>
              <span className="text-sm text-white/40 font-medium tracking-widest">تومان</span>
            </div>
            
            {/* Benefits — clean list */}
            <ul className="flex flex-col gap-4 text-right w-full pt-6 border-t border-white/10 text-white/70 text-sm">
              <li className="flex items-center gap-3">
                <span className="text-[#E31C3D] text-xs">●</span>
                اولویت ورود بدون نوبت در زمان عرضه
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#E31C3D] text-xs">●</span>
                دسترسی مادام‌العمر به امکانات ویژه
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#E31C3D] text-xs">●</span>
                نشان ویژه «بنیان‌گذار» در پروفایل کاربری
              </li>
              <li className="flex items-center gap-3">
                <span className="text-[#E31C3D] text-xs">●</span>
                ارتباط مستقیم با تیم سازنده
              </li>
            </ul>

            <Button size="lg" fullWidth className="bg-white text-[#111111] hover:bg-white/90 border-none font-bold mt-2">
              فعال کردن دسترسی نسل اول
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
