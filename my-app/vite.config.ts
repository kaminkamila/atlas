import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path'; // <-- Добавлено, если нужны алиасы

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // <-- Твой старый алиас (если был)
    },
  },
  worker: {
    format: 'es', // Важно для MapLibre v6
  },
  optimizeDeps: {
    exclude: ['maplibre-gl'], // Рекомендуется, чтобы избежать проблем с предсборкой
  },
});