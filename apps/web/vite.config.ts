import { env } from 'node:process';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': env.MINI_NTFS_API_PROXY_TARGET ?? 'http://localhost:3001',
    },
  },
});
