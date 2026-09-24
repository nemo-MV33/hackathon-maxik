import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { devData } from './dev-data';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), devData()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
