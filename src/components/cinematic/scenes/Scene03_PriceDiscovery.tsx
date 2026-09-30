import React from 'react';
import { cinematicCalibration } from '../calibration';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene03_PriceDiscovery({ progress, active }: SceneProps) {
  const config = cinematicCalibration.scene03.marketIntelligence;
  
  const line1Progress = active && progress > 0.1 ? Math.min((progress - 0.1) / 0.15, 1) : 0;
  const line2Progress = active && progress > 0.35 ? Math.min((progress - 0.35) / 0.15, 1) : 0;
  const line3Progress = active && progress > 0.6 ? Math.min((progress - 0.6) / 0.15, 1) : 0;
  const fadeOut = active && progress > 0.9 ? (1 - progress) / 0.1 : 1;

  return (
    <div 
      className={`scene-overlay flex items-center px-6 md:px-16 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 3 }}
    >
      <div className="container relative h-full w-full">
        {/* Vertical Market Intelligence Annotation */}
        <div 
          className="absolute flex flex-col items-center"
          style={{
            top: config.top,
            left: config.left,
            opacity: fadeOut
          }}
        >
          {/* Annotation Box */}
          <div className="flex flex-col items-center bg-white/90 backdrop-blur-sm px-6 py-5 rounded-xl border border-white/50 shadow-sm z-10 w-64">
            <span className="text-[10px] md:text-xs tracking-widest text-[#999999] font-bold uppercase mb-4 w-full text-center border-b border-[#E5E5E5] pb-2">هوش بازار</span>
            
            {/* Listing Price */}
            <div 
              className="flex flex-col items-center w-full"
              style={{ opacity: line1Progress, transform: `translateY(${10 * (1 - line1Progress)}px)`, transition: 'all 0.4s ease-out' }}
            >
              <span className="text-[10px] md:text-xs text-[#666666] mb-1">قیمت آگهی</span>
              <span className="text-2xl md:text-3xl font-black text-[#111111] tabular-nums tracking-tight">۸۵۰ <span className="text-[10px] md:text-xs font-normal text-[#999999]">میلیون</span></span>
            </div>
            
            <div 
              className="w-[1px] h-6 bg-[#E5E5E5] my-2" 
              style={{ opacity: line2Progress, transition: 'opacity 0.4s ease-out' }}
            />
            
            {/* Real Value */}
            <div 
              className="flex flex-col items-center w-full"
              style={{ opacity: line2Progress, transform: `translateY(${10 * (1 - line2Progress)}px)`, transition: 'all 0.4s ease-out' }}
            >
              <span className="text-[10px] md:text-xs text-[#666666] mb-1">ارزش واقعی کارنو</span>
              <span className="text-2xl md:text-3xl font-black text-[#16a34a] tabular-nums tracking-tight">۷۸۰ <span className="text-[10px] md:text-xs font-normal text-[#16a34a]/60">میلیون</span></span>
            </div>
            
            {/* Delta */}
            <div 
              className="flex flex-col items-center w-full mt-4 pt-3 border-t border-[#E5E5E5]"
              style={{ opacity: line3Progress, transform: `translateY(${10 * (1 - line3Progress)}px)`, transition: 'all 0.4s ease-out' }}
            >
              <span className="text-[10px] md:text-xs text-[#666666] mb-1">اختلاف قیمت</span>
              <span className="text-xl md:text-2xl font-black text-[#E31C3D] tabular-nums tracking-tight">۷۰ میلیون</span>
            </div>
          </div>
          
          {/* Vertical Leader Line */}
          <div 
            className="w-[1px] bg-gradient-to-b from-[#111111]/40 to-[#111111]/10" 
            style={{ 
              height: config.lineH,
              transformOrigin: 'top',
              transform: `scaleY(${Math.min(progress / 0.2, 1)})`,
              transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }} 
          />
          
          {/* Anchor Point */}
          <div className="relative flex items-center justify-center" style={{ opacity: Math.min(progress / 0.1, 1), transition: 'opacity 0.3s' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-[#111111]" />
            <div className="absolute w-4 h-4 rounded-full border border-[#111111]/30" style={{ transform: `scale(${1 + Math.sin(progress * 10) * 0.2})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
