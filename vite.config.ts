import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.dirname(fileURLToPath(import.meta.url)),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Long-lived vendor chunks: app deploys don't invalidate the browser's copy.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@firebase/firestore') || id.includes('re2js')) return 'vendor-firestore';
            if (id.includes('@firebase') || id.includes('/firebase/')) return 'vendor-firebase';
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('sonner') || id.includes('lucide-react')) return 'vendor-ui';
            return undefined;
          },
        },
      },
    },
    // Pre-bundle every dependency the screens use at start-up. Otherwise Vite finds new
    // ones as each screen is first opened and reloads the whole page each time.
    optimizeDeps: {
      entries: ['index.html', 'src/**/*.{ts,tsx}'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
