import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.FMCG_PORT || 4317);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/docs/**', '**/workspace/**'] },
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
});
