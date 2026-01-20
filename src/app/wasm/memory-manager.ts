import { Injectable, signal, computed, type Signal } from '@angular/core';
import {
  type MemoryBlock,
  type MemoryPoolConfig,
  type TypedArray,
  type TypedArrayConstructor,
  type WasmBackedArray,
  type WasmExports,
  type WasmMetrics,
  WasmError,
  WasmErrorCode,
} from './types';

const DEFAULT_CONFIG: MemoryPoolConfig = {
  initialPages: 256, // 16MB
  maxPages: 16384, // 1GB max
  enableTracking: true,
  autoGrow: true,
};

const BYTES_PER_PAGE = 65536; // 64KB per WebAssembly page
const RESERVED_BYTES = 65536; // First 64KB reserved

/**
 * WASM Memory Manager
 * Handles allocation, deallocation, and lifecycle of WASM memory
 */
@Injectable({ providedIn: 'root' })
export class WasmMemoryManager {
  private wasm: WasmExports | null = null;
  private config = DEFAULT_CONFIG;
  private allocations = new Map<number, MemoryBlock>();
  private freeList: MemoryBlock[] = [];

  // Reactive state
  private readonly _metrics = signal<WasmMetrics>({
    totalAllocations: 0,
    totalDeallocations: 0,
    peakMemoryUsage: 0,
    currentMemoryUsage: 0,
    totalComputeTimeMs: 0,
    operationCounts: {},
  });

  readonly metrics: Signal<WasmMetrics> = this._metrics.asReadonly();

  readonly memoryUsagePercent = computed(() => {
    if (!this.wasm) return 0;
    const total = this.wasm.memory.buffer.byteLength;
    const used = this._metrics().currentMemoryUsage + RESERVED_BYTES;
    return Math.round((used / total) * 100);
  });

  readonly isInitialized = computed(() => this.wasm !== null);

  /**
   * Initialize with WASM instance
   */
  initialize(wasm: WasmExports, config?: Partial<MemoryPoolConfig>): void {
    this.wasm = wasm;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.allocations.clear();
    this.freeList = [];
    this.resetMetrics();
  }

  /**
   * Allocate memory for a typed array
   */
  allocate<T extends TypedArray>(
    Constructor: TypedArrayConstructor<T>,
    length: number,
    label?: string
  ): WasmBackedArray<T> {
    const wasm = this.getWasm();

    const bytesNeeded = length * Constructor.BYTES_PER_ELEMENT;

    // Try to find a suitable block in free list
    let ptr = this.findFreeBlock(bytesNeeded);

    if (ptr === -1) {
      // Need to allocate new memory
      this.ensureCapacity(bytesNeeded);
      ptr = wasm.allocate(bytesNeeded);

      if (ptr === 0 && bytesNeeded > 0) {
        throw new WasmError(
          `Failed to allocate ${bytesNeeded} bytes`,
          WasmErrorCode.ALLOCATION_FAILED
        );
      }
    }

    // Create typed array view
    const view = new Constructor(wasm.memory.buffer, ptr, length);

    // Track allocation
    const block: MemoryBlock = {
      ptr,
      size: bytesNeeded,
      type: this.getTypeFromConstructor(Constructor),
      label,
      createdAt: Date.now(),
    };

    this.allocations.set(ptr, block);
    this.updateMetrics('allocate', bytesNeeded);

    return {
      ptr,
      length,
      view,
      dispose: () => this.deallocate(ptr),
    };
  }

  /**
   * Allocate and initialize a Float64Array
   */
  allocateFloat64(length: number, label?: string): WasmBackedArray<Float64Array> {
    return this.allocate(Float64Array, length, label);
  }

  /**
   * Allocate and copy data from existing array
   */
  allocateFrom<T extends TypedArray>(
    data: T,
    label?: string
  ): WasmBackedArray<T> {
    const Constructor = data.constructor as TypedArrayConstructor<T>;
    const allocated = this.allocate(Constructor, data.length, label);
    allocated.view.set(data);
    return allocated;
  }

  /**
   * Deallocate memory block
   */
  deallocate(ptr: number): void {
    const block = this.allocations.get(ptr);
    if (!block) {
      console.warn(`Attempted to deallocate unknown pointer: ${ptr}`);
      return;
    }

    // Add to free list for reuse
    this.freeList.push(block);
    this.allocations.delete(ptr);
    this.updateMetrics('deallocate', block.size);
  }

  /**
   * Get a view into existing WASM memory
   */
  getView<T extends TypedArray>(
    Constructor: TypedArrayConstructor<T>,
    ptr: number,
    length: number
  ): T {
    const wasm = this.getWasm();
    this.validatePointer(ptr, length * Constructor.BYTES_PER_ELEMENT);
    return new Constructor(wasm.memory.buffer, ptr, length);
  }

  /**
   * Copy data from WASM to JS
   */
  copyToJS<T extends TypedArray>(
    Constructor: TypedArrayConstructor<T>,
    ptr: number,
    length: number
  ): T {
    const view = this.getView(Constructor, ptr, length);
    return view.slice() as T;
  }

  /**
   * Copy data from JS to WASM
   */
  copyFromJS<T extends TypedArray>(data: T, ptr: number): void {
    const wasm = this.getWasm();
    const Constructor = data.constructor as TypedArrayConstructor<T>;
    this.validatePointer(ptr, data.length * Constructor.BYTES_PER_ELEMENT);
    const view = new Constructor(wasm.memory.buffer, ptr, data.length);
    view.set(data);
  }

  /**
   * Reset all allocations and free heap
   */
  reset(): void {
    const wasm = this.getWasm();
    wasm.reset_heap();
    this.allocations.clear();
    this.freeList = [];
    this.updateMetrics('reset', 0);
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    allocations: number;
    freeBlocks: number;
  } {
    const wasm = this.getWasm();

    const totalBytes = wasm.memory.buffer.byteLength;
    const usedBytes = wasm.get_heap_usage();

    return {
      totalBytes,
      usedBytes,
      freeBytes: totalBytes - usedBytes - RESERVED_BYTES,
      allocations: this.allocations.size,
      freeBlocks: this.freeList.length,
    };
  }

  /**
   * Find a reusable block in the free list
   */
  private findFreeBlock(bytesNeeded: number): number {
    // Best-fit allocation strategy
    let bestIndex = -1;
    let bestSize = Infinity;

    for (let i = 0; i < this.freeList.length; i++) {
      const block = this.freeList[i];
      if (block.size >= bytesNeeded && block.size < bestSize) {
        bestIndex = i;
        bestSize = block.size;
      }
    }

    if (bestIndex !== -1) {
      const block = this.freeList.splice(bestIndex, 1)[0];
      return block.ptr;
    }

    return -1;
  }

  /**
   * Ensure WASM has enough memory capacity
   */
  private ensureCapacity(bytesNeeded: number): void {
    const wasm = this.getWasm();
    const currentBytes = wasm.memory.buffer.byteLength;
    const heapUsage = wasm.get_heap_usage();
    const availableBytes = currentBytes - heapUsage - RESERVED_BYTES;

    if (availableBytes < bytesNeeded) {
      if (!this.config.autoGrow) {
        throw new WasmError(
          `Out of memory: need ${bytesNeeded} bytes, have ${availableBytes}`,
          WasmErrorCode.OUT_OF_MEMORY
        );
      }

      const additionalPages = Math.ceil(
        (bytesNeeded - availableBytes) / BYTES_PER_PAGE
      );
      const currentPages = currentBytes / BYTES_PER_PAGE;

      if (currentPages + additionalPages > this.config.maxPages) {
        throw new WasmError(
          `Cannot grow memory beyond ${this.config.maxPages} pages`,
          WasmErrorCode.OUT_OF_MEMORY
        );
      }

      wasm.memory.grow(additionalPages);
    }
  }

  /**
   * Validate a pointer is within bounds
   */
  private validatePointer(ptr: number, size: number): void {
    const wasm = this.getWasm();
    const maxValid = wasm.memory.buffer.byteLength;
    if (ptr < 0 || ptr + size > maxValid) {
      throw new WasmError(
        `Invalid pointer: ${ptr} (size: ${size}, max: ${maxValid})`,
        WasmErrorCode.INVALID_POINTER
      );
    }
  }

  private getWasm(): WasmExports {
    if (!this.wasm) {
      throw new WasmError(
        'Memory manager not initialized',
        WasmErrorCode.INIT_FAILED
      );
    }
    return this.wasm;
  }

  private getTypeFromConstructor<T extends TypedArray>(
    Constructor: TypedArrayConstructor<T>
  ): MemoryBlock['type'] {
    const name = Constructor.name;
    if (name === 'Float64Array') return 'f64';
    if (name === 'Float32Array') return 'f32';
    if (name === 'Int32Array') return 'i32';
    if (name === 'Uint8Array') return 'u8';
    return 'u8';
  }

  private updateMetrics(
    operation: 'allocate' | 'deallocate' | 'reset',
    bytes: number
  ): void {
    if (!this.config.enableTracking) return;

    this._metrics.update((m: WasmMetrics) => {
      const newMetrics = { ...m };

      switch (operation) {
        case 'allocate':
          newMetrics.totalAllocations++;
          newMetrics.currentMemoryUsage += bytes;
          newMetrics.peakMemoryUsage = Math.max(
            newMetrics.peakMemoryUsage,
            newMetrics.currentMemoryUsage
          );
          break;
        case 'deallocate':
          newMetrics.totalDeallocations++;
          newMetrics.currentMemoryUsage = Math.max(
            0,
            newMetrics.currentMemoryUsage - bytes
          );
          break;
        case 'reset':
          newMetrics.currentMemoryUsage = 0;
          break;
      }

      return newMetrics;
    });
  }

  private resetMetrics(): void {
    this._metrics.set({
      totalAllocations: 0,
      totalDeallocations: 0,
      peakMemoryUsage: 0,
      currentMemoryUsage: 0,
      totalComputeTimeMs: 0,
      operationCounts: {},
    });
  }

  /**
   * Track computation time
   */
  trackComputation(operation: string, timeMs: number): void {
    if (!this.config.enableTracking) return;

    this._metrics.update((m: WasmMetrics) => ({
      ...m,
      totalComputeTimeMs: m.totalComputeTimeMs + timeMs,
      operationCounts: {
        ...m.operationCounts,
        [operation]: (m.operationCounts[operation] || 0) + 1,
      },
    }));
  }
}
