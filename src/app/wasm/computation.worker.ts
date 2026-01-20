/// <reference lib="webworker" />

import type {
  WasmExports,
  WasmWorkerMessage,
  WasmComputeMessage,
  WasmResultMessage,
} from './types';

/**
 * Web Worker for offloading heavy WASM computations
 * Runs in a separate thread to prevent UI blocking
 */

let wasm: WasmExports | null = null;
let wasmModule: WebAssembly.Module | null = null;

// Message handler
addEventListener('message', async (event: MessageEvent<WasmWorkerMessage>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'init':
        await handleInit(message);
        break;
      case 'compute':
        handleCompute(message as WasmComputeMessage);
        break;
      case 'dispose':
        handleDispose(message);
        break;
      default:
        throw new Error(`Unknown message type: ${(message as WasmWorkerMessage).type}`);
    }
  } catch (error) {
    postMessage({
      type: 'error',
      id: message.id,
      payload: error instanceof Error ? error.message : 'Unknown error',
    } satisfies WasmWorkerMessage);
  }
});

async function handleInit(message: WasmWorkerMessage): Promise<void> {
  const wasmPath = (message.payload as { wasmPath: string })?.wasmPath ?? '/wasm/computation.wasm';

  const response = await fetch(wasmPath);
  const bytes = await response.arrayBuffer();
  const { instance, module } = await WebAssembly.instantiate(bytes);

  wasmModule = module;
  wasm = instance.exports as unknown as WasmExports;

  postMessage({
    type: 'result',
    id: message.id,
    result: 0,
    executionTimeMs: 0,
  } satisfies WasmResultMessage);
}

function handleCompute(message: WasmComputeMessage): void {
  if (!wasm) {
    throw new Error('WASM not initialized in worker');
  }

  const start = performance.now();

  // Get the function to call
  const fn = wasm[message.operation] as (...args: number[]) => number | void;
  if (typeof fn !== 'function') {
    throw new Error(`Unknown operation: ${message.operation}`);
  }

  // Handle memory transfer if needed
  let resultBuffer: ArrayBuffer | undefined;

  if (message.transferBuffers && message.transferBuffers.length > 0) {
    // Copy transferred data into WASM memory
    const inputBuffer = message.transferBuffers[0];
    const inputArray = new Float64Array(inputBuffer);
    const ptr = wasm.allocate(inputArray.length * 8);
    const view = new Float64Array(wasm.memory.buffer, ptr, inputArray.length);
    view.set(inputArray);

    // Update args with new pointer
    message.args[0] = ptr;
  }

  // Execute the computation
  const result = fn.apply(null, message.args);

  // Check if we need to transfer result back
  const transferBuffers: ArrayBuffer[] = [];

  if (message.payload && (message.payload as { returnBuffer?: boolean }).returnBuffer) {
    const { ptr, length } = message.payload as { ptr: number; length: number; returnBuffer: boolean };
    const resultView = new Float64Array(wasm.memory.buffer, ptr, length);
    resultBuffer = resultView.buffer.slice(
      resultView.byteOffset,
      resultView.byteOffset + resultView.byteLength
    );
    transferBuffers.push(resultBuffer);
  }

  const executionTimeMs = performance.now() - start;

  const response: WasmResultMessage = {
    type: 'result',
    id: message.id,
    result: result as number | void,
    executionTimeMs,
    transferBuffers: transferBuffers.length > 0 ? transferBuffers : undefined,
  };

  postMessage(response, { transfer: transferBuffers });
}

function handleDispose(message: WasmWorkerMessage): void {
  if (wasm) {
    wasm.reset_heap();
  }
  wasm = null;
  wasmModule = null;

  postMessage({
    type: 'result',
    id: message.id,
    result: 0,
    executionTimeMs: 0,
  } satisfies WasmResultMessage);
}

// Export types for worker context
export type { WasmWorkerMessage, WasmComputeMessage, WasmResultMessage };
