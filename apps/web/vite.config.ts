import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { localPort } from '../../scripts/native-db.js';

export default defineConfig({
  root: resolve('apps/web'),
  esbuild: { jsx: 'automatic' },
  server: {
    host: '127.0.0.1', port: localPort('EAPR_WEB_PORT', 5173), strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:' + localPort('EAPR_CONTROL_PORT', 3001) },
  },
});
