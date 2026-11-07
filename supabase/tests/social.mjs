// Self-check of the Social page's URL reading, plus a link test of the whole api function (every import resolves):
// run with  deno run -A --node-modules-dir=none --no-lock supabase/tests/social.mjs
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('SUPABASE_DB_URL', 'postgres://u:p@127.0.0.1:1/db');
const root = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const { socialOf } = await import(`${root}/supabase/functions/api/social.js`);
const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); console.log('ok', m); };
const is = (url, want) => { const s = socialOf(url); assert(Object.entries(want).every(([k, v]) => s?.[k] === v), `${url} -> ${JSON.stringify(s)}`); };
is('https://www.reddit.com/r/Finland/comments/abc/best_bank/', { platform: 'reddit', kind: 'thread', community: 'r/finland' });
is('https://old.reddit.com/r/personalfinance/', { platform: 'reddit', kind: 'community' });
is('https://www.youtube.com/watch?v=xyz', { platform: 'youtube', kind: 'video' });
is('https://youtu.be/xyz', { platform: 'youtube', kind: 'video' });
is('https://www.youtube.com/@Samsung', { platform: 'youtube', kind: 'channel', handle: 'samsung' });
is('https://www.linkedin.com/pulse/how-pick-bank-jane-doe', { platform: 'linkedin', kind: 'article' });
is('https://fi.linkedin.com/posts/janedoe_banking-activity-123', { platform: 'linkedin', kind: 'post', handle: 'janedoe' });
is('https://www.linkedin.com/company/nordea/', { platform: 'linkedin', kind: 'company page', handle: 'nordea' });
is('https://x.com/nordea/status/1', { platform: 'x', kind: 'post', handle: 'nordea' });
is('https://www.tiktok.com/@brand/video/1', { platform: 'tiktok', kind: 'video', handle: 'brand' });
is('https://someone.medium.com/a-post-123', { platform: 'medium', kind: 'article', handle: 'someone' });
is('https://www.quora.com/Which-bank-is-best', { platform: 'quora', kind: 'answer' });
assert(socialOf('https://notreddit.com/r/x') === null && socialOf('nonsense') === null, 'non-social and bad addresses');
Deno.serve = () => ({ finished: Promise.resolve() });
await import(`${root}/supabase/functions/api/index.ts`);
console.log('ok api function links');
console.log('all good');
Deno.exit(0);
