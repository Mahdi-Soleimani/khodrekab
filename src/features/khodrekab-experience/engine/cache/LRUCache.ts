import { EvictionResult } from './types';

export class LRUNode<K, V> {
  key: K;
  value: V;
  priority: number;
  lastAccess: number;
  insertedAt: number;
  prev: LRUNode<K, V> | null = null;
  next: LRUNode<K, V> | null = null;

  constructor(key: K, value: V, priority: number) {
    this.key = key;
    this.value = value;
    this.priority = priority;
    const now = Date.now();
    this.lastAccess = now;
    this.insertedAt = now;
  }
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, LRUNode<K, V>>;
  private head: LRUNode<K, V> | null;
  private tail: LRUNode<K, V> | null;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = null;
    this.tail = null;
  }

  public get(key: K): V | null {
    const node = this.map.get(key);
    if (!node) return null;

    node.lastAccess = Date.now();
    this.moveToHead(node);
    return node.value;
  }

  public set(key: K, value: V, priority: number = 0): EvictionResult<K, V> {
    let node = this.map.get(key);
    let evicted: EvictionResult<K, V> = { evictedKey: null, evictedValue: null, evictedPriority: null };

    if (node) {
      node.value = value;
      node.priority = priority;
      node.lastAccess = Date.now();
      this.moveToHead(node);
    } else {
      node = new LRUNode(key, value, priority);
      this.map.set(key, node);
      this.addToHead(node);

      if (this.map.size > this.capacity) {
        evicted = this.evict();
      }
    }

    return evicted;
  }

  public delete(key: K): V | null {
    const node = this.map.get(key);
    if (!node) return null;

    this.removeNode(node);
    this.map.delete(key);
    return node.value;
  }

  public has(key: K): boolean {
    return this.map.has(key);
  }

  public getSize(): number {
    return this.map.size;
  }

  public getCapacity(): number {
    return this.capacity;
  }

  public clear(): V[] {
    const values: V[] = [];
    let current = this.head;
    while (current) {
      values.push(current.value);
      current = current.next;
    }
    this.map.clear();
    this.head = null;
    this.tail = null;
    return values;
  }

  public entries(): { key: K; value: V; priority: number }[] {
    const result: { key: K; value: V; priority: number }[] = [];
    let current = this.head;
    while (current) {
      result.push({ key: current.key, value: current.value, priority: current.priority });
      current = current.next;
    }
    return result;
  }

  private evict(): EvictionResult<K, V> {
    if (!this.tail) return { evictedKey: null, evictedValue: null, evictedPriority: null };

    let candidate = this.tail;
    let current: LRUNode<K, V> | null = this.tail;
    let lowestPriority = candidate.priority;

    while (current) {
      if (current.priority < lowestPriority) {
        candidate = current;
        lowestPriority = current.priority;
      }
      current = current.prev;
    }

    this.removeNode(candidate);
    this.map.delete(candidate.key);

    return {
      evictedKey: candidate.key,
      evictedValue: candidate.value,
      evictedPriority: candidate.priority
    };
  }

  private addToHead(node: LRUNode<K, V>): void {
    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LRUNode<K, V>): void {
    if (node === this.head) return;
    this.removeNode(node);
    this.addToHead(node);
  }
}
