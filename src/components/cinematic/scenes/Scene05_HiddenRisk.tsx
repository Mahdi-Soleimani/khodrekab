import React from 'react';
import { cinematicCalibration } from '../calibration';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene05_HiddenRisk({ progress, active }: SceneProps) {
  
  const rawFadeIn = active ? (progress < 0.1 ? progress / 0.1 : 1) : 0;
  const fadeIn = 1 - Math.pow(1 - rawFadeIn, 3);
  
  const fadeOut = active && progress > 0.9 ? (1 - progress) / 0.1 : 1;
  const opacity = fadeIn * fadeOut;
  
  const config = cinematicCalibration.scene05.markers;
  const markers = [
    { title: 'ضخامت رنگ', detail: 'مشکوک به رنگ‌شدگی', delay: 0.15, ...config[0] },
    { title: 'شاسی و ستون', detail: 'نیاز به بررسی دقیق', delay: 0.35, ...config[1] },
    { title: 'قطعات تعویضی', detail: 'احتمال تعویض استوک', delay: 0.55, ...config[2] }
  ];

  return (
    <div 
      className={`scene-overlay flex items-center px-6 md:px-16 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 5 }}
    >
      <div className="container relative h-full w-full">
        
        {/* Precise Vertical Inspection Markers */}
        {markers.map((marker, i) => {
          const rawProgress = active && progress > marker.delay ? Math.min((progress - marker.delay) / 0.12, 1) : 0;
          const markerProgress = 1 - Math.pow(1 - rawProgress, 3); // Cubic ease out
          
          return (
            <div 
              key={i}
              className="absolute flex flex-col items-center"
              style={{
                top: marker.top,
                left: marker.right, // using right value for left as it was previously positioned from right
                opacity: markerProgress * fadeOut,
                transform: `translateY(${20 * (1 - markerProgress)}px)`,
                transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
              }}
            >
              {/* Vertical Leader Line */}
              <div 
                className="w-[1px] bg-gradient-to-b from-[#E31C3D]/60 to-[#E31C3D]/10" 
                style={{ 
                  height: marker.lineH,
                  transformOrigin: 'top',
                  transform: `scaleY(${markerProgress})`,
                  transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)'
                }} 
              />
              
              {/* Precise Anchor Point */}
              <div className="relative flex items-center justify-center">
                <div className="w-1.5 h-1.5 rounded-full bg-[#E31C3D]" />
                <div className="absolute w-4 h-4 rounded-full border border-[#E31C3D]/40" style={{ transform: `scale(${1 + Math.sin(progress * 10) * 0.2})` }} />
              </div>
              
              {/* Technical Label */}
              <div className="flex flex-col items-center mt-2 text-center bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-md border border-[#E31C3D]/20 shadow-sm">
                <span className="text-[10px] md:text-xs font-bold text-[#E31C3D] tracking-wide">{marker.title}</span>
                <span className="text-[9px] md:text-[10px] text-[#666666]">{marker.detail}</span>
              </div>
            </div>
          );
        })}

        {/* Bottom insight — editorial, not a dashboard alert card */}
        <div 
          className="absolute bottom-20 right-0 w-full md:w-2/5 pr-6 md:pr-0"
          style={{ opacity, transform: `translateY(${12 * (1 - fadeIn)}px)`, transition: 'all 0.4s ease-out' }}
        >
          <div className="w-10 h-[2px] bg-[#E31C3D] mb-5" />
          <h3 className="text-2xl md:text-3xl font-black text-[#111111] tracking-tight mb-3 leading-[1.3]">
            بی‌نقص به نظر می‌رسد،<br />
            اما شاید مشکلاتی را پنهان کند.
          </h3>
          <p className="text-base text-[#666666] leading-relaxed mt-2">
            کارنو ریسک‌های پنهان بدنه و فنی را پیش از خرید برای شما آشکار می‌کند.
          </p>
          {/* Risk indicator — thin, elegant */}
          <div className="mt-5 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[#E31C3D]" />
            <span className="text-sm font-bold text-[#E31C3D]">ریسک بالا</span>
          </div>
        </div>

      </div>
    </div>
  );
}
