import React from 'react';

interface ScrollProgressProps {
  current: number;
  total: number;
}

export function ScrollProgress({ current, total }: ScrollProgressProps) {
  return (
    <div className="absolute bottom-8 left-8 z-50 flex flex-col items-center gap-4 text-xs font-mono text-[#999999] opacity-40 transition-opacity hover:opacity-80">
      <div className="flex flex-col items-center justify-center gap-1">
        <span>{(current).toString().padStart(2, '0')}</span>
        <div className="w-[1px] h-12 bg-[#E5E5E5] relative">
          <div 
            className="absolute top-0 left-0 w-full bg-[#E31C3D] transition-all duration-300"
            style={{ height: `${(current / total) * 100}%` }}
          />
        </div>
        <span>{(total).toString().padStart(2, '0')}</span>
      </div>
    </div>
  );
}
