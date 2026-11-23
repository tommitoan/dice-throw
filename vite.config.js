import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The demo page imports the package the way a consumer would ('dice-throw'), straight from src.
export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  resolve: { alias: { 'dice-throw': path.resolve(here, 'src/index.js') } },
  server: { port: Number(process.env.DICE_PORT) || 5190, strictPort: true },
  build: { outDir: '../dist-demo', emptyOutDir: true },
});
