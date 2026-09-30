'use client';

import React, { useCallback } from 'react';
import { CarnoAnalytics } from '../hooks/useCarnoExperience';

export function CTASection() {
  const handleInteraction = useCallback((type: 'primary' | 'secondary') => {
    CarnoAnalytics.track('car_cta_hover', { ctaType: type });
  }, []);

  const handleClick = useCallback((type: 'primary' | 'secondary') => {
    CarnoAnalytics.track('car_cta_click', { ctaType: type });
    if (type === 'primary') {
      CarnoAnalytics.track('registration_started', { source: 'carno_experience', type: 'reserve' });
    }
  }, []);

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center justify-center mt-8 pointer-events-auto">
      <button
        onMouseEnter={() => handleInteraction('primary')}
        onClick={() => handleClick('primary')}
        className="bg-white text-black px-10 py-4 rounded-full font-semibold tracking-wide transition-transform hover:scale-105"
      >
        شروع تجربه
      </button>
      <button
        onMouseEnter={() => handleInteraction('secondary')}
        onClick={() => handleClick('secondary')}
        className="border border-white/30 hover:border-white text-white px-10 py-4 rounded-full font-semibold tracking-wide transition-colors"
      >
        دریافت اطلاعات
      </button>
    </div>
  );
}
