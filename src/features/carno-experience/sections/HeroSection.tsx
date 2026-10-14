import React from 'react';
import { CarStoryOverlay } from './CarStoryOverlay';
import { CTASection } from './CTASection';

interface HeroSectionProps {
  children: React.ReactNode; // this will be the Canvas
}

export function HeroSection({ children }: HeroSectionProps) {
  return (
    <div className="sticky top-0 w-full h-[100vh] overflow-hidden flex items-center justify-center bg-black">
      <div className="relative w-full h-full max-w-[1600px] flex items-center justify-center">
        
        {/* Render the Khodrekab Canvas behind all overlays */}
        <div className="absolute inset-0 z-0 flex items-center justify-center">
          {children}
        </div>

        {/* Narrative Story Elements synced to scroll */}
        <CarStoryOverlay />

        {/* Bottom CTA Overlay */}
        <div className="absolute bottom-0 w-full z-30 pb-16 px-8 flex justify-center bg-gradient-to-t from-black via-black/50 to-transparent">
          <CTASection />
        </div>

      </div>
    </div>
  );
}
