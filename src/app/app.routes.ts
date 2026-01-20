import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/wasm-demo/wasm-demo.component').then(
        (m) => m.WasmDemoComponent
      ),
  },
];
