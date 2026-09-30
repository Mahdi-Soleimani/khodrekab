import React from 'react';
import { cinematicCalibration } from '../calibration';

interface SceneProps {
  progress: number;
  active: boolean;
}

export function Scene02_Curiosity({ progress, active }: SceneProps) {
  const config = cinematicCalibration.scene02.annotations;
  const annotations = [
    { title: 'تحلیل رنگ بدنه', detail: 'ضخامت‌سنجی دیجیتال', ...config[0] },
    { title: 'بررسی قطعات تعویضی', detail: 'شاسی و ستون‌ها', ...config[1] },
    { title: 'تشخیص سابقه پنهان', detail: 'استعلام یکپارچه', ...config[2] }
  ];
  
  const headlineOpacity = active ? (progress < 0.15 ? progress / 0.15 : progress > 0.85 ? (1 - progress) / 0.15 : 1) : 0;

  return (
    <div 
      className={`scene-overlay flex items-center px-6 md:px-16 transition-opacity duration-500 ${active ? 'opacity-100 active' : 'opacity-0'}`}
      style={{ zIndex: 2 }}
    >
      <div className="container relative h-full flex flex-col md:flex-row items-center">
        {/* Editorial headline — right side in RTL */}
        <div className="w-full md:w-2/5 pt-24 md:pt-0 z-10" style={{ opacity: headlineOpacity }}>
          <div className="w-6 h-[2px] bg-[#E31C3D] mb-6" />
          <h2 className="text-3xl md:text-5xl font-black leading-[1.2] text-[#111111] tracking-tight">
            ظاهر خودرو<br />
            همیشه حقیقت را<br />
            <span className="text-[#666666]">نشان نمی‌دهد.</span>
          </h2>
        </div>
        
        {/* Automotive Annotations — attached to physical vehicle positions */}
        <div className="absolute inset-0 pointer-events-none">
          {annotations.map((item, i) => {
            const itemStart = 0.2 + (i * 0.12);
            const rawProgress = active && progress > itemStart ? Math.min((progress - itemStart) / 0.15, 1) : 0;
            const itemProgress = 1 - Math.pow(1 - rawProgress, 3); // Cubic ease out
            
            const fadeOut = progress > 0.85 ? (1 - progress) / 0.15 : 1;
            
            return (
              <div 
                key={i}
                className="absolute flex flex-col items-center"
                style={{
                  top: item.top,
                  bottom: item.bottom,
                  left: item.left,
                  opacity: itemProgress * fadeOut,
                  transform: `translateY(${item.isUp ? 20 * (1 - itemProgress) : -20 * (1 - itemProgress)}px)`,
                  transition: 'opacity 0.3s ease-out, transform 0.3s ease-out'
                }}
              >
                {!item.isUp && (
                  <div className="flex flex-col items-center mb-2 text-center bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/50 shadow-sm">
                    <span className="text-[10px] md:text-xs font-bold text-[#111111] tracking-wide">{item.title}</span>
                    <span className="text-[9px] md:text-[10px] text-[#666666]">{item.detail}</span>
                  </div>
                )}
                
                {/* Vertical Leader Line */}
                <div 
                  className="w-[1px] bg-gradient-to-b from-[#E31C3D]/60 to-[#E31C3D]/10" 
                  style={{ 
                    height: item.lineH,
                    transformOrigin: item.isUp ? 'bottom' : 'top',
                    transform: `scaleY(${itemProgress})`,
                    transition: 'transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1)'
                  }} 
                />
                
                {/* Anchor Point */}
                <div className="relative flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E31C3D]" />
                  <div className="absolute w-4 h-4 rounded-full border border-[#E31C3D]/40" style={{ transform: `scale(${1 + Math.sin(progress * 10) * 0.2})` }} />
                </div>

                {item.isUp && (
                  <div className="flex flex-col items-center mt-2 text-center bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/50 shadow-sm">
                    <span className="text-[10px] md:text-xs font-bold text-[#111111] tracking-wide">{item.title}</span>
                    <span className="text-[9px] md:text-[10px] text-[#666666]">{item.detail}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
