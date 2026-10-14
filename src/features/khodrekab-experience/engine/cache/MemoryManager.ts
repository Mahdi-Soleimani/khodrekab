import { MemoryProfile } from './types';

export class MemoryManager {
  private static readonly FALLBACK_MEMORY_GB = 4;

  public static getDeviceMemory(): number {
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      return (navigator as any).deviceMemory as number;
    }
    return this.FALLBACK_MEMORY_GB;
  }

  public static getMemoryProfile(): MemoryProfile {
    const mem = this.getDeviceMemory();
    if (mem <= 4) return 'low';
    if (mem <= 8) return 'normal';
    return 'high';
  }

  public static calculateCacheCapacity(): number {
    const profile = this.getMemoryProfile();
    switch (profile) {
      case 'low':
        return 8;
      case 'normal':
        return 12;
      case 'high':
        return 20;
      default:
        return 8;
    }
  }

  public static shouldEvict(currentSize: number, capacity: number): boolean {
    return currentSize >= capacity;
  }

  public static reportMemoryWarning(details: string): void {
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('car_memory_warning', { detail: { message: details } })
        );
      }
    } catch (e) {
      // Swallowed safely to prevent breaking the experience
    }
  }
}
