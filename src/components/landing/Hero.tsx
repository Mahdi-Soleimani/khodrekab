'use client';
import React from 'react';
import { Button } from '@/components/ui/Button';
import { useRouter } from 'next/navigation';
import posthog from 'posthog-js';

export function Hero() {
  const router = useRouter();

  const handleCTA = () => {
    posthog.capture('hero_cta_click');
    const waitlistEl = document.getElementById('waitlist');
    if (waitlistEl) {
      waitlistEl.scrollIntoView({ behavior: 'smooth' });
    } else {
      router.push('/#waitlist');
    }
  };

  return (
    <section className="w-full pt-32 pb-24 px-6 flex flex-col items-center justify-center text-center max-w-5xl mx-auto relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Trust Badge */}
      <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm text-sm font-medium text-slate-600">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        اولین دستیار هوشمند خرید خودرو
      </div>
      
      {/* Headline */}
      <h1 className="h1 mb-8 max-w-4xl text-slate-900 tracking-tight">
        قبل از خرید خودرو، <br />
        <span className="text-primary">چیزی که نمی‌بینید</span> را پیدا کنید.
      </h1>
      
      {/* Subtitle */}
      <p className="text-body max-w-2xl mb-12 text-slate-600">
        هر خودرو سیگنال‌های پنهانی دارد که فروشنده به شما نمی‌گوید. ما با تحلیل میلیون‌ها داده، قیمت واقعی، ریسک معامله و نقاط ضعف پنهان را آشکار می‌کنیم تا با اطمینان کامل خرید کنید.
      </p>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row items-center gap-4 w-full justify-center relative z-10">
        <Button size="lg" onClick={handleCTA} className="w-full sm:w-auto px-8">
          دریافت دسترسی اولیه
        </Button>
        <Button variant="outline" size="lg" className="w-full sm:w-auto px-8">
          مشاهده نمونه تحلیل
        </Button>
      </div>

      <p className="text-small text-slate-500 mt-6">
        ظرفیت دسترسی اولیه محدود است.
      </p>

    </section>
  );
}
