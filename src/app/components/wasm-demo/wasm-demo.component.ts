import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import {
  WasmSignalEngine,
  WasmWorkerPool,
  WasmVector,
  WasmMatrix,
} from '../../wasm';

@Component({
  selector: 'app-wasm-demo',
  standalone: true,
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wasm-demo">
      <header class="demo-header">
        <h1>WebAssembly Signal Engine</h1>
        <p class="subtitle">High-Performance Computing with Angular Signals</p>
      </header>

      @if (!isReady()) {
        <div class="loading-section">
          @if (initError()) {
            <div class="error-message">
              <span class="error-icon">⚠️</span>
              {{ initError() }}
            </div>
            <button class="btn btn-primary" (click)="initializeEngine()">
              Retry Initialization
            </button>
          } @else {
            <div class="loading-spinner"></div>
            <p>Initializing WASM Engine...</p>
            <button class="btn btn-primary" (click)="initializeEngine()">
              Initialize
            </button>
          }
        </div>
      } @else {
        <div class="demo-content">
          <!-- Metrics Dashboard -->
          <section class="metrics-section">
            <h2>Engine Metrics</h2>
            <div class="metrics-grid">
              <div class="metric-card">
                <span class="metric-label">Memory Usage</span>
                <span class="metric-value">{{ memoryUsagePercent() }}%</span>
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    [style.width.%]="memoryUsagePercent()"
                  ></div>
                </div>
              </div>
              <div class="metric-card">
                <span class="metric-label">Allocations</span>
                <span class="metric-value">{{ metrics().totalAllocations }}</span>
              </div>
              <div class="metric-card">
                <span class="metric-label">Compute Time</span>
                <span class="metric-value">
                  {{ metrics().totalComputeTimeMs | number : '1.2-2' }}ms
                </span>
              </div>
              <div class="metric-card">
                <span class="metric-label">Peak Memory</span>
                <span class="metric-value">
                  {{ metrics().peakMemoryUsage / 1024 | number : '1.0-0' }}KB
                </span>
              </div>
            </div>
          </section>

          <!-- Vector Operations -->
          <section class="vector-section">
            <h2>Vector Operations</h2>
            <div class="controls">
              <label>
                Vector Size:
                <input
                  type="number"
                  [(ngModel)]="vectorSize"
                  min="10"
                  max="1000000"
                  step="1000"
                />
              </label>
              <button class="btn btn-secondary" (click)="createVectors()">
                Create Vectors
              </button>
            </div>

            @if (vectorA() && vectorB()) {
              <div class="vector-results">
                <div class="result-row">
                  <span class="label">Vector A (first 5):</span>
                  <span class="value">{{ formatVector(vectorA()!) }}</span>
                </div>
                <div class="result-row">
                  <span class="label">Vector B (first 5):</span>
                  <span class="value">{{ formatVector(vectorB()!) }}</span>
                </div>
                <div class="result-row highlight">
                  <span class="label">Dot Product:</span>
                  <span class="value">{{ dotProduct() | number : '1.4-4' }}</span>
                </div>
                <div class="result-row">
                  <span class="label">Magnitude A:</span>
                  <span class="value">{{ magnitudeA() | number : '1.4-4' }}</span>
                </div>
                <div class="result-row">
                  <span class="label">Mean A:</span>
                  <span class="value">{{ meanA() | number : '1.4-4' }}</span>
                </div>
                <div class="result-row">
                  <span class="label">Std Dev A:</span>
                  <span class="value">{{ stdDevA() | number : '1.4-4' }}</span>
                </div>
              </div>

              <div class="action-buttons">
                <button class="btn btn-primary" (click)="randomizeVectors()">
                  Randomize
                </button>
                <button class="btn btn-secondary" (click)="normalizeVectorA()">
                  Normalize A
                </button>
                <button class="btn btn-secondary" (click)="scaleVectorA()">
                  Scale A ×2
                </button>
              </div>
            }
          </section>

          <!-- Matrix Operations -->
          <section class="matrix-section">
            <h2>Matrix Operations</h2>
            <div class="controls">
              <label>
                Matrix Size (N×N):
                <input
                  type="number"
                  [(ngModel)]="matrixSize"
                  min="2"
                  max="500"
                  step="10"
                />
              </label>
              <button class="btn btn-secondary" (click)="createMatrices()">
                Create Matrices
              </button>
            </div>

            @if (matrixA() && matrixB()) {
              <div class="matrix-info">
                <p>Matrix A: {{ matrixA()!.rows }}×{{ matrixA()!.cols }}</p>
                <p>Matrix B: {{ matrixB()!.rows }}×{{ matrixB()!.cols }}</p>
              </div>

              <div class="action-buttons">
                <button
                  class="btn btn-primary"
                  (click)="multiplyMatrices()"
                  [disabled]="isComputing()"
                >
                  @if (isComputing()) {
                    Computing...
                  } @else {
                    A × B
                  }
                </button>
                <button class="btn btn-secondary" (click)="transposeMatrixA()">
                  Transpose A
                </button>
              </div>

              @if (matrixResult()) {
                <div class="result-row highlight">
                  <span class="label">Result Matrix:</span>
                  <span class="value">
                    {{ matrixResult()!.rows }}×{{ matrixResult()!.cols }}
                  </span>
                </div>
                <div class="result-row">
                  <span class="label">Frobenius Norm:</span>
                  <span class="value">{{ matrixResultNorm() | number : '1.4-4' }}</span>
                </div>
                <div class="result-row">
                  <span class="label">Computation Time:</span>
                  <span class="value">{{ lastComputeTime() | number : '1.2-2' }}ms</span>
                </div>
              }
            }
          </section>

          <!-- Benchmark -->
          <section class="benchmark-section">
            <h2>Performance Benchmark</h2>
            <div class="controls">
              <label>
                Iterations:
                <input
                  type="number"
                  [(ngModel)]="benchmarkIterations"
                  min="1"
                  max="1000"
                  step="10"
                />
              </label>
              <button
                class="btn btn-primary"
                (click)="runBenchmark()"
                [disabled]="isBenchmarking()"
              >
                @if (isBenchmarking()) {
                  Running...
                } @else {
                  Run Benchmark
                }
              </button>
            </div>

            @if (benchmarkResults().length > 0) {
              <div class="benchmark-results">
                <table>
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Avg Time (ms)</th>
                      <th>Ops/sec</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (result of benchmarkResults(); track result.name) {
                      <tr>
                        <td>{{ result.name }}</td>
                        <td>{{ result.avgTime | number : '1.4-4' }}</td>
                        <td>{{ result.opsPerSec | number : '1.0-0' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>

          <!-- Worker Pool Stats -->
          <section class="worker-section">
            <h2>Worker Pool</h2>
            <div class="controls">
              <button
                class="btn btn-secondary"
                (click)="initializeWorkerPool()"
                [disabled]="workerPoolReady()"
              >
                @if (workerPoolReady()) {
                  Pool Ready ({{ workerCount() }} workers)
                } @else {
                  Initialize Worker Pool
                }
              </button>
            </div>

            @if (workerPoolReady()) {
              <div class="metrics-grid">
                <div class="metric-card">
                  <span class="metric-label">Active Workers</span>
                  <span class="metric-value">{{ activeWorkers() }}</span>
                </div>
                <div class="metric-card">
                  <span class="metric-label">Queued Tasks</span>
                  <span class="metric-value">{{ queuedTasks() }}</span>
                </div>
                <div class="metric-card">
                  <span class="metric-label">Pool Utilization</span>
                  <span class="metric-value">{{ poolUtilization() }}%</span>
                </div>
                <div class="metric-card">
                  <span class="metric-label">Completed Tasks</span>
                  <span class="metric-value">{{ totalTasksCompleted() }}</span>
                </div>
              </div>

              <button class="btn btn-primary" (click)="runParallelComputation()">
                Run Parallel Computation
              </button>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    .wasm-demo {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
      font-family: system-ui, -apple-system, sans-serif;
    }

    .demo-header {
      text-align: center;
      margin-bottom: 2rem;

      h1 {
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .subtitle {
        color: #6b7280;
        font-size: 1.1rem;
      }
    }

    .loading-section {
      text-align: center;
      padding: 4rem 2rem;

      .loading-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid #e5e7eb;
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 1rem;
      }

      .error-message {
        color: #dc2626;
        padding: 1rem;
        background: #fef2f2;
        border-radius: 8px;
        margin-bottom: 1rem;
      }
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .demo-content {
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    section {
      background: #fff;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

      h2 {
        font-size: 1.25rem;
        margin-bottom: 1rem;
        color: #1f2937;
      }
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .metric-card {
      background: #f9fafb;
      padding: 1rem;
      border-radius: 8px;
      text-align: center;

      .metric-label {
        display: block;
        font-size: 0.75rem;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .metric-value {
        display: block;
        font-size: 1.5rem;
        font-weight: 600;
        color: #1f2937;
      }
    }

    .progress-bar {
      height: 4px;
      background: #e5e7eb;
      border-radius: 2px;
      margin-top: 0.5rem;
      overflow: hidden;

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #667eea, #764ba2);
        transition: width 0.3s ease;
      }
    }

    .controls {
      display: flex;
      gap: 1rem;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 1rem;

      label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: #374151;
      }

      input[type='number'] {
        width: 120px;
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 0.875rem;
      }
    }

    .btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;

      &:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
    }

    .btn-secondary {
      background: #f3f4f6;
      color: #374151;

      &:hover:not(:disabled) {
        background: #e5e7eb;
      }
    }

    .vector-results,
    .matrix-info {
      background: #f9fafb;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .result-row {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #e5e7eb;

      &:last-child {
        border-bottom: none;
      }

      &.highlight {
        background: linear-gradient(90deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
        margin: 0 -1rem;
        padding: 0.75rem 1rem;
        border-radius: 6px;
        border-bottom: none;
      }

      .label {
        color: #6b7280;
        font-size: 0.875rem;
      }

      .value {
        font-weight: 500;
        font-family: 'SF Mono', Monaco, monospace;
      }
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .benchmark-results {
      table {
        width: 100%;
        border-collapse: collapse;

        th,
        td {
          padding: 0.75rem;
          text-align: left;
          border-bottom: 1px solid #e5e7eb;
        }

        th {
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
        }

        td {
          font-family: 'SF Mono', Monaco, monospace;
        }
      }
    }
  `,
})
export class WasmDemoComponent implements OnInit {
  private readonly engine = inject(WasmSignalEngine);
  private readonly workerPool = inject(WasmWorkerPool);

  // State
  readonly isReady = this.engine.isReady;
  readonly metrics = this.engine.metrics;
  readonly memoryUsagePercent = this.engine.memoryUsagePercent;
  readonly initError = signal<string | null>(null);

  // Vector state
  readonly vectorA = signal<WasmVector | null>(null);
  readonly vectorB = signal<WasmVector | null>(null);
  vectorSize = 10000;

  // Matrix state
  readonly matrixA = signal<WasmMatrix | null>(null);
  readonly matrixB = signal<WasmMatrix | null>(null);
  readonly matrixResult = signal<WasmMatrix | null>(null);
  matrixSize = 100;
  readonly isComputing = signal(false);
  readonly lastComputeTime = signal(0);

  // Benchmark state
  readonly isBenchmarking = signal(false);
  readonly benchmarkResults = signal<Array<{ name: string; avgTime: number; opsPerSec: number }>>([]);
  benchmarkIterations = 100;

  // Worker pool state
  readonly workerPoolReady = signal(false);
  readonly workerCount = signal(0);
  readonly activeWorkers = this.workerPool.activeWorkers;
  readonly queuedTasks = this.workerPool.queuedTasks;
  readonly poolUtilization = this.workerPool.poolUtilization;
  readonly totalTasksCompleted = this.workerPool.totalTasksCompleted;

  // Computed values
  readonly dotProduct = computed(() => {
    const a = this.vectorA();
    const b = this.vectorB();
    if (!a || !b) return 0;
    return this.engine.dotProduct(a, b);
  });

  readonly magnitudeA = computed(() => {
    const a = this.vectorA();
    return a ? a.magnitude() : 0;
  });

  readonly meanA = computed(() => {
    const a = this.vectorA();
    return a ? this.engine.mean(a) : 0;
  });

  readonly stdDevA = computed(() => {
    const a = this.vectorA();
    return a ? this.engine.stdDev(a) : 0;
  });

  readonly matrixResultNorm = computed(() => {
    const m = this.matrixResult();
    return m ? m.norm() : 0;
  });

  ngOnInit(): void {
    // Auto-initialize on component load
    this.initializeEngine();
  }

  async initializeEngine(): Promise<void> {
    this.initError.set(null);
    try {
      await this.engine.init('/wasm/computation.wasm');
    } catch (error) {
      this.initError.set(
        error instanceof Error ? error.message : 'Failed to initialize WASM'
      );
    }
  }

  createVectors(): void {
    // Dispose existing vectors
    this.vectorA()?.dispose();
    this.vectorB()?.dispose();

    // Create new vectors with random data
    const dataA = new Float64Array(this.vectorSize);
    const dataB = new Float64Array(this.vectorSize);

    for (let i = 0; i < this.vectorSize; i++) {
      dataA[i] = Math.random() * 10;
      dataB[i] = Math.random() * 10;
    }

    this.vectorA.set(this.engine.createVectorSignal(this.vectorSize, dataA));
    this.vectorB.set(this.engine.createVectorSignal(this.vectorSize, dataB));
  }

  randomizeVectors(): void {
    const a = this.vectorA();
    const b = this.vectorB();

    if (a && b) {
      const dataA = new Float64Array(a.length);
      const dataB = new Float64Array(b.length);

      for (let i = 0; i < a.length; i++) {
        dataA[i] = Math.random() * 10;
        dataB[i] = Math.random() * 10;
      }

      a.set(dataA);
      b.set(dataB);
    }
  }

  normalizeVectorA(): void {
    this.vectorA()?.normalize();
  }

  scaleVectorA(): void {
    this.vectorA()?.scale(2);
  }

  formatVector(v: WasmVector): string {
    const values = v.values.slice(0, 5);
    return `[${Array.from(values).map((n) => n.toFixed(2)).join(', ')}...]`;
  }

  createMatrices(): void {
    this.matrixA()?.dispose();
    this.matrixB()?.dispose();
    this.matrixResult()?.dispose();

    const size = this.matrixSize;
    const dataA = new Float64Array(size * size);
    const dataB = new Float64Array(size * size);

    for (let i = 0; i < size * size; i++) {
      dataA[i] = Math.random();
      dataB[i] = Math.random();
    }

    this.matrixA.set(this.engine.createMatrixSignal(size, size, dataA));
    this.matrixB.set(this.engine.createMatrixSignal(size, size, dataB));
    this.matrixResult.set(null);
  }

  multiplyMatrices(): void {
    const a = this.matrixA();
    const b = this.matrixB();

    if (a && b) {
      this.isComputing.set(true);
      const start = performance.now();

      // Use requestAnimationFrame to allow UI to update
      requestAnimationFrame(() => {
        this.matrixResult()?.dispose();
        const result = this.engine.matrixMultiply(a, b);
        this.matrixResult.set(result);
        this.lastComputeTime.set(performance.now() - start);
        this.isComputing.set(false);
      });
    }
  }

  transposeMatrixA(): void {
    const a = this.matrixA();
    if (a) {
      this.matrixA()?.dispose();
      const transposed = this.engine.matrixTranspose(a);
      this.matrixA.set(transposed);
    }
  }

  async runBenchmark(): Promise<void> {
    this.isBenchmarking.set(true);
    this.benchmarkResults.set([]);

    const iterations = this.benchmarkIterations;
    const results: Array<{ name: string; avgTime: number; opsPerSec: number }> = [];

    // Create test data
    const testSize = 10000;
    const vectorA = this.engine.createVectorSignal(testSize);
    const vectorB = this.engine.createVectorSignal(testSize);

    for (let i = 0; i < testSize; i++) {
      vectorA.setAt(i, Math.random());
      vectorB.setAt(i, Math.random());
    }

    // Benchmark dot product
    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.engine.dotProduct(vectorA, vectorB);
    }
    let elapsed = performance.now() - start;
    results.push({
      name: 'Dot Product (10K)',
      avgTime: elapsed / iterations,
      opsPerSec: (iterations / elapsed) * 1000,
    });

    // Benchmark mean
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.engine.mean(vectorA);
    }
    elapsed = performance.now() - start;
    results.push({
      name: 'Mean (10K)',
      avgTime: elapsed / iterations,
      opsPerSec: (iterations / elapsed) * 1000,
    });

    // Benchmark standard deviation
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.engine.stdDev(vectorA);
    }
    elapsed = performance.now() - start;
    results.push({
      name: 'Std Dev (10K)',
      avgTime: elapsed / iterations,
      opsPerSec: (iterations / elapsed) * 1000,
    });

    // Benchmark normalize
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
      vectorA.normalize();
    }
    elapsed = performance.now() - start;
    results.push({
      name: 'Normalize (10K)',
      avgTime: elapsed / iterations,
      opsPerSec: (iterations / elapsed) * 1000,
    });

    // Matrix benchmark
    const matrixSize = 50;
    const matA = this.engine.createMatrixSignal(matrixSize, matrixSize);
    const matB = this.engine.createMatrixSignal(matrixSize, matrixSize);

    for (let i = 0; i < matrixSize * matrixSize; i++) {
      matA.values[i] = Math.random();
      matB.values[i] = Math.random();
    }

    start = performance.now();
    for (let i = 0; i < Math.min(iterations, 10); i++) {
      const result = this.engine.matrixMultiply(matA, matB);
      result.dispose();
    }
    elapsed = performance.now() - start;
    const matIterations = Math.min(iterations, 10);
    results.push({
      name: `Matrix Multiply (${matrixSize}×${matrixSize})`,
      avgTime: elapsed / matIterations,
      opsPerSec: (matIterations / elapsed) * 1000,
    });

    // Cleanup
    vectorA.dispose();
    vectorB.dispose();
    matA.dispose();
    matB.dispose();

    this.benchmarkResults.set(results);
    this.isBenchmarking.set(false);
  }

  async initializeWorkerPool(): Promise<void> {
    const count = navigator.hardwareConcurrency || 4;
    await this.workerPool.init(count, '/wasm/computation.wasm');
    this.workerCount.set(count);
    this.workerPoolReady.set(true);
  }

  async runParallelComputation(): Promise<void> {
    // Run multiple computations in parallel
    const promises: Promise<unknown>[] = [];

    for (let i = 0; i < 20; i++) {
      promises.push(
        this.workerPool.compute('stats_mean', [65536, 10000] as never)
      );
    }

    await Promise.all(promises);
  }
}
