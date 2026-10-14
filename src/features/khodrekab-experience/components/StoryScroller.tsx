'use client';

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import { KhodrekabAnalytics } from '../hooks/useKhodrekabExperience';

if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);
}

// Minimal implementation of the state machine
type MachineState = 'ENTRY' | 'DISCOVERY' | 'INSPECTION' | 'RISK_REVEAL' | 'SOLUTION' | 'CTA_COMPLETE';

interface StoryPhase {
  id: MachineState;
  threshold: number;
}

const PHASES: StoryPhase[] = [
  { id: 'SOLUTION', threshold: 0.75 },
  { id: 'RISK_REVEAL', threshold: 0.5 },
  { id: 'INSPECTION', threshold: 0.25 },
  { id: 'DISCOVERY', threshold: 0.1 },
  { id: 'ENTRY', threshold: 0 },
];

interface StoryScrollerProps {
  children: React.ReactNode;
  onProgressUpdate?: (progress: number) => void;
}

export function StoryScroller({ children, onProgressUpdate }: StoryScrollerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentState = useRef<MachineState>('ENTRY');

  useEffect(() => {
    if (!containerRef.current) return;

    const st = ScrollTrigger.create({
      trigger: containerRef.current,
      start: 'top top',
      end: 'bottom bottom', // Assumes parent has height (e.g. 500vh)
      scrub: true,
      onUpdate: (self) => {
        const progress = self.progress;

        // Pass to engine without triggering React re-renders
        if (onProgressUpdate) {
          onProgressUpdate(progress);
        }

        // State Machine transition check
        const currentPhase = PHASES.find(p => progress >= p.threshold)?.id || 'ENTRY';
        
        if (currentPhase !== currentState.current) {
          currentState.current = currentPhase;
          
          KhodrekabAnalytics.track('car_story_phase_view', { phaseId: currentPhase });
          KhodrekabAnalytics.track('car_story_phase_reached', { phaseId: currentPhase });
          
          // Additional specific analytics based on the contract
          if (currentPhase === 'SOLUTION') {
            KhodrekabAnalytics.track('cta_visible', { ctaType: 'primary' });
          }
        }

        // Depth tracking
        const depthMilestones = [0.25, 0.5, 0.75, 1.0];
        depthMilestones.forEach(depth => {
          if (progress >= depth && !containerRef.current?.dataset[`depth_${depth}`]) {
            if (containerRef.current) containerRef.current.dataset[`depth_${depth}`] = 'true';
            KhodrekabAnalytics.track('car_scroll_depth', { depth });
            
            if (depth === 1.0) {
              KhodrekabAnalytics.track('experience_completed', { status: 'success' });
            }
          }
        });
      }
    });

    return () => {
      st.kill();
    };
  }, [onProgressUpdate]);

  return (
    <div id="khodrekab-story-container" ref={containerRef} className="relative w-full h-[500vh]">
      {children}
    </div>
  );
}
