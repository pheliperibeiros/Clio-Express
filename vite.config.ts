import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
  // Tauri expects a fixed port and needs the devtools origin
  server: {
    port: 3000,
    strictPort: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3000,
    },
  },
  build: {
    // Tauri uses Chromium — target modern baseline
    target: ['chrome120'],
    // Smaller source maps for desktop (can be disabled for production)
    sourcemap: false,
    // Let Tauri handle the bundle — keep chunks reasonably sized
    rollupOptions: {
      output: {
        // Split heavy libs from the main bundle to improve cold-start load time
        manualChunks(id) {
          if (id.includes('node_modules/jspdf')) return 'pdf';
          if (id.includes('node_modules/motion')) return 'motion';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor';
        },
      },
    },
    // Raise chunk warning threshold — desktop has no bandwidth penalty
    chunkSizeWarningLimit: 2000,
  },
  // Prevent Vite from obscuring Rust errors during Tauri build
  clearScreen: false,
  // Environment variables exposed to the frontend
  envPrefix: ['VITE_', 'TAURI_'],
});
