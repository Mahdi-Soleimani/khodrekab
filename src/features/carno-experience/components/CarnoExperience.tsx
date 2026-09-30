'use client';

import React, { useRef, useCallback } from 'react';
import { useCarnoExperience } from '../hooks/useCarnoExperience';
import { CarCanvas } from './CarCanvas';
import { StoryScroller } from './StoryScroller';
import { HeroSection } from '../sections/HeroSection';
import { CarStoryOverlay } from '../sections/CarStoryOverlay';

export function CarnoExperience() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const { getController } = useCarnoExperience({ 
    canvasRef, 
    manifestPath: '/car-frames/v1/manifest.json' 
  });

  const handleProgressUpdate = useCallback((progress: number) => {
    const controller = getController();
    if (controller) {
      controller.updateProgress(progress);
    }
  }, [getController]);

  return (
    <div className="relative w-full bg-black text-white selection:bg-gray-800">
      
      {/* Scroll orchestration block. The container is 500vh tall to drive the narrative. */}
      <StoryScroller onProgressUpdate={handleProgressUpdate}>
        
        {/* Sticky Hero section stays in the viewport while the page scrolls */}
        <HeroSection>
          <CarCanvas ref={canvasRef} />
        </HeroSection>
        
      </StoryScroller>
    </div>
  );
}
