'use client';
import { useRef, useEffect } from 'react';
import { useImageSequence } from '@/hooks/useImageSequence';

interface CarCanvasProps {
  progress: number;
  totalFrames?: number;
  className?: string;
}

export function CarCanvas({ progress, totalFrames = 120, className = '' }: CarCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use .webp for final cinematic sequence
  const getFramePath = (index: number) => `/car-frames/frame-${(index + 1).toString().padStart(3, '0')}.webp`;
  
  const { images } = useImageSequence(totalFrames, getFramePath);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate current frame index based on progress (0.0 to 1.0)
    let frameIndex = Math.floor(progress * (totalFrames - 1));
    if (frameIndex < 0) frameIndex = 0;
    if (frameIndex >= totalFrames) frameIndex = totalFrames - 1;

    // Find the closest loaded image if the exact one isn't ready
    let targetImage = images[frameIndex];
    
    // Fallback if the specific frame isn't loaded yet
    if (!targetImage) {
      // Look backwards
      for (let i = frameIndex - 1; i >= 0; i--) {
        if (images[i]) {
          targetImage = images[i];
          break;
        }
      }
      // If still not found, look forwards
      if (!targetImage) {
        for (let i = frameIndex + 1; i < totalFrames; i++) {
          if (images[i]) {
            targetImage = images[i];
            break;
          }
        }
      }
    }

    if (targetImage) {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Calculate aspect ratio to fit/cover
      const canvasRatio = canvas.width / canvas.height;
      const imgRatio = targetImage.width / targetImage.height;
      
      let drawWidth = canvas.width;
      let drawHeight = canvas.height;
      let offsetX = 0;
      let offsetY = 0;

      // Object-fit: contain (or cover depending on desired look)
      // Here we'll use 'contain' logic to ensure the whole car is visible
      if (canvasRatio > imgRatio) {
        drawWidth = canvas.height * imgRatio;
        offsetX = (canvas.width - drawWidth) / 2;
      } else {
        drawHeight = canvas.width / imgRatio;
        offsetY = (canvas.height - drawHeight) / 2;
      }

      ctx.drawImage(targetImage, offsetX, offsetY, drawWidth, drawHeight);
    }
  }, [progress, images, totalFrames]);

  return (
    <canvas
      ref={canvasRef}
      width={1920}
      height={1080}
      className={`w-full h-full object-contain ${className}`}
      style={{ willChange: 'transform' }}
    />
  );
}
