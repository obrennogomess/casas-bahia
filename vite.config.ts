import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function getHtmlInputs() {
  const inputs: Record<string, string> = {};
  const rootFiles = fs.readdirSync(__dirname);
  for (const file of rootFiles) {
    if (file.endsWith('.html')) {
      const name = file.replace(/\.html$/, '');
      inputs[name] = path.resolve(__dirname, file);
    }
  }
  const extraPages = [
    'back/index.html',
  ];
  for (const ep of extraPages) {
    const full = path.resolve(__dirname, ep);
    if (fs.existsSync(full)) {
      inputs[ep.replace(/\.html$/, '')] = full;
    }
  }
  return inputs;
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: getHtmlInputs(),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
