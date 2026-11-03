import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In development, /api goes to the Supabase `api` function (the same path Vercel rewrites to in production),
// so the app keeps calling /api/... exactly as before.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, 'web');
  if (mode === 'development' && !env.VITE_SUPABASE_URL) throw new Error('Missing web/.env.local. Copy web/.env.example to web/.env.local and fill in the two values (see README).');
  // A placeholder or quoted key makes every sign-in fail with "Invalid API key"; say so before the app starts.
  // Vite's order: a VITE_ variable exported in the shell, then web/.env.development.local, web/.env.development, web/.env.local, web/.env.
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (mode === 'development' && !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key)) throw new Error(`VITE_SUPABASE_PUBLISHABLE_KEY is not a real key (Vite sees "${key.slice(0, 18)}…", ${key.length} characters). `
    + 'Put the publishable key from Supabase (Project Settings > API Keys) in web/.env.local without quotes, check no web/.env.development* file or exported shell variable overrides it, then restart npm run dev.');
  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
    server: {
      port: 5173, // a busy port moves to the next free one; any other: npm run dev -- --port 3001
      proxy: { '/api': { target: env.VITE_SUPABASE_URL, changeOrigin: true, rewrite: p => p.replace(/^\/api/, '/functions/v1/api') + (p.includes('?') ? '&' : '?') + 'forceFunctionRegion=eu-west-1' } }, // run next to the database (Ireland)
    },
  };
});
