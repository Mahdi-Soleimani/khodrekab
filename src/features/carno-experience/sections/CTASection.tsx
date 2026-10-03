'use client';

import React, { useCallback } from 'react';
import { CarnoAnalytics } from '../hooks/useCarnoExperience';

export function CTASection() {
  const scrollTo = useCallback((id: string, ctaType: 'primary' | 'secondary') => {
    CarnoAnalytics.track('cta_clicked', { ctaType, target: id });
    if (ctaType === 'primary') {
      CarnoAnalytics.track('registration_started', { source: 'hero_cta', type: 'waitlist' });
    }
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-4 pointer-events-auto text-center max-w-md mx-auto w-full">
      {/* Pre-launch transparency badge */}
      <div 
        id="hero-status-badge"
        className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-md text-xs text-slate-300 font-medium shadow-sm"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
        <span>در حال آماده‌سازی · لانچ حدود یک ماه دیگر</span>
      </div>

      {/* Primary & Secondary actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5 w-full">
        <button
          id="hero-primary-cta"
          onClick={() => scrollTo('waitlist-registration', 'primary')}
          className="w-full sm:w-auto min-w-[200px] bg-[#E31C4E] hover:bg-[#C21641] text-white px-8 py-3.5 rounded-full font-bold text-base transition-all duration-200 shadow-lg shadow-[#E31C4E]/25 hover:shadow-[#E31C4E]/40 active:scale-95 cursor-pointer"
        >
          دریافت دسترسی اولیه
        </button>

        <button
          id="hero-secondary-cta"
          onClick={() => scrollTo('sample-analysis', 'secondary')}
          className="text-slate-300 hover:text-white transition-colors text-sm font-medium py-2 px-4 flex items-center gap-1.5 cursor-pointer underline-offset-4 hover:underline"
        >
          <span>نمونه تحلیل را ببین</span>
          <span aria-hidden="true" className="text-xs">↓</span>
        </button>
      </div>

      {/* Trust micro-note */}
      <p className="text-xs text-slate-400 font-normal">
        ثبت‌نام اولیه رایگان · فقط شماره موبایل
      </p>
    </div>
  );
}

