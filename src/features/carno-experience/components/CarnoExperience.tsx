'use client';

import React, { useRef, useCallback, useState } from 'react';
import { useCarnoExperience } from '../hooks/useCarnoExperience';
import { CarCanvas } from './CarCanvas';
import { StoryScroller } from './StoryScroller';
import { HeroSection } from '../sections/HeroSection';
import { POSTER_ASSETS } from '../delivery/assetProfile';
import type { HandoffState } from '../delivery/ExperienceSession';

export function CarnoExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPosterVisible, setIsPosterVisible] = useState(true);

  const handleHandoff = useCallback((state: HandoffState) => {
    if (state === 'done') {
      setIsPosterVisible(false);
    }
  }, []);

  const { setProgress } = useCarnoExperience({ 
    canvasRef, 
    manifestPath: '/car-frames/v1/manifest.json',
    onHandoff: handleHandoff,
  });

  const handleProgressUpdate = useCallback((progress: number) => {
    setProgress(progress);
  }, [setProgress]);

  return (
    <div className="relative w-full bg-black text-white selection:bg-gray-800">
      
      {/* Scroll orchestration block. The container is 500vh tall to drive the narrative. */}
      <StoryScroller onProgressUpdate={handleProgressUpdate}>
        
        {/* Sticky Hero section stays in the viewport while the page scrolls */}
        <HeroSection>
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Server-renderable poster: frame 1 discovery in initial HTML for mobile and desktop */}
            <picture
              className={`absolute inset-0 w-full h-full flex items-center justify-center pointer-events-none z-0 transition-opacity duration-300 ${
                isPosterVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <source
                media="(max-width: 767px)"
                srcSet={POSTER_ASSETS.mobile.src}
                width={POSTER_ASSETS.mobile.width}
                height={POSTER_ASSETS.mobile.height}
              />
              <img
                src={POSTER_ASSETS.desktop.src}
                alt="خودرکاب - پیش‌نمایش خودرو"
                width={POSTER_ASSETS.desktop.width}
                height={POSTER_ASSETS.desktop.height}
                loading="eager"
                // @ts-expect-error fetchpriority modern HTML attribute
                fetchpriority="high"
                decoding="async"
                className="w-full h-full object-contain"
              />
            </picture>

            <CarCanvas ref={canvasRef} className="relative z-10" />
          </div>
        </HeroSection>
        
      </StoryScroller>
    </div>
  );
}
