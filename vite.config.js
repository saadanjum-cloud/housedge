import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api goes to the Supabase `api` function (the same path Vercel rewrites to in production),
// so the app keeps calling /api/... exactly as before.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, 'web');
  if (mode === 'development' && !env.VITE_SUPABASE_URL) throw new Error('Missing web/.env.local. Copy web/.env.example to web/.env.local and fill in the two values (see README).');
  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
    server: {
      port: 5173, // a busy port moves to the next free one; any other: npm run dev -- --port 3001
      proxy: { '/api': { target: env.VITE_SUPABASE_URL, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '/functions/v1/api') } },
    },
  };
});
