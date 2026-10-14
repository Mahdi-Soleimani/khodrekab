import { LRUCache } from './LRUCache';
import { MemoryManager } from './MemoryManager';
import { ProtectionTier, CacheStatistics } from './types';

export class BitmapCache {
  private cache: LRUCache<number, ImageBitmap>;
  private evictionCount: number = 0;

  constructor(customCapacity?: number) {
    const capacity = customCapacity || MemoryManager.calculateCacheCapacity();
    this.cache = new LRUCache<number, ImageBitmap>(capacity);
  }

  public insert(frameNumber: number, bitmap: ImageBitmap, priority: ProtectionTier = ProtectionTier.NORMAL): void {
    if (frameNumber === 1) {
      console.log(`[BitmapCache] Inserting frame 1. Is valid ImageBitmap?`, bitmap instanceof ImageBitmap);
    }
    try {
      this.attemptInsert(frameNumber, bitmap, priority);
    } catch (e) {
      // GPU OOM or other error simulation
      MemoryManager.reportMemoryWarning(`BitmapDecodeMemoryError during insert of frame ${frameNumber}. Flushing low priority frames.`);
      this.flushLowPriority();
      try {
        // Retry once after flush
        this.attemptInsert(frameNumber, bitmap, priority);
      } catch (retryError) {
        this.safeCloseBitmap(bitmap); // Give up and release gracefully
      }
    }
  }

  public get(frameNumber: number): ImageBitmap | null {
    const bitmap = this.cache.get(frameNumber);
    if (frameNumber === 1 && bitmap) {
      console.log(`[BitmapCache] Frame 1 successfully retrieved from cache.`);
    }
    return bitmap;
  }

  public has(frameNumber: number): boolean {
    return this.cache.has(frameNumber);
  }

  public remove(frameNumber: number): void {
    const bitmap = this.cache.delete(frameNumber);
    if (bitmap) {
      this.safeCloseBitmap(bitmap);
    }
  }

  public clear(): void {
    const allBitmaps = this.cache.clear();
    for (const bitmap of allBitmaps) {
      this.safeCloseBitmap(bitmap);
    }
  }

  public getStatistics(): CacheStatistics {
    return {
      currentSize: this.cache.getSize(),
      maxCapacity: this.cache.getCapacity(),
      memoryProfile: MemoryManager.getMemoryProfile(),
      evictionCount: this.evictionCount
    };
  }

  private attemptInsert(frameNumber: number, bitmap: ImageBitmap, priority: ProtectionTier): void {
    const existing = this.cache.get(frameNumber);
    if (existing) {
      if (existing === bitmap) {
        // Same exact reference, just update priority and recency inside LRU
        this.cache.set(frameNumber, bitmap, priority);
        return;
      }
      // Overwrite happening, close the old reference safely
      this.safeCloseBitmap(existing);
    }

    const evictionResult = this.cache.set(frameNumber, bitmap, priority);

    if (evictionResult.evictedValue) {
      this.evictionCount++;
      
      if (evictionResult.evictedPriority === ProtectionTier.CRITICAL) {
        MemoryManager.reportMemoryWarning(`CacheOverflowWarning: CRITICAL frame ${evictionResult.evictedKey} evicted.`);
      }

      this.safeCloseBitmap(evictionResult.evictedValue);
    }
  }

  private flushLowPriority(): void {
    const entries = this.cache.entries();
    for (const entry of entries) {
      if (entry.priority === ProtectionTier.LOW || entry.priority === ProtectionTier.NORMAL) {
        this.remove(entry.key);
      }
    }
  }

  private safeCloseBitmap(bitmap: ImageBitmap): void {
    try {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    } catch (e) {
      // BitmapReleaseError: Swallowed safely to prevent breaking
    }
  }
}
