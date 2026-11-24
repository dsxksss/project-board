import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/node_modules[\\/](framer-motion|motion|motion-dom|motion-utils)[\\/]/.test(id)) return 'motion';
          if (/node_modules[\\/]@radix-ui[\\/]/.test(id)) return 'radix';
        },
      },
    },
  },
});
