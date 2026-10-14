'use client';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CarCanvas } from './CarCanvas';
import { Scene01_Arrival } from './scenes/Scene01_Arrival';
import { Scene02_Curiosity } from './scenes/Scene02_Curiosity';
import { Scene03_PriceDiscovery } from './scenes/Scene03_PriceDiscovery';
import { Scene04_Opportunity } from './scenes/Scene04_Opportunity';
import { Scene05_HiddenRisk } from './scenes/Scene05_HiddenRisk';
import { Scene06_ProductReveal } from './scenes/Scene06_ProductReveal';
import { ScrollProgress } from './ScrollProgress';

// Register ScrollTrigger
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

export function CinematicStory() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [carProgress, setCarProgress] = useState(0);
  const [activeScene, setActiveScene] = useState(0);
  const [sceneProgresses, setSceneProgresses] = useState([0, 0, 0, 0, 0, 0]);

  useEffect(() => {
    if (!containerRef.current || !viewportRef.current) return;
    
    // Check for reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      // Just show the first scene and exit
      setActiveScene(0);
      setCarProgress(0);
      return;
    }

    const totalScenes = 6;
    
    // We create one master ScrollTrigger that pins the viewport
    const st = ScrollTrigger.create({
      trigger: containerRef.current,
      start: 'top top',
      end: `+=${totalScenes * 100}%`,
      pin: viewportRef.current,
      scrub: 1, // Smooth scrubbing
      onUpdate: (self) => {
        const p = self.progress;
        setCarProgress(p);
        
        // Determine active scene based on overall progress
        // scene 1: 0 - 0.166
        // scene 2: 0.166 - 0.333 ...
        const sceneIndex = Math.min(Math.floor(p * totalScenes), totalScenes - 1);
        setActiveScene(sceneIndex);

        // Calculate progress within the current scene (0.0 to 1.0)
        const newSceneProgresses = [0, 0, 0, 0, 0, 0];
        
        for (let i = 0; i < totalScenes; i++) {
          const sceneStart = i / totalScenes;
          const sceneEnd = (i + 1) / totalScenes;
          
          if (p < sceneStart) {
            newSceneProgresses[i] = 0;
          } else if (p > sceneEnd) {
            newSceneProgresses[i] = 1;
          } else {
            newSceneProgresses[i] = (p - sceneStart) / (sceneEnd - sceneStart);
          }
        }
        
        setSceneProgresses(newSceneProgresses);
      }
    });

    return () => {
      st.kill();
    };
  }, []);

  return (
    <section ref={containerRef} className="cinematic-container relative bg-white">
      {/* This element gets pinned by GSAP */}
      <div ref={viewportRef} className="cinematic-viewport w-full h-screen relative overflow-hidden">
        
        {/* The Car - Always present */}
        <div className="absolute inset-0 z-10 pointer-events-none">
          <CarCanvas progress={carProgress} totalFrames={120} />
        </div>

        {/* Scene Overlays */}
        <div className="absolute inset-0 z-20">
          <Scene01_Arrival active={activeScene === 0} progress={sceneProgresses[0]} />
          <Scene02_Curiosity active={activeScene === 1} progress={sceneProgresses[1]} />
          <Scene03_PriceDiscovery active={activeScene === 2} progress={sceneProgresses[2]} />
          <Scene04_Opportunity active={activeScene === 3} progress={sceneProgresses[3]} />
          <Scene05_HiddenRisk active={activeScene === 4} progress={sceneProgresses[4]} />
          <Scene06_ProductReveal active={activeScene === 5} progress={sceneProgresses[5]} />
        </div>

        {/* Global Progress Indicator */}
        <ScrollProgress current={activeScene + 1} total={7} />
      </div>
    </section>
  );
}
