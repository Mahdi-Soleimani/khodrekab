'use client';

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export function CarStoryOverlay() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const phase1Ref = useRef<HTMLDivElement>(null);
  const phase2Ref = useRef<HTMLDivElement>(null);
  const phase3Ref = useRef<HTMLDivElement>(null);
  const phase4Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // This animation uses GSAP's scroll trigger directly linked to the body scroll
    // without using React state or triggering re-renders
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: '#khodrekab-story-container', // The 500vh container
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
      }
    });

    // Setup initial states
    gsap.set([phase1Ref.current, phase2Ref.current, phase3Ref.current, phase4Ref.current], { opacity: 0, y: 20 });
    
    // Phase 1: Front / First Impression (0 to 25%)
    timeline
      .to(phase1Ref.current, { opacity: 1, y: 0, duration: 0.08 })
      .to(phase1Ref.current, { opacity: 0, y: -20, duration: 0.08 }, 0.20)
      
      // Phase 2: Side / Opportunity (25% to 50%)
      .to(phase2Ref.current, { opacity: 1, y: 0, duration: 0.08 }, 0.28)
      .to(phase2Ref.current, { opacity: 0, y: -20, duration: 0.08 }, 0.46)
      
      // Phase 3: Rear / Hidden Signals (50% to 75%)
      .to(phase3Ref.current, { opacity: 1, y: 0, duration: 0.08 }, 0.54)
      .to(phase3Ref.current, { opacity: 0, y: -20, duration: 0.08 }, 0.72)
      
      // Phase 4: Return / Decision (75% to 100%)
      .to(phase4Ref.current, { opacity: 1, y: 0, duration: 0.08 }, 0.78)
      .to(phase4Ref.current, { opacity: 1, y: 0, duration: 0.15 }, 0.90);

    return () => {
      timeline.kill();
    };
  }, []);

  return (
    <div ref={overlayRef} className="absolute inset-0 pointer-events-none z-20 flex items-start sm:items-center justify-start px-6 md:px-16 lg:px-24 pt-24 sm:pt-0">
      {/* Container for all text milestones, kept absolute so it doesn't shift layout */}
      <div className="relative w-full max-w-xl text-right">
        
        {/* Phase 1: Front / First Impression */}
        <div ref={phase1Ref} className="absolute top-0 right-0 left-0 text-white">
          <div className="w-8 h-[2px] bg-[#E31C3D] mb-4" />
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.2] mb-4 text-white">
            این خودرو واقعاً <span className="text-[#E31C3D]">چقدر می‌ارزد؟</span>
          </h2>
          <p className="text-base sm:text-lg md:text-xl font-normal text-white/80 leading-relaxed max-w-lg">
            خودرکاب قیمت بازار را بررسی می‌کند تا بفهمی یک آگهی گران است، منصفانه است یا می‌تواند فرصت خرید باشد.
          </p>
        </div>

        {/* Phase 2: Side / Opportunity */}
        <div ref={phase2Ref} className="absolute top-0 right-0 left-0 text-white opacity-0">
          <div className="w-8 h-[2px] bg-[#E31C3D] mb-4" />
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.2] mb-4 text-white">
            فرصت‌های <span className="text-[#E31C3D]">زیر قیمت بازار</span> را قبل از بقیه پیدا کن.
          </h2>
          <p className="text-base sm:text-lg md:text-xl font-normal text-white/80 leading-relaxed max-w-lg">
            از میان گزینه‌های بازار، خودروهایی را که ارزش بررسی بیشتری دارند برایت مشخص می‌کنیم.
          </p>
        </div>

        {/* Phase 3: Rear / Hidden Signals */}
        <div ref={phase3Ref} className="absolute top-0 right-0 left-0 text-white opacity-0">
          <div className="w-8 h-[2px] bg-[#E31C3D] mb-4" />
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.2] mb-4 text-white">
            قبل از تماس، <span className="text-[#E31C3D]">چیزی را ببین</span> که در آگهی دیده نمی‌شود.
          </h2>
          <p className="text-base sm:text-lg md:text-xl font-normal text-white/80 leading-relaxed max-w-lg">
            نشانه‌های مهم آگهی و فروشنده را کنار هم ببین تا وقتت را برای گزینه‌ی اشتباه نگذاری.
          </p>
        </div>

        {/* Phase 4: Return / Decision */}
        <div ref={phase4Ref} className="absolute top-0 right-0 left-0 text-white opacity-0">
          <div className="w-8 h-[2px] bg-[#E31C3D] mb-4" />
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tight leading-[1.2] mb-4 text-white">
            ماشین بعدی‌ات را <span className="text-[#E31C3D]">با عدد انتخاب کن</span>، نه با حدس.
          </h2>
          <p className="text-base sm:text-lg md:text-xl font-normal text-white/80 leading-relaxed max-w-lg">
            هر گزینه می‌تواند یک امتیاز فرصت خرید داشته باشد. ثبت‌نام اولیه رایگان است.
          </p>
        </div>

      </div>
    </div>
  );
}
