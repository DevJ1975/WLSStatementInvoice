import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function shellValue(command, fallback = '') {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}

const commit = (process.env.VERCEL_GIT_COMMIT_SHA || shellValue('git rev-parse --short HEAD')).slice(0, 7);
const buildDate = new Date().toISOString();

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version || '1.0.0'),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILD_DATE__: JSON.stringify(buildDate),
  },
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
