import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  root: 'client', // Frontend source root
  build: {
    outDir: '../dist/public', // Build output to backend's public dir
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'client/index.html'),
        preview: path.resolve(__dirname, 'client/new-ui-preview.html')
      }
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src')
    }
  }
});
