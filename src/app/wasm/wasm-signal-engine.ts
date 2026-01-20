import {
  Injectable,
  signal,
  computed,
  effect,
  type Signal,
  type WritableSignal,
  DestroyRef,
  inject,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime } from 'rxjs';
import {
  type WasmExports,
  type WasmState,
  type ComputationResult,
  type MatrixDimensions,
  type WasmBackedArray,
  WasmError,
  WasmErrorCode,
} from './types';
import { WasmMemoryManager } from './memory-manager';

/**
 * Core WASM Signal Engine
 * Provides high-performance computation backed by WebAssembly with Angular Signals integration
 */
@Injectable({ providedIn: 'root' })
export class WasmSignalEngine {
  private readonly memoryManager = inject(WasmMemoryManager);
  private readonly destroyRef = inject(DestroyRef);

  private wasm: WasmExports | null = null;
  private wasmModule: WebAssembly.Module | null = null;

  // Reactive state
  private readonly _state = signal<WasmState>('uninitialized');
  private readonly _error = signal<WasmError | null>(null);

  readonly state: Signal<WasmState> = this._state.asReadonly();
  readonly error: Signal<WasmError | null> = this._error.asReadonly();
  readonly isReady = computed(() => this._state() === 'ready');
  readonly metrics = this.memoryManager.metrics;
  readonly memoryUsagePercent = this.memoryManager.memoryUsagePercent;

  /**
   * Initialize the WASM module
   */
  async init(wasmPath = '/wasm/computation.wasm'): Promise<void> {
    if (this._state() === 'ready') return;
    if (this._state() === 'loading') {
      throw new WasmError('Already loading', WasmErrorCode.INIT_FAILED);
    }

    this._state.set('loading');
    this._error.set(null);

    try {
      const response = await fetch(wasmPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.statusText}`);
      }

      const bytes = await response.arrayBuffer();
      const { instance, module } = await WebAssembly.instantiate(bytes);

      this.wasmModule = module;
      this.wasm = instance.exports as unknown as WasmExports;
      this.memoryManager.initialize(this.wasm);

      this._state.set('ready');
    } catch (err) {
      const error = new WasmError(
        `WASM initialization failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        WasmErrorCode.INIT_FAILED,
        err instanceof Error ? err : undefined
      );
      this._error.set(error);
      this._state.set('error');
      throw error;
    }
  }

  /**
   * Create a new WASM instance (for Web Workers)
   */
  async createInstance(): Promise<WasmExports> {
    if (!this.wasmModule) {
      throw new WasmError('WASM not initialized', WasmErrorCode.INIT_FAILED);
    }
    const instance = await WebAssembly.instantiate(this.wasmModule);
    return instance.exports as unknown as WasmExports;
  }

  // ============================================
  // VECTOR OPERATIONS
  // ============================================

  /**
   * Create a WASM-backed Float64Array signal
   */
  createVectorSignal(
    size: number,
    initialValue?: Float64Array | number
  ): WasmVector {
    const wasm = this.getWasm();

    const allocated = this.memoryManager.allocateFloat64(size, 'vector');
    const _signal = signal<Float64Array>(allocated.view);

    // Initialize
    if (initialValue !== undefined) {
      if (typeof initialValue === 'number') {
        allocated.view.fill(initialValue);
      } else {
        allocated.view.set(initialValue);
      }
    }

    return new WasmVector(
      wasm,
      this.memoryManager,
      _signal,
      allocated,
      this.destroyRef
    );
  }

  /**
   * Compute dot product of two vectors
   */
  dotProduct(a: WasmVector, b: WasmVector): number {
    const wasm = this.getWasm();
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    const start = performance.now();
    const result = wasm.vec_dot(a.ptr, b.ptr, a.length);
    this.memoryManager.trackComputation('vec_dot', performance.now() - start);

    return result;
  }

  /**
   * Create a reactive dot product signal
   */
  reactiveDotProduct(
    a: WasmVector,
    b: WasmVector,
    debounceMs = 16
  ): Signal<number> {
    const result = signal(0);
    const trigger$ = new Subject<void>();

    trigger$
      .pipe(debounceTime(debounceMs), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        result.set(this.dotProduct(a, b));
      });

    // React to changes in either vector
    effect(
      () => {
        a.data();
        b.data();
        trigger$.next();
      },
      { allowSignalWrites: true }
    );

    return result.asReadonly();
  }

  // ============================================
  // MATRIX OPERATIONS
  // ============================================

  /**
   * Create a WASM-backed matrix signal
   */
  createMatrixSignal(
    rows: number,
    cols: number,
    initialValue?: Float64Array | number
  ): WasmMatrix {
    const wasm = this.getWasm();

    const size = rows * cols;
    const allocated = this.memoryManager.allocateFloat64(size, 'matrix');
    const _signal = signal<Float64Array>(allocated.view);

    if (initialValue !== undefined) {
      if (typeof initialValue === 'number') {
        allocated.view.fill(initialValue);
      } else {
        allocated.view.set(initialValue);
      }
    }

    return new WasmMatrix(
      wasm,
      this.memoryManager,
      _signal,
      allocated,
      { rows, cols },
      this.destroyRef
    );
  }

  /**
   * Matrix multiplication: C = A * B
   */
  matrixMultiply(a: WasmMatrix, b: WasmMatrix): WasmMatrix {
    const wasm = this.getWasm();

    if (a.cols !== b.rows) {
      throw new Error(
        `Matrix dimensions incompatible: ${a.rows}x${a.cols} * ${b.rows}x${b.cols}`
      );
    }

    const result = this.createMatrixSignal(a.rows, b.cols);

    const start = performance.now();
    wasm.mat_multiply(
      a.ptr,
      b.ptr,
      result.ptr,
      a.rows,
      a.cols,
      b.cols
    );
    this.memoryManager.trackComputation(
      'mat_multiply',
      performance.now() - start
    );

    result.notifyChange();
    return result;
  }

  /**
   * Reactive matrix multiplication
   */
  reactiveMatrixMultiply(
    a: WasmMatrix,
    b: WasmMatrix,
    debounceMs = 16
  ): Signal<WasmMatrix> {
    let currentResult: WasmMatrix | null = null;
    const resultSignal = signal<WasmMatrix>(this.matrixMultiply(a, b));

    const trigger$ = new Subject<void>();

    trigger$
      .pipe(debounceTime(debounceMs), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (currentResult) {
          currentResult.dispose();
        }
        currentResult = this.matrixMultiply(a, b);
        resultSignal.set(currentResult);
      });

    effect(
      () => {
        a.data();
        b.data();
        trigger$.next();
      },
      { allowSignalWrites: true }
    );

    return resultSignal.asReadonly();
  }

  /**
   * Matrix transpose
   */
  matrixTranspose(matrix: WasmMatrix): WasmMatrix {
    const wasm = this.getWasm();

    const result = this.createMatrixSignal(matrix.cols, matrix.rows);

    const start = performance.now();
    wasm.mat_transpose(
      matrix.ptr,
      result.ptr,
      matrix.rows,
      matrix.cols
    );
    this.memoryManager.trackComputation(
      'mat_transpose',
      performance.now() - start
    );

    result.notifyChange();
    return result;
  }

  // ============================================
  // STATISTICAL OPERATIONS
  // ============================================

  /**
   * Compute mean of vector
   */
  mean(vector: WasmVector): number {
    const wasm = this.getWasm();
    const start = performance.now();
    const result = wasm.stats_mean(vector.ptr, vector.length);
    this.memoryManager.trackComputation('stats_mean', performance.now() - start);
    return result;
  }

  /**
   * Compute variance of vector
   */
  variance(vector: WasmVector): number {
    const wasm = this.getWasm();
    const start = performance.now();
    const result = wasm.stats_variance(vector.ptr, vector.length);
    this.memoryManager.trackComputation(
      'stats_variance',
      performance.now() - start
    );
    return result;
  }

  /**
   * Compute standard deviation of vector
   */
  stdDev(vector: WasmVector): number {
    const wasm = this.getWasm();
    const start = performance.now();
    const result = wasm.stats_std_dev(vector.ptr, vector.length);
    this.memoryManager.trackComputation(
      'stats_std_dev',
      performance.now() - start
    );
    return result;
  }

  /**
   * Reactive statistics signal
   */
  reactiveStats(
    vector: WasmVector,
    debounceMs = 16
  ): Signal<{ mean: number; variance: number; stdDev: number }> {
    const stats = signal({ mean: 0, variance: 0, stdDev: 0 });
    const trigger$ = new Subject<void>();

    trigger$
      .pipe(debounceTime(debounceMs), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        stats.set({
          mean: this.mean(vector),
          variance: this.variance(vector),
          stdDev: this.stdDev(vector),
        });
      });

    effect(
      () => {
        vector.data();
        trigger$.next();
      },
      { allowSignalWrites: true }
    );

    return stats.asReadonly();
  }

  // ============================================
  // SIGNAL PROCESSING
  // ============================================

  /**
   * Apply moving average filter
   */
  movingAverage(input: WasmVector, windowSize: number): WasmVector {
    const wasm = this.getWasm();

    const result = this.createVectorSignal(input.length);

    const start = performance.now();
    wasm.signal_moving_avg(
      input.ptr,
      result.ptr,
      input.length,
      windowSize
    );
    this.memoryManager.trackComputation(
      'signal_moving_avg',
      performance.now() - start
    );

    result.notifyChange();
    return result;
  }

  /**
   * Convolution operation
   */
  convolve(input: WasmVector, kernel: WasmVector): WasmVector {
    const wasm = this.getWasm();

    const result = this.createVectorSignal(input.length);

    const start = performance.now();
    wasm.signal_convolve(
      input.ptr,
      kernel.ptr,
      result.ptr,
      input.length,
      kernel.length
    );
    this.memoryManager.trackComputation(
      'signal_convolve',
      performance.now() - start
    );

    result.notifyChange();
    return result;
  }

  // ============================================
  // UTILITIES
  // ============================================

  /**
   * Run a timed computation
   */
  timed<T>(operation: string, fn: () => T): ComputationResult<T> {
    const start = performance.now();
    const initialMemory = this.metrics().currentMemoryUsage;

    const data = fn();

    const executionTimeMs = performance.now() - start;
    const memoryUsedBytes = this.metrics().currentMemoryUsage - initialMemory;

    this.memoryManager.trackComputation(operation, executionTimeMs);

    return {
      data,
      executionTimeMs,
      memoryUsedBytes,
      wasmCalls: 1,
    };
  }

  /**
   * Reset all memory
   */
  reset(): void {
    const wasm = this.getWasm();
    this.memoryManager.reset();
  }

  /**
   * Get WASM exports (for advanced usage)
   */
  get exports(): WasmExports {
    const wasm = this.getWasm();
    return wasm;
  }

  private getWasm(): WasmExports {
    if (this._state() !== 'ready' || !this.wasm) {
      throw new WasmError(
        'WASM engine not ready. Call init() first.',
        WasmErrorCode.INIT_FAILED
      );
    }
    return this.wasm;
  }
}

/**
 * WASM-backed Vector with Signal integration
 */
export class WasmVector {
  private readonly _data: WritableSignal<Float64Array>;
  private _disposed = false;

  constructor(
    private readonly wasm: WasmExports,
    private readonly memoryManager: WasmMemoryManager,
    dataSignal: WritableSignal<Float64Array>,
    private readonly allocated: WasmBackedArray<Float64Array>,
    destroyRef: DestroyRef
  ) {
    this._data = dataSignal;

    destroyRef.onDestroy(() => this.dispose());
  }

  get ptr(): number {
    return this.allocated.ptr;
  }

  get length(): number {
    return this.allocated.length;
  }

  get data(): Signal<Float64Array> {
    return this._data.asReadonly();
  }

  /**
   * Get current values (triggers signal read)
   */
  get values(): Float64Array {
    return this._data();
  }

  /**
   * Set values
   */
  set(data: Float64Array | number[]): void {
    this.ensureNotDisposed();
    const arr = data instanceof Float64Array ? data : new Float64Array(data);
    this.allocated.view.set(arr);
    this.notifyChange();
  }

  /**
   * Set single value
   */
  setAt(index: number, value: number): void {
    this.ensureNotDisposed();
    this.allocated.view[index] = value;
    this.notifyChange();
  }

  /**
   * Get single value
   */
  getAt(index: number): number {
    return this._data()[index];
  }

  /**
   * Fill with value
   */
  fill(value: number): void {
    this.ensureNotDisposed();
    this.allocated.view.fill(value);
    this.notifyChange();
  }

  /**
   * Normalize in-place
   */
  normalize(): void {
    this.ensureNotDisposed();
    this.wasm.vec_normalize(this.ptr, this.length);
    this.notifyChange();
  }

  /**
   * Get magnitude
   */
  magnitude(): number {
    return this.wasm.vec_magnitude(this.ptr, this.length);
  }

  /**
   * Scale by factor in-place
   */
  scale(factor: number): void {
    this.ensureNotDisposed();
    this.wasm.vec_scale(this.ptr, this.ptr, this.length, factor);
    this.notifyChange();
  }

  /**
   * Add another vector in-place
   */
  add(other: WasmVector): void {
    this.ensureNotDisposed();
    if (other.length !== this.length) {
      throw new Error('Vectors must have same length');
    }
    this.wasm.vec_add(this.ptr, other.ptr, this.ptr, this.length);
    this.notifyChange();
  }

  /**
   * Notify signal subscribers of change
   */
  notifyChange(): void {
    // Create new view to trigger signal update
    this._data.set(
      new Float64Array(this.wasm.memory.buffer, this.ptr, this.length)
    );
  }

  /**
   * Copy to new JS array
   */
  toArray(): Float64Array {
    return this._data().slice();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (!this._disposed) {
      this.allocated.dispose();
      this._disposed = true;
    }
  }

  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new WasmError('Vector has been disposed', WasmErrorCode.DISPOSED);
    }
  }
}

/**
 * WASM-backed Matrix with Signal integration
 */
export class WasmMatrix {
  private readonly _data: WritableSignal<Float64Array>;
  private _disposed = false;

  constructor(
    private readonly wasm: WasmExports,
    private readonly memoryManager: WasmMemoryManager,
    dataSignal: WritableSignal<Float64Array>,
    private readonly allocated: WasmBackedArray<Float64Array>,
    private readonly dimensions: MatrixDimensions,
    destroyRef: DestroyRef
  ) {
    this._data = dataSignal;

    destroyRef.onDestroy(() => this.dispose());
  }

  get ptr(): number {
    return this.allocated.ptr;
  }

  get rows(): number {
    return this.dimensions.rows;
  }

  get cols(): number {
    return this.dimensions.cols;
  }

  get size(): number {
    return this.dimensions.rows * this.dimensions.cols;
  }

  get data(): Signal<Float64Array> {
    return this._data.asReadonly();
  }

  get values(): Float64Array {
    return this._data();
  }

  /**
   * Get element at row, col
   */
  getAt(row: number, col: number): number {
    return this._data()[row * this.cols + col];
  }

  /**
   * Set element at row, col
   */
  setAt(row: number, col: number, value: number): void {
    this.ensureNotDisposed();
    this.allocated.view[row * this.cols + col] = value;
    this.notifyChange();
  }

  /**
   * Set entire matrix data
   */
  set(data: Float64Array | number[][] | number[]): void {
    this.ensureNotDisposed();
    let flat: Float64Array;

    if (data instanceof Float64Array) {
      flat = data;
    } else if (Array.isArray(data[0])) {
      // 2D array
      flat = new Float64Array((data as number[][]).flat());
    } else {
      flat = new Float64Array(data as number[]);
    }

    this.allocated.view.set(flat);
    this.notifyChange();
  }

  /**
   * Fill with value
   */
  fill(value: number): void {
    this.ensureNotDisposed();
    this.allocated.view.fill(value);
    this.notifyChange();
  }

  /**
   * Set to identity matrix
   */
  setIdentity(): void {
    this.ensureNotDisposed();
    if (this.rows !== this.cols) {
      throw new Error('Identity matrix requires square dimensions');
    }

    this.fill(0);
    for (let i = 0; i < this.rows; i++) {
      this.allocated.view[i * this.cols + i] = 1;
    }
    this.notifyChange();
  }

  /**
   * Frobenius norm
   */
  norm(): number {
    return this.wasm.mat_frobenius_norm(this.ptr, this.size);
  }

  /**
   * Get row as array
   */
  getRow(row: number): Float64Array {
    const start = row * this.cols;
    return this._data().slice(start, start + this.cols);
  }

  /**
   * Get column as array
   */
  getCol(col: number): Float64Array {
    const result = new Float64Array(this.rows);
    const data = this._data();
    for (let i = 0; i < this.rows; i++) {
      result[i] = data[i * this.cols + col];
    }
    return result;
  }

  /**
   * Convert to 2D array
   */
  to2DArray(): number[][] {
    const result: number[][] = [];
    const data = this._data();
    for (let i = 0; i < this.rows; i++) {
      result.push(Array.from(data.slice(i * this.cols, (i + 1) * this.cols)));
    }
    return result;
  }

  /**
   * Notify signal subscribers
   */
  notifyChange(): void {
    this._data.set(
      new Float64Array(this.wasm.memory.buffer, this.ptr, this.size)
    );
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (!this._disposed) {
      this.allocated.dispose();
      this._disposed = true;
    }
  }

  private ensureNotDisposed(): void {
    if (this._disposed) {
      throw new WasmError('Matrix has been disposed', WasmErrorCode.DISPOSED);
    }
  }
}
