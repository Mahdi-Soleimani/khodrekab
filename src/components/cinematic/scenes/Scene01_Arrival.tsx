import React from 'react';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene01_Arrival({ progress, active }: SceneProps) {
  // Use a smooth ease for entrance
  const rawOpacity = active ? (progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1) : 0;
  const opacity = 1 - Math.pow(1 - rawOpacity, 3);
  
  const translateY = active ? 30 * (1 - Math.min(progress / 0.3, 1)) : 30;

  return (
    <div 
      className={`scene-overlay flex flex-col items-center justify-start pt-28 md:pt-32 px-6 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 1 }}
    >
      <div 
        className="text-center max-w-3xl"
        style={{ 
          opacity,
          transform: `translateY(${translateY}px)`,
          transition: 'transform 0.1s linear'
        }}
      >
        {/* Small red accent line */}
        <div className="w-8 h-[2px] bg-[#E31C3D] mx-auto mb-8" />
        
        <h1 className="text-4xl md:text-6xl lg:text-[4.5rem] font-black leading-[1.15] text-[#111111] tracking-tight">
          قبل از خرید خودرو،<br />
          <span className="text-[#E31C3D]">چیزی که نمی‌بینید</span> مهم‌تر است.
        </h1>
        
        <p className="mt-6 text-lg md:text-xl text-[#666666] font-normal leading-relaxed max-w-xl mx-auto">
          دستیار هوشمند تحلیل خودرو
        </p>
      </div>
      
      {/* Scroll Indicator */}
      <div 
        className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
        style={{ opacity, transition: 'opacity 0.3s ease-out' }}
      >
        <span className="text-[10px] tracking-widest text-[#999999] uppercase font-bold">بیشتر کاوش کنید</span>
        <div className="w-[1px] h-12 bg-gradient-to-b from-[#E31C3D] to-transparent animate-pulse" />
      </div>
    </div>
  );
}
