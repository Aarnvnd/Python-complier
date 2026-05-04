import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    minify: true,
  },
  worker: {
    format: 'es'
  }
});
