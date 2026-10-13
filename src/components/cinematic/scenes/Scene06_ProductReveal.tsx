import React from 'react';
import { Button } from '@/components/ui/Button';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene06_ProductReveal({ progress, active }: SceneProps) {
  
  const fadeIn = active ? Math.min(progress / 0.2, 1) : 0;
  
  const item1 = active && progress > 0.1 ? Math.min((progress - 0.1) / 0.12, 1) : 0;
  const item2 = active && progress > 0.25 ? Math.min((progress - 0.25) / 0.12, 1) : 0;
  const item3 = active && progress > 0.4 ? Math.min((progress - 0.4) / 0.12, 1) : 0;
  const ctaProgress = active && progress > 0.6 ? Math.min((progress - 0.6) / 0.15, 1) : 0;
  
  const scrollToWaitlist = () => {
    document.getElementById('waitlist-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div 
      className={`scene-overlay flex flex-col items-center justify-center px-6 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 6 }}
    >
      <div 
        className="text-center max-w-lg"
        style={{ opacity: fadeIn }}
      >
        {/* Title */}
        <div className="w-8 h-[2px] bg-[#E31C3D] mx-auto mb-6" />
        <h2 className="text-3xl md:text-4xl font-black text-[#111111] tracking-tight mb-10 leading-[1.3]">
          ارزیابی جامع خودرکاب
        </h2>
        
        {/* Result grid — clean, no card wrappers */}
        <div className="flex flex-col gap-8 text-right">
          
          {/* Visual Analysis */}
          <div 
            className="flex items-baseline justify-between border-b border-[#E5E5E5] pb-4"
            style={{ opacity: item1, transform: `translateY(${10 * (1 - item1)}px)`, transition: 'all 0.3s ease-out' }}
          >
            <span className="text-sm text-[#999999] font-medium">تحلیل بصری</span>
            <span className="text-xl font-bold text-[#111111]">تکمیل شد</span>
          </div>
          
          {/* Market Intelligence */}
          <div 
            className="flex items-baseline justify-between border-b border-[#E5E5E5] pb-4"
            style={{ opacity: item2, transform: `translateY(${10 * (1 - item2)}px)`, transition: 'all 0.3s ease-out' }}
          >
            <span className="text-sm text-[#999999] font-medium">هوش بازار</span>
            <span className="text-xl font-bold text-[#111111]">ارزیابی شد</span>
          </div>
          
          {/* AI Verdict */}
          <div 
            className="flex items-baseline justify-between"
            style={{ opacity: item3, transform: `translateY(${10 * (1 - item3)}px)`, transition: 'all 0.3s ease-out' }}
          >
            <span className="text-sm text-[#999999] font-medium">نتیجه نهایی</span>
            <span className="text-xl font-bold text-[#E31C3D]">ارزش خرید بالا</span>
          </div>
        </div>
        
        {/* CTA */}
        <div 
          className="mt-12"
          style={{ opacity: ctaProgress, transform: `translateY(${10 * (1 - ctaProgress)}px)`, transition: 'all 0.3s ease-out' }}
        >
          <Button size="lg" onClick={scrollToWaitlist}>
            دریافت دسترسی اولیه
          </Button>
        </div>
      </div>
    </div>
  );
}
