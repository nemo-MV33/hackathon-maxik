import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { devData } from './dev-data.js';

const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) ?? `local-${Date.now()}`;

const versionFile = (): Plugin => ({
  name: 'norfly-version',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
});

export default defineConfig({
  base: '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), devData(), versionFile()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
