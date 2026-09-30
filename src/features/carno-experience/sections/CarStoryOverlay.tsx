'use client';

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export function CarStoryOverlay() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const discoverRef = useRef<HTMLDivElement>(null);
  const techRef = useRef<HTMLDivElement>(null);
  const perfRef = useRef<HTMLDivElement>(null);
  const futureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // This animation uses GSAP's scroll trigger directly linked to the body scroll
    // without using React state or triggering re-renders
    const timeline = gsap.timeline({
      scrollTrigger: {
        trigger: '#carno-story-container', // The 500vh container
        start: 'top top',
        end: 'bottom bottom',
        scrub: true,
      }
    });

    // We assume total scroll duration is 400% of viewport
    // 0-25%: Discover
    // 25-50%: Technology
    // 50-75%: Performance
    // 75-100%: Future

    // Setup initial states
    gsap.set([discoverRef.current, techRef.current, perfRef.current, futureRef.current], { opacity: 0, y: 20 });
    
    // Discover Phase (0 to 25%)
    timeline
      .to(discoverRef.current, { opacity: 1, y: 0, duration: 0.1 })
      .to(discoverRef.current, { opacity: 0, y: -20, duration: 0.1 }, 0.2)
      
      // Technology Phase (25% to 50%)
      .to(techRef.current, { opacity: 1, y: 0, duration: 0.1 }, 0.3)
      .to(techRef.current, { opacity: 0, y: -20, duration: 0.1 }, 0.45)
      
      // Performance Phase (50% to 75%)
      .to(perfRef.current, { opacity: 1, y: 0, duration: 0.1 }, 0.55)
      .to(perfRef.current, { opacity: 0, y: -20, duration: 0.1 }, 0.7)
      
      // Future Phase (75% to 100%)
      .to(futureRef.current, { opacity: 1, y: 0, duration: 0.1 }, 0.8)
      .to(futureRef.current, { opacity: 0, y: -20, duration: 0.1 }, 0.95);

    return () => {
      timeline.kill();
    };
  }, []);

  return (
    <div ref={overlayRef} className="absolute inset-0 pointer-events-none z-20 flex items-center justify-start px-8 md:px-24">
      {/* Container for all text milestones, kept absolute so it doesn't shift layout */}
      <div className="relative w-full max-w-lg h-64 mt-[-20%]">
        
        {/* Discover */}
        <div ref={discoverRef} className="absolute top-0 left-0 text-white">
          <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-4">کشف زیبایی</h2>
          <p className="text-lg md:text-xl font-light opacity-70 leading-relaxed">
            طراحی فراتر از زمان. خطوط آیرودینامیک که هوا را می‌شکافند و چشم‌ها را خیره می‌کنند.
          </p>
        </div>

        {/* Technology */}
        <div ref={techRef} className="absolute top-0 left-0 text-white">
          <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-4">فناوری فردا</h2>
          <p className="text-lg md:text-xl font-light opacity-70 leading-relaxed">
            سیستم هوشمند رانندگی. متصل به دنیای اطراف، برای تجربه‌ای امن‌تر و بی‌نقص‌تر.
          </p>
        </div>

        {/* Performance */}
        <div ref={perfRef} className="absolute top-0 left-0 text-white">
          <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-4">قدرت بی‌نهایت</h2>
          <p className="text-lg md:text-xl font-light opacity-70 leading-relaxed">
            شتاب صفر تا صد در کسری از ثانیه. قدرت الکتریکی خالص که با هر لمس پدال آزاد می‌شود.
          </p>
        </div>

        {/* Future */}
        <div ref={futureRef} className="absolute top-0 left-0 text-white">
          <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-4">آینده اینجاست</h2>
          <p className="text-lg md:text-xl font-light opacity-70 leading-relaxed">
            آماده ورود به نسل جدید خودروهای الکتریکی هستید؟ همین حالا قدم به آینده بگذارید.
          </p>
        </div>

      </div>
    </div>
  );
}
