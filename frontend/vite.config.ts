import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { collabServerPlugin } from '../server/collabPlugin';

export default defineConfig({
  plugins: [react(), collabServerPlugin()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: { port: 5173, open: true },
});
