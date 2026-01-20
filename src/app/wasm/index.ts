// Types
export * from './types';

// Core Services
export { WasmMemoryManager } from './memory-manager';
export { WasmSignalEngine, WasmVector, WasmMatrix } from './wasm-signal-engine';
export { WasmWorkerPool } from './worker-pool.service';

// Reactive Primitives
export {
  computedVector,
  asyncComputed,
  linkedSignals,
  batchedWasmUpdates,
  signalStream,
  diffSignal,
  throttledComputation,
  wasmPipeline,
  memoizedComputation,
  type ComputedVectorOptions,
  type AsyncComputedState,
  type SignalStreamOptions,
} from './reactive-primitives';
