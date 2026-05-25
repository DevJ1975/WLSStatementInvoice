import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) return 'vendor-runtime';
          if (id.includes('node_modules/vue')) return 'vendor-vue';
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/dompurify') || id.includes('node_modules/html2canvas')) return 'vendor-pdf';
          if (id.includes('node_modules/tesseract.js')) return 'vendor-ocr';
          if (id.includes('node_modules/leaflet')) return 'vendor-maps';
          return undefined;
        },
      },
    },
  },
});
