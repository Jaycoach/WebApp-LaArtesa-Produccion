// Vite de DESARROLLO apuntando por proxy a una API remota (p. ej. staging) en vez de localhost:3000.
// Uso: STAGING_API=<url-base-sin-/api> npx vite --config vite.staging.config.ts --port 5199
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const target = process.env.STAGING_API;
if (!target) throw new Error('Define STAGING_API (URL base de la API, sin /api)');

export default mergeConfig(
  base,
  defineConfig({
    server: {
      proxy: {
        '/api': { target, changeOrigin: true },
      },
    },
  }),
);
