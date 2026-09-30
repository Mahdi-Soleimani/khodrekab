export enum ProtectionTier {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  CRITICAL = 4
}

export type MemoryProfile = 'low' | 'normal' | 'high';

export interface CacheEntry<T> {
  key: number;
  value: T;
  priority: ProtectionTier;
  lastAccess: number;
  insertedAt: number;
}

export interface CacheStatistics {
  currentSize: number;
  maxCapacity: number;
  memoryProfile: MemoryProfile;
  evictionCount: number;
}

export interface EvictionResult<K, V> {
  evictedKey: K | null;
  evictedValue: V | null;
  evictedPriority: number | null;
}
