# PHASE 4: BITMAP CACHE + MEMORY MANAGER IMPLEMENTATION PLAN

## 1. Files To Create
The cache engine will be implemented strictly within `src/features/carno-experience/engine/cache/`:

- **`types.ts`**
  - **Responsibility:** Defines typescript interfaces for Cache entries, Eviction policies, Memory profiles, and Protection tiers.
  - **Restriction:** Must not contain executable logic or class instances.

- **`LRUCache.ts`**
  - **Responsibility:** Pure data structure class managing tracking of item recency and enforcing capacity.
  - **Restriction:** Must be generic and completely unaware of ImageBitmaps or DOM APIs.

- **`MemoryManager.ts`**
  - **Responsibility:** Evaluates `navigator.deviceMemory`, determines the maximum safe cache size, and monitors memory pressure events.
  - **Restriction:** Must not store or delete Bitmaps directly; it only provides rules and thresholds to the `BitmapCache`.

- **`BitmapCache.ts`**
  - **Responsibility:** The core orchestrator. Integrates `LRUCache`, `MemoryManager`, and applies Keyframe Protection logic. Owns the full lifecycle of `ImageBitmap` objects, guaranteeing `bitmap.close()` on eviction.
  - **Restriction:** Must not fetch assets (Loader's job) and must not draw to Canvas (Renderer's job).

- **`index.ts`**
  - **Responsibility:** Public API export boundary for the cache module.
  - **Restriction:** Do not expose internal classes like `LRUCache`.

## 2. BitmapCache Architecture

**Responsibilities:**
- Store `ImageBitmap` references associated with `frameNumber`.
- Deliver instantaneous reads for Canvas via `cache.get(frame)`.
- Track access time and update LRU order on every read/write.
- Enforce Keyframe eviction protection.
- Release GPU memory correctly via `bitmap.close()`.

**Key Strategy:**
- **Cache Key:** Raw frame number (e.g., `30`).
- **Lookup Strategy:** `O(1)` Map retrieval, paired with updating the LRU node to "most recently used".
- **Hit/Miss Behavior:**
  - *Hit:* Returns the `ImageBitmap` and promotes it to newest.
  - *Miss:* Returns `null` immediately without blocking (Signals renderer to use fallback).
- **Duplicate Prevention:** If a frame is requested for caching but already exists, the old reference is overwritten (after closing the old bitmap) or ignored.

**Mandatory Lifecycle Rule:**
When an item is evicted from `LRUCache`, `BitmapCache` MUST intercept the dropped item and immediately call `bitmap.close()` to release GPU memory.

## 3. Dynamic LRU Policy

**Algorithm:**
A specialized Least Recently Used (LRU) algorithm using a Double-Linked List + Hash Map for `O(1)` operations, customized to respect protection tiers.

**Dynamic Capacities:**
- **`<= 4GB` device:** Maximum 8 `ImageBitmaps`.
- **Normal devices (4-8GB):** Maximum 12 `ImageBitmaps`.
- **High-end desktop (`> 8GB`):** Maximum 20 `ImageBitmaps`.

**Eviction Flow:**
When `insert(frame, bitmap)` is called and the cache is at capacity, the algorithm identifies the *least recently used* node. Before eviction, it evaluates the protection policy. If unprotected, it evicts the node and frees memory. If protected, it skips to the next candidate.

## 4. Keyframe Protection Strategy

Story-critical frames defined in the manifest (`[1, 30, 60, 90, 120]`) must not be evicted during normal user scrubbing, as they anchor the narrative.

**Priority Levels:**
- **CRITICAL**: Hero + Story Keyframes (Never evicted unless explicit cache destruction).
- **HIGH**: Secondary warmup frames (Evicted only under extreme memory pressure).
- **NORMAL**: Nearby scroll frames (Standard LRU eviction).
- **LOW**: Background/idle frames (First to be evicted).

**Protection Resolution:**
If the cache is full and the least-recently-used item is `CRITICAL`, the LRU algorithm will skip it and evict the *next* least-recently-used item that is `NORMAL` or `LOW`.

## 5. MemoryManager Design

**Responsibilities:**
- Detect device capability securely.
- Calculate dynamic cache size limits.
- Monitor memory pressure and report warnings.

**Inputs:**
- Reads `navigator.deviceMemory`.
- **Fallback:** If `deviceMemory` is unavailable (e.g., Safari/Firefox privacy restrictions), it conservatively assumes a `4GB` environment.

**Conceptual Methods:**
- `getMemoryProfile()`: Returns `'low' | 'normal' | 'high'`.
- `calculateCacheCapacity()`: Returns the exact integer capacity limit based on the profile.
- `shouldEvict(currentSize)`: Returns boolean indicating if pressure requires cleanup.
- `reportMemoryWarning()`: Dispatches analytics event `car_memory_warning` if limits are violently exceeded.

## 6. Loader ↔ Cache Integration

**Data Flow:**
```text
[LoadQueue] Priority job executes
        ↓
[FrameLoader] fetch() & createImageBitmap()
        ↓
[ImageBitmap] Promise resolved and returned to Engine Orchestrator
        ↓
[BitmapCache.insert(frame, bitmap)] Cache takes ownership
        ↓
[CanvasRenderer] requestAnimationFrame tick
        ↓
[BitmapCache.get(frame)] O(1) synchronous read
```

**Ownership Boundaries:**
- **Loader:** Owns downloading bytes and decoding GPU bitmaps.
- **Cache:** Owns memory retention, LRU tracking, and explicit bitmap destruction (`close()`).
- **Renderer:** Owns `ctx.drawImage()`. Has zero ownership over memory.

## 7. Canvas Renderer Contract

The Renderer is completely decoupled from memory management and networking.

**Renderer Expectations:**
- Asks: "Give me frame X".
- Expects an instantaneous synchronous return (`ImageBitmap` or `null`).

**Fallback Behavior if `null` is returned:**
1. Try Target Frame (`cache.get(X)`).
2. If `null`, try Nearby Loaded Frame (`cache.get(X-1)` or `cache.get(X+1)`).
3. If `null`, try Nearest Keyframe (`cache.get(nearestKeyframe)`).
4. If `null`, fallback to Previous Displayed Frame (re-render last successful draw).

## 8. Memory Safety Rules

- **RULE 1:** Never keep unlimited `ImageBitmaps`. Capacity limits are absolute.
- **RULE 2:** Never remove a bitmap without synchronously calling `bitmap.close()`.
- **RULE 3:** Never duplicate the same frame index in memory. Overwrite and close the old instance.
- **RULE 4:** Never allow the Loader to retain ownership or references to the resolved Bitmap.
- **RULE 5:** Never link Cache state to React `useState`. React re-renders are fundamentally incompatible with 60FPS memory management.

## 9. Error Handling Strategy

- `CacheOverflowWarning`:
  - **Trigger:** Capacity hit, but all LRU candidates are `CRITICAL` frames.
  - **Handler:** MemoryManager drops a `CRITICAL` frame as a last resort to prevent total crash, fires analytics. Non-fatal.
- `BitmapDecodeMemoryError`:
  - **Trigger:** GPU out of memory during `insert()`.
  - **Handler:** Catches error, flushes all `NORMAL` and `LOW` tier frames, retries. Recoverable.
- `BitmapReleaseError`:
  - **Trigger:** Calling `close()` on a corrupted or already-closed bitmap.
  - **Handler:** Swallowed safely. Non-fatal.
- `UnsupportedMemoryAPIWarning`:
  - **Trigger:** `navigator.deviceMemory` unavailable.
  - **Handler:** MemoryManager falls back to <=4GB profile (8 Bitmaps). Non-fatal.

## 10. Testing Strategy

Architecture-level testing requirements (Conceptual):

### Insert Test
- **Action:** Insert frame 30.
- **Expected:** `cache.has(30)` is true. `cache.get(30)` returns the bitmap and updates LRU recency.

### Eviction Test
- **Action:** Capacity = 8. Insert 9 distinct `NORMAL` frames sequentially.
- **Expected:** Frame 1 (the first inserted) is removed. The cache size remains exactly 8.

### Protection Test
- **Action:** Capacity = 8. Cache contains 2 `CRITICAL` frames and 6 `NORMAL` frames. Insert a new `NORMAL` frame.
- **Expected:** The oldest `NORMAL` frame is evicted. The 2 `CRITICAL` frames survive, even if they are the oldest items in the cache.

### Memory Release Test
- **Action:** Force eviction of frame X.
- **Expected:** The `close()` method is explicitly and synchronously called on the `ImageBitmap` payload of frame X.

---

## 11. FINAL REVIEW CHECKLIST
✅ Cache owns ImageBitmap lifecycle  
✅ Loader remains memory-unaware  
✅ Renderer remains cache-unaware  
✅ Keyframes cannot disappear accidentally  
✅ Mobile Safari OOM risk is addressed  
✅ No React dependency  
✅ No UI logic  
✅ No hardcoded asset paths  
✅ Architecture is ready for TypeScript implementation  
