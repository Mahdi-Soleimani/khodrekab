import React from 'react';
import { cinematicCalibration } from '../calibration';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene04_Opportunity({ progress, active }: SceneProps) {
  const config = cinematicCalibration.scene04.opportunityScore;
  
  const opacity = active ? (progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1) : 0;
  const scoreProgress = active ? Math.min(progress / 0.5, 1) : 0;
  const displayScore = Math.round(92 * scoreProgress);
  
  // SVG arc for the score ring
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - (scoreProgress * 0.92));

  return (
    <div 
      className={`scene-overlay flex items-center px-6 md:px-24 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 4 }}
    >
      <div className="container relative h-full w-full">
        {/* Spatial Assessment Indicator */}
        <div 
          className="absolute flex flex-col items-center"
          style={{
            top: config.top,
            left: config.left,
            opacity,
            transform: `translateY(${20 * (1 - Math.min(progress / 0.3, 1))}px)`,
            transition: 'opacity 0.4s ease-out, transform 0.4s ease-out'
          }}
        >
          {/* Assessment Data */}
          <div className="flex flex-col items-center text-center bg-white/90 backdrop-blur-sm px-6 py-4 rounded-xl border border-white/50 shadow-sm z-10">
            <span className="text-[10px] md:text-xs tracking-widest text-[#999999] font-bold mb-1">امتیاز فرصت خرید</span>
            <span className="text-5xl md:text-6xl font-black text-[#111111] tabular-nums tracking-tighter leading-none mb-1">
              {displayScore}<span className="text-2xl text-[#999999]">/100</span>
            </span>
            <span className="text-sm font-bold text-[#16a34a]">توصیه به خرید</span>
            <div className="w-full h-[1px] bg-[#E5E5E5] my-2" />
            <span className="text-[10px] md:text-xs text-[#666666]">مبتنی بر تحلیل هوش مصنوعی</span>
          </div>
          
          {/* Vertical Leader Line */}
          <div 
            className="w-[1px] bg-gradient-to-b from-[#111111]/40 to-[#111111]/10" 
            style={{ 
              height: config.lineH,
              transformOrigin: 'top',
              transform: `scaleY(${Math.min(progress / 0.3, 1)})`,
              transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }} 
          />
          
          {/* Precise Anchor Point */}
          <div className="relative flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#111111]" />
            <div className="absolute w-5 h-5 rounded-full border border-[#111111]/30" style={{ transform: `scale(${1 + Math.sin(progress * 10) * 0.15})` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
