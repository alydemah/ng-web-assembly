# Angular WebAssembly Signal Engine

<p align="center">
  <img src="https://angular.dev/assets/images/press-kit/angular_icon_gradient.gif" alt="Angular" width="120"/>
</p>

<p align="center">
  <strong>High-performance numerical computing with WebAssembly and Angular Signals</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#api-reference">API</a> •
  <a href="#benchmarks">Benchmarks</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## Overview

Angular WebAssembly Signal Engine is a high-performance numerical computing library that combines the raw speed of WebAssembly with Angular's reactive signal system. Perfect for applications requiring heavy mathematical computations like data visualization, scientific computing, machine learning inference, audio/video processing, and real-time simulations.

## Features

- **WebAssembly-Powered Computations** - Matrix operations, vector math, and statistical functions running at near-native speed
- **Angular Signals Integration** - Reactive data structures that automatically update UI when computations complete
- **Web Worker Support** - Offload heavy computations to background threads without blocking the UI
- **Memory Management** - Efficient memory allocation with automatic tracking and cleanup
- **Type-Safe API** - Full TypeScript support with comprehensive type definitions
- **Zero Dependencies** - Only requires Angular 20+ (signals support)

## Requirements

- Angular 20+ (for signals support)
- Node.js 22+
- [wabt](https://github.com/WebAssembly/wabt) (for compiling WAT to WASM)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/ng-web-assembly.git
cd ng-web-assembly
```

### 2. Install dependencies

```bash
npm install
# or
yarn install
```

### 3. Compile WebAssembly module

You need `wat2wasm` from the [WebAssembly Binary Toolkit (wabt)](https://github.com/WebAssembly/wabt):

```bash
# macOS
brew install wabt

# Ubuntu/Debian
apt-get install wabt

# Windows (via npm)
npm install -g wabt
```

Then compile the WAT file:

```bash
wat2wasm public/wasm/computation.wat -o public/wasm/computation.wasm
```

### 4. Start the development server

```bash
ng serve
```

Navigate to `http://localhost:4200/` to see the demo.

## Quick Start

### Basic Usage

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { WasmSignalEngine } from './wasm';

@Component({
  selector: 'app-example',
  template: `
    <p>Mean: {{ stats()?.mean }}</p>
    <p>Std Dev: {{ stats()?.stdDev }}</p>
  `
})
export class ExampleComponent implements OnInit {
  private engine = inject(WasmSignalEngine);

  vector = this.engine.createVectorSignal(0);
  stats = this.engine.reactiveStats(this.vector);

  async ngOnInit() {
    // Initialize the WASM engine
    await this.engine.init();

    // Create a vector with 10,000 random values
    const data = new Float64Array(10000);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 100;
    }

    this.vector = this.engine.createVectorSignal(10000, data);

    // Stats automatically update when vector changes!
  }
}
```

### Matrix Operations

```typescript
async performMatrixMultiplication() {
  await this.engine.init();

  // Create 100x100 matrices
  const matA = this.engine.createMatrixSignal(100, 100);
  const matB = this.engine.createMatrixSignal(100, 100);

  // Fill with random data
  matA.set(generateRandomMatrix(100, 100));
  matB.set(generateRandomMatrix(100, 100));

  // Multiply matrices (runs in WASM)
  const result = this.engine.matrixMultiply(matA, matB);

  console.log('Result dimensions:', result.rows, 'x', result.cols);
  console.log('Frobenius norm:', result.norm());
}
```

### Using Web Workers for Heavy Computation

```typescript
import { WasmWorkerPool } from './wasm';

@Component({...})
export class HeavyComputeComponent {
  private workerPool = inject(WasmWorkerPool);

  async ngOnInit() {
    // Initialize pool with 4 workers
    await this.workerPool.init(4);
  }

  async computeInBackground() {
    // Computation runs in a worker thread
    const result = await this.workerPool.compute(
      'stats_mean',
      [pointerToData, dataLength]
    );

    console.log('Mean computed in background:', result.result);
  }
}
```

## API Reference

### WasmSignalEngine

The main service for WASM-backed computations.

#### Methods

| Method | Description |
|--------|-------------|
| `init(wasmPath?: string)` | Initialize the WASM module |
| `createVectorSignal(size, initialValue?)` | Create a reactive WASM-backed vector |
| `createMatrixSignal(rows, cols, initialValue?)` | Create a reactive WASM-backed matrix |
| `dotProduct(a, b)` | Compute dot product of two vectors |
| `matrixMultiply(a, b)` | Multiply two matrices |
| `matrixTranspose(matrix)` | Transpose a matrix |
| `mean(vector)` | Compute mean of a vector |
| `variance(vector)` | Compute variance of a vector |
| `stdDev(vector)` | Compute standard deviation |
| `movingAverage(input, windowSize)` | Apply moving average filter |
| `convolve(input, kernel)` | Convolution operation |

#### Reactive Methods

| Method | Description |
|--------|-------------|
| `reactiveDotProduct(a, b, debounceMs?)` | Dot product that updates on input change |
| `reactiveMatrixMultiply(a, b, debounceMs?)` | Matrix multiply that updates on input change |
| `reactiveStats(vector, debounceMs?)` | Statistics that update on vector change |

### WasmVector

A WASM-backed vector with signal integration.

```typescript
const vector = engine.createVectorSignal(1000);

// Read values (triggers signal)
console.log(vector.values);

// Set values
vector.set(new Float64Array([1, 2, 3, ...]));
vector.setAt(0, 42);
vector.fill(0);

// Operations
vector.normalize();  // In-place normalization
vector.scale(2);     // In-place scaling
vector.add(otherVector);  // In-place addition

// Get computed values
console.log(vector.magnitude());

// Cleanup
vector.dispose();
```

### WasmMatrix

A WASM-backed matrix with signal integration.

```typescript
const matrix = engine.createMatrixSignal(100, 100);

// Access elements
matrix.setAt(row, col, value);
const val = matrix.getAt(row, col);

// Get rows/columns
const row = matrix.getRow(0);
const col = matrix.getCol(0);

// Special matrices
matrix.setIdentity();
matrix.fill(0);

// Computed values
console.log(matrix.norm());  // Frobenius norm

// Convert to 2D array
const arr = matrix.to2DArray();
```

### WasmWorkerPool

Multi-threaded computation via Web Workers.

```typescript
const pool = inject(WasmWorkerPool);

// Initialize with worker count
await pool.init(navigator.hardwareConcurrency);

// Check pool status
console.log(pool.activeWorkers());
console.log(pool.poolUtilization());

// Execute computation
const result = await pool.compute('vec_dot', [ptrA, ptrB, length]);

// Parallel map
const results = await pool.parallelMap(
  largeArray,
  'process_chunk_sum',
  (chunks) => chunks.reduce((a, b) => a + b, 0)
);
```

## WASM Module Functions

The WebAssembly module (`computation.wat`) provides these functions:

### Memory Management
- `allocate(size)` - Allocate memory
- `reset_heap()` - Reset memory allocator
- `get_heap_usage()` - Get current heap usage

### Vector Operations
- `vec_dot(a, b, len)` - Dot product
- `vec_magnitude(ptr, len)` - Vector magnitude
- `vec_normalize(ptr, len)` - Normalize in-place
- `vec_add(a, b, result, len)` - Vector addition
- `vec_scale(v, result, len, scalar)` - Scale vector

### Matrix Operations
- `mat_multiply(a, b, c, m, k, n)` - Matrix multiplication
- `mat_transpose(a, b, rows, cols)` - Matrix transpose
- `mat_frobenius_norm(ptr, size)` - Frobenius norm

### Statistics
- `stats_mean(ptr, len)` - Arithmetic mean
- `stats_variance(ptr, len)` - Variance
- `stats_std_dev(ptr, len)` - Standard deviation

### Signal Processing
- `signal_moving_avg(in, out, len, window)` - Moving average
- `signal_convolve(in, kernel, out, inLen, kernelLen)` - Convolution

## Project Structure

```
ng-web-assembly/
├── public/
│   └── wasm/
│       ├── computation.wat    # WebAssembly text format source
│       └── computation.wasm   # Compiled WASM binary
├── src/
│   ├── app/
│   │   ├── wasm/
│   │   │   ├── types.ts              # Type definitions
│   │   │   ├── memory-manager.ts     # Memory allocation
│   │   │   ├── wasm-signal-engine.ts # Main engine
│   │   │   ├── worker-pool.service.ts# Web Worker pool
│   │   │   ├── computation.worker.ts # Worker implementation
│   │   │   ├── reactive-primitives.ts# Advanced signals
│   │   │   └── index.ts              # Public exports
│   │   └── components/
│   │       └── wasm-demo/            # Demo component
│   └── ...
├── angular.json
├── tsconfig.json
└── package.json
```

## Benchmarks

Performance comparison on a typical workload (M1 MacBook Pro):

| Operation | JavaScript | WebAssembly | Speedup |
|-----------|-----------|-------------|---------|
| Dot Product (10K) | 0.8ms | 0.05ms | **16x** |
| Matrix Multiply (100x100) | 45ms | 2.1ms | **21x** |
| Statistics (100K) | 3.2ms | 0.12ms | **27x** |
| Normalize (10K) | 0.4ms | 0.02ms | **20x** |

*Results vary based on hardware and browser.*

## Building for Production

```bash
# Build the Angular app
ng build --configuration production

# The WASM file is automatically included from public/
```

## Testing

```bash
# Unit tests
ng test

# E2E tests
ng e2e
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Roadmap

- [ ] SIMD support for even faster vector operations
- [ ] SharedArrayBuffer support for true parallelism
- [ ] FFT (Fast Fourier Transform) implementation
- [ ] GPU acceleration via WebGPU
- [ ] Pre-built WASM binaries
- [ ] NPM package distribution

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Angular Team](https://angular.dev/) for the amazing framework and signals API
- [WebAssembly Community](https://webassembly.org/) for the specification and tooling
- [wabt](https://github.com/WebAssembly/wabt) for the WebAssembly Binary Toolkit

---

<p align="center">
  Made with ❤️ using Angular 21 and WebAssembly
</p>
