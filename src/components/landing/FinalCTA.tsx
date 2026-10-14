'use client';
import React from 'react';
import { Button } from '@/components/ui/Button';

export function FinalCTA() {
  const scrollToWaitlist = () => {
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="w-full py-32 px-6 bg-slate-900 border-t border-slate-800 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[600px] bg-primary/10 blur-[150px] pointer-events-none" />

      <div className="max-w-4xl mx-auto flex flex-col items-center text-center relative z-10">
        <h2 className="h2 text-white mb-6">
          آماده‌اید هوشمندانه معامله کنید؟
        </h2>
        <p className="text-lg text-slate-400 mb-12 max-w-2xl font-medium">
          به لیست انتظار بپیوندید و قبل از دیگران به قدرتمندترین ابزار تحلیل بازار خودرو دسترسی پیدا کنید.
        </p>
        
        <Button size="lg" className="px-12 text-lg shadow-xl shadow-primary/20" onClick={scrollToWaitlist}>
          درخواست دعوت‌نامه
        </Button>
      </div>
    </section>
  );
}
