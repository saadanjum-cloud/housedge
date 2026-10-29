import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api goes to the Supabase `api` function (the same path Vercel rewrites to in production),
// so the app keeps calling /api/... exactly as before.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, 'web');
  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
    server: {
      port: 5173, strictPort: true,
      proxy: env.VITE_SUPABASE_URL ? {
        '/api': { target: env.VITE_SUPABASE_URL, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '/functions/v1/api') },
      } : { '/api': 'http://localhost:3001' },
    },
  };
});
