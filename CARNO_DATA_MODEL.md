# Carno Experience Data Model

This document defines the core data structures and configurations for the Carno Product Experience, establishing strict typing for performance and accessibility rules.

## Core Configuration Model

```typescript
export interface CarExperienceConfig {
  version: string;
  assetConfig: AssetConfig;
  storyConfig: StoryConfig;
  performanceSettings: PerformanceSettings;
  accessibilitySettings: AccessibilitySettings;
}

export interface AssetConfig {
  frameCount: number;
  basePath: string;
  extension: string; // e.g., 'webp'
  profiles: {
    mobile: AssetProfile;
    desktop: AssetProfile;
  };
}

export interface AssetProfile {
  id: 'mobile' | 'desktop';
  width: number;
  quality: number;
  directory: string;
}

export interface StoryConfig {
  phases: StoryPhase[]; // Imported from Story Contract
}

export interface PerformanceSettings {
  memoryMatrix: {
    lowMemoryMaxBitmaps: number; // e.g., 8 (for <=4GB devices)
    highMemoryMaxBitmaps: number; // e.g., 20 (for desktop/high-end)
    memoryThresholdGB: number; // e.g., 4
  };
  warmupSequence: number[]; // e.g., [1, 30, 60, 90, 120, 15, 45, 75, 105]
  fpsTarget: number; // e.g., 60
}

export interface AccessibilitySettings {
  prefersReducedMotion: {
    enabled: boolean;
    fallbackFrame: number; // High-value angle frame (e.g., 30 for Side Profile)
    animationStyle: 'fade' | 'none'; // Replaces spatial transforms
  };
}
```
