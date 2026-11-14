import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.AGENTTAB_SERVER ?? 'http://localhost:8402';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(['/api', '/tabs', '/feed', '/.well-known', '/demo', '/faucet', '/contract', '/attacks'].map((p) => [p, { target: api, changeOrigin: true }])),
  },
});
