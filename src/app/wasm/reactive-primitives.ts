import {
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
import { Subject, debounceTime, switchMap, from, shareReplay } from 'rxjs';
import { WasmSignalEngine, WasmVector, WasmMatrix } from './wasm-signal-engine';
import { WasmWorkerPool } from './worker-pool.service';
import type { WasmExports } from './types';

/**
 * Advanced reactive primitives for WASM-backed computation
 */

// ============================================
// COMPUTED VECTOR
// ============================================

export interface ComputedVectorOptions {
  debounceMs?: number;
  lazy?: boolean;
  memoize?: boolean;
}

/**
 * Creates a vector that recomputes when dependencies change
 */
export function computedVector(
  engine: WasmSignalEngine,
  computeFn: () => Float64Array | number[],
  options: ComputedVectorOptions = {}
): Signal<WasmVector> {
  const { debounceMs = 0, lazy = false } = options;
  const destroyRef = inject(DestroyRef);

  // Create initial vector
  const initialData = lazy ? new Float64Array(0) : computeFn();
  const arr = initialData instanceof Float64Array ? initialData : new Float64Array(initialData);

  let currentVector = engine.createVectorSignal(arr.length, arr);
  const vectorSignal = signal(currentVector);

  if (debounceMs > 0) {
    const trigger$ = new Subject<void>();

    trigger$
      .pipe(debounceTime(debounceMs), takeUntilDestroyed(destroyRef))
      .subscribe(() => {
        const newData = computeFn();
        const newArr = newData instanceof Float64Array ? newData : new Float64Array(newData);

        if (newArr.length !== currentVector.length) {
          currentVector.dispose();
          currentVector = engine.createVectorSignal(newArr.length, newArr);
          vectorSignal.set(currentVector);
        } else {
          currentVector.set(newArr);
        }
      });

    effect(
      () => {
        computeFn(); // Track dependencies
        trigger$.next();
      },
      { allowSignalWrites: true }
    );
  } else {
    effect(
      () => {
        const newData = computeFn();
        const newArr = newData instanceof Float64Array ? newData : new Float64Array(newData);

        if (newArr.length !== untracked(() => currentVector.length)) {
          currentVector.dispose();
          currentVector = engine.createVectorSignal(newArr.length, newArr);
          vectorSignal.set(currentVector);
        } else {
          currentVector.set(newArr);
        }
      },
      { allowSignalWrites: true }
    );
  }

  destroyRef.onDestroy(() => currentVector.dispose());

  return vectorSignal.asReadonly();
}

// ============================================
// ASYNC COMPUTED
// ============================================

export interface AsyncComputedState<T> {
  value: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Creates an async computed signal that runs in a worker
 */
export function asyncComputed<T extends keyof WasmExports>(
  pool: WasmWorkerPool,
  operation: T,
  argsFn: () => WasmExports[T] extends (...a: infer A) => unknown ? A : never,
  options: { debounceMs?: number; initialValue?: number } = {}
): Signal<AsyncComputedState<number>> {
  const { debounceMs = 16, initialValue = 0 } = options;
  const destroyRef = inject(DestroyRef);

  const state = signal<AsyncComputedState<number>>({
    value: initialValue,
    loading: false,
    error: null,
  });

  const trigger$ = new Subject<Parameters<WasmExports[T] extends (...a: infer A) => unknown ? (...a: A) => void : never>>();

  trigger$
    .pipe(
      debounceTime(debounceMs),
      switchMap((args) => {
        state.update((s) => ({ ...s, loading: true, error: null }));
        return from(pool.compute(operation, args as never));
      }),
      takeUntilDestroyed(destroyRef)
    )
    .subscribe({
      next: (result) => {
        state.set({
          value: result.result as number,
          loading: false,
          error: null,
        });
      },
      error: (error) => {
        state.update((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      },
    });

  effect(
    () => {
      const args = argsFn();
      trigger$.next(args as never);
    },
    { allowSignalWrites: true }
  );

  return state.asReadonly();
}

// ============================================
// LINKED SIGNALS
// ============================================

/**
 * Creates bidirectionally linked WASM signals
 * Changes propagate in both directions with optional transform
 */
export function linkedSignals<A, B>(
  sourceA: WritableSignal<A>,
  sourceB: WritableSignal<B>,
  transformAtoB: (a: A) => B,
  transformBtoA: (b: B) => A
): { a: WritableSignal<A>; b: WritableSignal<B> } {
  let updating = false;

  effect(
    () => {
      const a = sourceA();
      if (!updating) {
        updating = true;
        sourceB.set(transformAtoB(a));
        updating = false;
      }
    },
    { allowSignalWrites: true }
  );

  effect(
    () => {
      const b = sourceB();
      if (!updating) {
        updating = true;
        sourceA.set(transformBtoA(b));
        updating = false;
      }
    },
    { allowSignalWrites: true }
  );

  return { a: sourceA, b: sourceB };
}

// ============================================
// BATCHED UPDATES
// ============================================

/**
 * Batch multiple WASM operations into a single signal update
 */
export function batchedWasmUpdates<T>(
  operations: Array<() => void>,
  resultFn: () => T
): T {
  // Execute all operations
  for (const op of operations) {
    op();
  }

  // Return combined result
  return resultFn();
}

// ============================================
// SIGNAL STREAM
// ============================================

export interface SignalStreamOptions {
  bufferSize?: number;
  sampleRate?: number;
}

/**
 * Creates a streaming signal for real-time data (e.g., audio, sensor data)
 */
export function signalStream(
  engine: WasmSignalEngine,
  options: SignalStreamOptions = {}
): {
  vector: Signal<WasmVector>;
  push: (data: Float64Array | number[]) => void;
  clear: () => void;
} {
  const { bufferSize = 1024, sampleRate = 44100 } = options;
  const destroyRef = inject(DestroyRef);

  const buffer = engine.createVectorSignal(bufferSize, 0);
  const vectorSignal = signal(buffer);

  let writePosition = 0;

  const push = (data: Float64Array | number[]): void => {
    const arr = data instanceof Float64Array ? data : new Float64Array(data);

    for (let i = 0; i < arr.length; i++) {
      buffer.setAt(writePosition, arr[i]);
      writePosition = (writePosition + 1) % bufferSize;
    }

    buffer.notifyChange();
  };

  const clear = (): void => {
    buffer.fill(0);
    writePosition = 0;
  };

  destroyRef.onDestroy(() => buffer.dispose());

  return {
    vector: vectorSignal.asReadonly(),
    push,
    clear,
  };
}

// ============================================
// DIFF SIGNAL
// ============================================

/**
 * Creates a signal that tracks differences between updates
 */
export function diffSignal(
  engine: WasmSignalEngine,
  source: Signal<WasmVector>
): Signal<{ current: WasmVector; diff: WasmVector; changePercent: number }> {
  const destroyRef = inject(DestroyRef);

  let prevVector: WasmVector | null = null;
  let diffVector: WasmVector | null = null;

  const result = computed(() => {
    const current = source();

    if (!prevVector || prevVector.length !== current.length) {
      prevVector?.dispose();
      diffVector?.dispose();

      prevVector = engine.createVectorSignal(current.length, current.values);
      diffVector = engine.createVectorSignal(current.length, 0);

      return { current, diff: diffVector, changePercent: 0 };
    }

    // Calculate diff
    const currentData = current.values;
    const prevData = prevVector.values;
    const diffData = new Float64Array(current.length);

    let totalChange = 0;
    let totalMagnitude = 0;

    for (let i = 0; i < current.length; i++) {
      diffData[i] = currentData[i] - prevData[i];
      totalChange += Math.abs(diffData[i]);
      totalMagnitude += Math.abs(prevData[i]);
    }

    diffVector!.set(diffData);
    prevVector.set(currentData);

    const changePercent = totalMagnitude > 0 ? (totalChange / totalMagnitude) * 100 : 0;

    return { current, diff: diffVector!, changePercent };
  });

  destroyRef.onDestroy(() => {
    prevVector?.dispose();
    diffVector?.dispose();
  });

  return result;
}

// ============================================
// THROTTLED COMPUTATION
// ============================================

/**
 * Throttled computation that limits update frequency
 */
export function throttledComputation<T>(
  computeFn: () => T,
  intervalMs: number
): Signal<T> {
  const destroyRef = inject(DestroyRef);

  let lastUpdate = 0;
  let pendingUpdate = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const result = signal<T>(computeFn());

  const update = (): void => {
    const now = Date.now();
    const elapsed = now - lastUpdate;

    if (elapsed >= intervalMs) {
      result.set(computeFn());
      lastUpdate = now;
      pendingUpdate = false;
    } else if (!pendingUpdate) {
      pendingUpdate = true;
      timeoutId = setTimeout(() => {
        result.set(computeFn());
        lastUpdate = Date.now();
        pendingUpdate = false;
      }, intervalMs - elapsed);
    }
  };

  effect(
    () => {
      computeFn(); // Track dependencies
      update();
    },
    { allowSignalWrites: true }
  );

  destroyRef.onDestroy(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });

  return result.asReadonly();
}

// ============================================
// PIPELINE
// ============================================

type PipelineStep<T, U> = (input: T) => U;

/**
 * Create a processing pipeline for WASM computations
 */
export function wasmPipeline<T>(engine: WasmSignalEngine) {
  const steps: Array<PipelineStep<unknown, unknown>> = [];

  return {
    pipe<U>(step: PipelineStep<T, U>) {
      steps.push(step as PipelineStep<unknown, unknown>);
      return this as unknown as {
        pipe: <V>(step: PipelineStep<U, V>) => typeof this;
        execute: (input: T) => U;
        toSignal: (input: Signal<T>) => Signal<U>;
      };
    },

    execute(input: T): T {
      let result: unknown = input;
      for (const step of steps) {
        result = step(result);
      }
      return result as T;
    },

    toSignal(input: Signal<T>): Signal<T> {
      return computed(() => {
        let result: unknown = input();
        for (const step of steps) {
          result = step(result);
        }
        return result as T;
      });
    },
  };
}

// ============================================
// MEMO WITH SIZE LIMIT
// ============================================

/**
 * Memoized computation with LRU cache
 */
export function memoizedComputation<K, V>(
  keyFn: () => K,
  computeFn: (key: K) => V,
  maxSize = 100
): Signal<V> {
  const cache = new Map<string, V>();
  const keys: string[] = [];

  return computed(() => {
    const key = keyFn();
    const keyStr = JSON.stringify(key);

    if (cache.has(keyStr)) {
      return cache.get(keyStr)!;
    }

    const value = computeFn(key);

    // LRU eviction
    if (keys.length >= maxSize) {
      const oldest = keys.shift()!;
      cache.delete(oldest);
    }

    cache.set(keyStr, value);
    keys.push(keyStr);

    return value;
  });
}
