/**
 * WebAssembly Module Type Definitions
 * Type-safe interfaces for WASM exports
 */

// WASM Export Function Signatures
export interface WasmExports {
  // Memory
  memory: WebAssembly.Memory;

  // Memory Management
  allocate(size: number): number;
  reset_heap(): void;
  get_heap_usage(): number;

  // Vector Operations
  vec_dot(aPtr: number, bPtr: number, len: number): number;
  vec_magnitude(ptr: number, len: number): number;
  vec_normalize(ptr: number, len: number): void;
  vec_add(aPtr: number, bPtr: number, resultPtr: number, len: number): void;
  vec_scale(vPtr: number, resultPtr: number, len: number, scalar: number): void;

  // Matrix Operations
  mat_multiply(
    aPtr: number,
    bPtr: number,
    cPtr: number,
    m: number,
    k: number,
    n: number
  ): void;
  mat_transpose(aPtr: number, bPtr: number, rows: number, cols: number): void;
  mat_frobenius_norm(ptr: number, size: number): number;

  // Statistical Operations
  stats_mean(ptr: number, len: number): number;
  stats_variance(ptr: number, len: number): number;
  stats_std_dev(ptr: number, len: number): number;

  // Signal Processing
  signal_moving_avg(
    inputPtr: number,
    outputPtr: number,
    len: number,
    window: number
  ): void;
  signal_convolve(
    inputPtr: number,
    kernelPtr: number,
    outputPtr: number,
    inputLen: number,
    kernelLen: number
  ): void;

  // Parallel Helpers
  process_chunk_sum(ptr: number, start: number, end: number): number;
  mem_copy(src: number, dst: number, len: number): void;
  mem_fill_f64(ptr: number, len: number, value: number): void;
}

// Memory allocation tracking
export interface MemoryBlock {
  ptr: number;
  size: number;
  type: 'f64' | 'f32' | 'i32' | 'i64' | 'u8';
  label?: string;
  createdAt: number;
}

// Memory pool configuration
export interface MemoryPoolConfig {
  initialPages: number;
  maxPages: number;
  enableTracking: boolean;
  autoGrow: boolean;
}

// Computation result with metadata
export interface ComputationResult<T> {
  data: T;
  executionTimeMs: number;
  memoryUsedBytes: number;
  wasmCalls: number;
}

// Matrix dimensions
export interface MatrixDimensions {
  rows: number;
  cols: number;
}

// Typed array backed by WASM memory
export interface WasmBackedArray<T extends TypedArray> {
  ptr: number;
  length: number;
  view: T;
  dispose: () => void;
}

// Supported typed arrays
export type TypedArray =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint8Array
  | Uint32Array;

// Type to array mapping
export type TypedArrayConstructor<T extends TypedArray> = {
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
  BYTES_PER_ELEMENT: number;
};

// Worker message types
export interface WasmWorkerMessage {
  type: 'init' | 'compute' | 'dispose' | 'result' | 'error';
  id: string;
  payload?: unknown;
}

export interface WasmComputeMessage extends WasmWorkerMessage {
  type: 'compute';
  operation: keyof WasmExports;
  args: number[];
  transferBuffers?: ArrayBuffer[];
}

export interface WasmResultMessage extends WasmWorkerMessage {
  type: 'result';
  result: number | void;
  executionTimeMs: number;
  transferBuffers?: ArrayBuffer[];
}

// Signal computation options
export interface SignalComputeOptions {
  /** Use Web Worker for computation */
  offload: boolean;
  /** Auto-update signal when source changes */
  reactive: boolean;
  /** Debounce time in ms for reactive updates */
  debounceMs?: number;
  /** Track computation metrics */
  trackMetrics?: boolean;
}

// Performance metrics
export interface WasmMetrics {
  totalAllocations: number;
  totalDeallocations: number;
  peakMemoryUsage: number;
  currentMemoryUsage: number;
  totalComputeTimeMs: number;
  operationCounts: Record<string, number>;
}

// Operation categories for grouping
export type OperationCategory = 'vector' | 'matrix' | 'stats' | 'signal' | 'memory';

// WASM initialization state
export type WasmState = 'uninitialized' | 'loading' | 'ready' | 'error';

// Error types
export class WasmError extends Error {
  constructor(
    message: string,
    public readonly code: WasmErrorCode,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'WasmError';
  }
}

export enum WasmErrorCode {
  INIT_FAILED = 'INIT_FAILED',
  ALLOCATION_FAILED = 'ALLOCATION_FAILED',
  INVALID_POINTER = 'INVALID_POINTER',
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
  COMPUTATION_FAILED = 'COMPUTATION_FAILED',
  WORKER_ERROR = 'WORKER_ERROR',
  DISPOSED = 'DISPOSED',
}
