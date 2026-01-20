import {
  Injectable,
  signal,
  computed,
  type Signal,
  DestroyRef,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type {
  WasmExports,
  WasmWorkerMessage,
  WasmComputeMessage,
  WasmResultMessage,
} from './types';

interface WorkerTask {
  id: string;
  resolve: (result: WasmResultMessage) => void;
  reject: (error: Error) => void;
  startTime: number;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  taskCount: number;
  pendingTasks: Map<string, WorkerTask>;
}

/**
 * Worker Pool for parallel WASM computation
 * Manages multiple workers for concurrent heavy computations
 */
@Injectable({ providedIn: 'root' })
export class WasmWorkerPool {
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  private workers: PooledWorker[] = [];
  private initialized = false;
  private taskIdCounter = 0;
  private taskQueue: Array<{
    message: WasmComputeMessage;
    resolve: (result: WasmResultMessage) => void;
    reject: (error: Error) => void;
  }> = [];

  // Reactive state
  private readonly _activeWorkers = signal(0);
  private readonly _queuedTasks = signal(0);
  private readonly _totalTasksCompleted = signal(0);
  private readonly _averageTaskTimeMs = signal(0);

  readonly activeWorkers: Signal<number> = this._activeWorkers.asReadonly();
  readonly queuedTasks: Signal<number> = this._queuedTasks.asReadonly();
  readonly totalTasksCompleted: Signal<number> = this._totalTasksCompleted.asReadonly();
  readonly averageTaskTimeMs: Signal<number> = this._averageTaskTimeMs.asReadonly();

  readonly poolUtilization = computed(() => {
    if (this.workers.length === 0) return 0;
    return Math.round((this._activeWorkers() / this.workers.length) * 100);
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.terminate());
  }

  /**
   * Initialize the worker pool
   */
  async init(
    workerCount = navigator.hardwareConcurrency || 4,
    wasmPath = '/wasm/computation.wasm'
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      console.warn('Worker pool not available on server');
      return;
    }

    if (this.initialized) return;

    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('./computation.worker', import.meta.url),
        { type: 'module' }
      );

      const pooledWorker: PooledWorker = {
        worker,
        busy: false,
        taskCount: 0,
        pendingTasks: new Map(),
      };

      worker.onmessage = (event: MessageEvent<WasmWorkerMessage>) => {
        this.handleWorkerMessage(pooledWorker, event.data);
      };

      worker.onerror = (event) => {
        console.error('Worker error:', event);
        this.handleWorkerError(pooledWorker, new Error(event.message));
      };

      this.workers.push(pooledWorker);

      // Initialize WASM in each worker
      const initPromise = this.sendToWorker(pooledWorker, {
        type: 'init',
        id: this.generateTaskId(),
        payload: { wasmPath },
      });

      initPromises.push(initPromise.then(() => {}));
    }

    await Promise.all(initPromises);
    this.initialized = true;
  }

  /**
   * Execute a WASM operation in a worker
   */
  async compute<T extends keyof WasmExports>(
    operation: T,
    args: WasmExports[T] extends (...a: infer A) => unknown ? A : never,
    transferBuffers?: ArrayBuffer[]
  ): Promise<WasmResultMessage> {
    if (!this.initialized) {
      throw new Error('Worker pool not initialized');
    }

    const message: WasmComputeMessage = {
      type: 'compute',
      id: this.generateTaskId(),
      operation,
      args: args as number[],
      transferBuffers,
    };

    // Find available worker
    const worker = this.getAvailableWorker();

    if (worker) {
      return this.sendToWorker(worker, message);
    } else {
      // Queue the task
      return new Promise((resolve, reject) => {
        this.taskQueue.push({ message, resolve, reject });
        this._queuedTasks.set(this.taskQueue.length);
      });
    }
  }

  /**
   * Parallel map over array chunks
   */
  async parallelMap<T>(
    data: Float64Array,
    chunkOperation: keyof WasmExports,
    combineResults: (results: number[]) => T
  ): Promise<T> {
    const chunkSize = Math.ceil(data.length / this.workers.length);
    const promises: Promise<WasmResultMessage>[] = [];

    for (let i = 0; i < this.workers.length; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);

      if (start >= data.length) break;

      const chunk = data.slice(start, end);
      const buffer = chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      );

      promises.push(
        this.compute(chunkOperation as keyof WasmExports, [0, 0, end - start] as never, [buffer])
      );
    }

    const results = await Promise.all(promises);
    return combineResults(results.map((r) => r.result as number));
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    workerCount: number;
    activeWorkers: number;
    queuedTasks: number;
    totalCompleted: number;
    avgTimeMs: number;
  } {
    return {
      workerCount: this.workers.length,
      activeWorkers: this._activeWorkers(),
      queuedTasks: this._queuedTasks(),
      totalCompleted: this._totalTasksCompleted(),
      avgTimeMs: this._averageTaskTimeMs(),
    };
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const pooled of this.workers) {
      // Reject pending tasks
      for (const task of pooled.pendingTasks.values()) {
        task.reject(new Error('Worker pool terminated'));
      }
      pooled.worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.initialized = false;
    this._activeWorkers.set(0);
    this._queuedTasks.set(0);
  }

  private getAvailableWorker(): PooledWorker | null {
    // Find least busy worker
    let best: PooledWorker | null = null;
    let bestCount = Infinity;

    for (const worker of this.workers) {
      if (worker.pendingTasks.size < bestCount) {
        best = worker;
        bestCount = worker.pendingTasks.size;
      }
    }

    // Only return if worker isn't overwhelmed
    if (best && bestCount < 10) {
      return best;
    }

    return null;
  }

  private sendToWorker(
    pooled: PooledWorker,
    message: WasmWorkerMessage
  ): Promise<WasmResultMessage> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: message.id,
        resolve,
        reject,
        startTime: performance.now(),
      };

      pooled.pendingTasks.set(message.id, task);
      pooled.busy = pooled.pendingTasks.size > 0;
      this.updateActiveWorkerCount();

      if ('transferBuffers' in message && message.transferBuffers) {
        pooled.worker.postMessage(message, message.transferBuffers);
      } else {
        pooled.worker.postMessage(message);
      }
    });
  }

  private handleWorkerMessage(pooled: PooledWorker, message: WasmWorkerMessage): void {
    const task = pooled.pendingTasks.get(message.id);
    if (!task) {
      console.warn('Received message for unknown task:', message.id);
      return;
    }

    pooled.pendingTasks.delete(message.id);
    pooled.taskCount++;
    pooled.busy = pooled.pendingTasks.size > 0;

    const elapsed = performance.now() - task.startTime;
    this.updateStats(elapsed);
    this.updateActiveWorkerCount();

    if (message.type === 'error') {
      task.reject(new Error(message.payload as string));
    } else if (message.type === 'result') {
      task.resolve(message as WasmResultMessage);
    }

    // Process queued tasks
    this.processQueue();
  }

  private handleWorkerError(pooled: PooledWorker, error: Error): void {
    // Reject all pending tasks for this worker
    for (const task of pooled.pendingTasks.values()) {
      task.reject(error);
    }
    pooled.pendingTasks.clear();
    pooled.busy = false;
    this.updateActiveWorkerCount();
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const worker = this.getAvailableWorker();
      if (!worker) break;

      const queued = this.taskQueue.shift()!;
      this._queuedTasks.set(this.taskQueue.length);

      this.sendToWorker(worker, queued.message)
        .then(queued.resolve)
        .catch(queued.reject);
    }
  }

  private updateActiveWorkerCount(): void {
    const active = this.workers.filter((w) => w.busy).length;
    this._activeWorkers.set(active);
  }

  private updateStats(taskTimeMs: number): void {
    const total = this._totalTasksCompleted() + 1;
    const currentAvg = this._averageTaskTimeMs();
    const newAvg = currentAvg + (taskTimeMs - currentAvg) / total;

    this._totalTasksCompleted.set(total);
    this._averageTaskTimeMs.set(newAvg);
  }

  private generateTaskId(): string {
    return `task_${++this.taskIdCounter}_${Date.now()}`;
  }
}
