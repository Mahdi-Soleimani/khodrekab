'use client';

import React, { forwardRef } from 'react';

interface CarCanvasProps {
  className?: string;
}

export const CarCanvas = forwardRef<HTMLCanvasElement, CarCanvasProps>(
  ({ className = '' }, ref) => {
    return (
      <canvas
        ref={ref}
        className={`w-full h-full object-contain ${className}`}
        aria-label="Khodrekab 3D Vehicle Interactive Experience"
        role="img"
      >
        <p>Khodrekab 3D Interactive Vehicle. This content requires a modern browser with JavaScript enabled to view the interactive 3D rendering of the vehicle.</p>
      </canvas>
    );
  }
);

CarCanvas.displayName = 'CarCanvas';
