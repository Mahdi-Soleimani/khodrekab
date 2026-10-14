'use client';
import { useState, useEffect, useRef } from 'react';

export function useImageSequence(frameCount: number, framePath: (index: number) => string) {
  const [images, setImages] = useState<(HTMLImageElement | null)[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    // Prevent SSR issues
    if (typeof window === 'undefined') return;

    const loadedImages: (HTMLImageElement | null)[] = new Array(frameCount).fill(null);
    let count = 0;

    const loadImage = (index: number) => {
      const img = new Image();
      img.src = framePath(index);
      img.onload = () => {
        loadedImages[index] = img;
        count++;
        setLoadedCount(count);
        // Only update state after first batch or when fully loaded to prevent too many re-renders
        if (count === 1 || count === 10 || count === frameCount) {
          setImages([...loadedImages]);
        }
      };
      img.onerror = () => {
        console.error(`Failed to load image at index ${index}`);
      };
    };

    // Priority loading: load first frame, then 10 evenly spaced frames, then the rest
    loadImage(0);
    
    // Quick load 10 spaced frames
    for (let i = 1; i < 10; i++) {
      const idx = Math.floor((i / 10) * frameCount);
      if (idx !== 0) loadImage(idx);
    }

    // Load remaining frames
    for (let i = 1; i < frameCount; i++) {
      if (!loadedImages[i] && !loadedImages.includes(loadedImages[i])) {
        // Simple queue simulation
        setTimeout(() => {
          loadImage(i);
        }, i * 10);
      }
    }

    return () => {
      // Cleanup not strictly necessary here, but good practice
      loadedImages.forEach(img => {
        if (img) img.src = '';
      });
    };
  }, [frameCount, framePath]);

  return { images, loadedCount, progress: loadedCount / frameCount };
}
