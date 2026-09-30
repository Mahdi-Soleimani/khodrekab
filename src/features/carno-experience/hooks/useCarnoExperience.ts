import { useEffect, useRef, useCallback } from 'react';
import { AssetResolver } from '../engine/loader/AssetResolver';
import { FrameLoader } from '../engine/loader/FrameLoader';
import { LoadQueue } from '../engine/loader/LoadQueue';
import { BitmapCache } from '../engine/cache/BitmapCache';
import { CanvasRenderer } from '../engine/renderer/CanvasRenderer';
import { FrameController } from '../engine/renderer/FrameController';
import { CarnoManifest, LoadPriority } from '../engine/loader/types';
import { ProtectionTier } from '../engine/cache/types';

export const CarnoAnalytics = {
  track: (eventName: string, payload?: Record<string, any>) => {
    // Analytics abstraction, no direct library calls
    console.debug(`[Carno Analytics] ${eventName}`, payload);
  }
};

interface UseCarnoExperienceOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  manifestPath?: string;
}

export function useCarnoExperience({ canvasRef, manifestPath = '/car-frames/v1/manifest.json' }: UseCarnoExperienceOptions) {
  const engineRef = useRef<{
    cache: BitmapCache;
    renderer: CanvasRenderer;
    controller: FrameController;
    queue: LoadQueue;
    manifestVersion: string;
    frameCount: number;
    loadedFrames: Set<number>;
    keyframes: number[];
  } | null>(null);

  const initEngine = useCallback(async () => {
    if (!canvasRef.current || engineRef.current) return;

    try {
      CarnoAnalytics.track('car_asset_load_started', { profile: 'auto' });
      
      const response = await fetch(manifestPath);
      const manifest: CarnoManifest = await response.json();

      const resolver = new AssetResolver(manifest);
      const cache = new BitmapCache(manifest.frameCount);
      const loader = new FrameLoader();
      const queue = new LoadQueue({ loader, resolver, manifest, maxConcurrent: 4 });
      
      const controller = new FrameController(manifest.frameCount);
      const renderer = new CanvasRenderer(controller, cache);

      renderer.attachCanvas(canvasRef.current);
      
      const loadedFrames = new Set<number>();
      
      // Setup progressive loading using the architecture rules:
      // Priority 1: Hero (frame 1)
      queue.loadFrame({ frameNumber: manifest.defaultFrame, priority: LoadPriority.HERO, profileId: 'desktop' })
        .then(result => {
          cache.insert(result.frameNumber, result.bitmap as ImageBitmap, ProtectionTier.CRITICAL);
          loadedFrames.add(result.frameNumber);
          CarnoAnalytics.track('car_asset_first_frame_ready', { timeToFirstFrameMs: performance.now() });
        });

      // Priority 2: Keyframes
      manifest.keyframes.forEach(frame => {
        queue.loadFrame({ frameNumber: frame, priority: LoadPriority.KEYFRAMES, profileId: 'desktop' })
          .then(result => {
            cache.insert(result.frameNumber, result.bitmap as ImageBitmap, ProtectionTier.HIGH);
            loadedFrames.add(result.frameNumber);
          });
      });

      // Priority 3: Secondary Keyframes
      const secondaryKeyframes = [15, 45, 75, 105];
      secondaryKeyframes.forEach(frame => {
        if (frame <= manifest.frameCount && !manifest.keyframes.includes(frame)) {
          queue.loadFrame({ frameNumber: frame, priority: LoadPriority.SECONDARY_KEYFRAMES, profileId: 'desktop' })
            .then(result => {
              cache.insert(result.frameNumber, result.bitmap as ImageBitmap, ProtectionTier.NORMAL);
              loadedFrames.add(result.frameNumber);
            });
        }
      });

      // Priority 4: All other frames (Background loading for smooth 3D rotation)
      for (let i = 1; i <= manifest.frameCount; i++) {
        if (i !== manifest.defaultFrame && !manifest.keyframes.includes(i) && !secondaryKeyframes.includes(i)) {
          queue.loadFrame({ frameNumber: i, priority: LoadPriority.BACKGROUND, profileId: 'desktop' })
            .then(result => {
              cache.insert(result.frameNumber, result.bitmap as ImageBitmap, ProtectionTier.NORMAL);
              loadedFrames.add(result.frameNumber);
            });
        }
      }

      renderer.start();

      engineRef.current = {
        cache,
        renderer,
        controller,
        queue,
        manifestVersion: manifest.version,
        frameCount: manifest.frameCount,
        loadedFrames,
        keyframes: manifest.keyframes
      };

    } catch (err) {
      console.error('Carno Engine Initialization failed:', err);
    }
  }, [canvasRef, manifestPath]);

  useEffect(() => {
    initEngine();

    return () => {
      if (engineRef.current) {
        engineRef.current.renderer.stop();
        engineRef.current.cache.clear();
        engineRef.current = null;
      }
    };
  }, [initEngine]);

  const getDebugStats = useCallback(() => {
    if (!engineRef.current) return null;
    const { cache, controller, manifestVersion, frameCount, loadedFrames, keyframes } = engineRef.current;
    
    const frame = controller.getCurrentFrame();
    const progress = frame / frameCount;
    const cacheStats = cache.getStatistics();
    
    const loadedKeyframes = keyframes.filter(kf => loadedFrames.has(kf)).length;
    
    return {
      frame,
      progress: progress.toFixed(2),
      cacheSize: cacheStats.currentSize,
      cacheCapacity: cacheStats.maxCapacity,
      memoryProfile: cacheStats.memoryProfile,
      loadedFrames: loadedFrames.size,
      keyframesLoaded: loadedKeyframes,
      totalKeyframes: keyframes.length,
      fps: 60, // approximate constant target
      manifestVersion
    };
  }, []);

  return {
    getController: useCallback(() => engineRef.current?.controller, []),
    getDebugStats
  };
}
