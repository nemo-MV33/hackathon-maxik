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

// NORFLY_API=http://localhost:3001 — разработка с настоящим API и расписанием вместо демо-данных.
const API = process.env.NORFLY_API;

export default defineConfig({
  base: '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), ...(API ? [] : [devData()]), versionFile()],
  server: {
    proxy: API ? { '/api': API, '/data': API } : { '/api': 'http://localhost:3000' },
  },
});
