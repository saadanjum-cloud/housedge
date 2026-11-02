// Self-check of the MCP server (no database, sign-in stubbed): run with  deno run -A --node-modules-dir=none --no-lock supabase/tests/mcp.mjs
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co'); Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'x'); Deno.env.set('SUPABASE_DB_URL', 'postgres://u:p@127.0.0.1:1/db');
const root = new URL('../..', import.meta.url).href.replace(/\/$/, '');
const { db } = await import(`${root}/supabase/functions/_shared/util.ts`);
const { serveMcp } = await import(`${root}/supabase/functions/api/mcp.js`);
const assert = (c, m) => { if (!c) throw new Error('FAIL ' + m); console.log('ok', m); };
const post = (body, token = 'a.b.c') => serveMcp(new Request('https://x/mcp', { method: 'POST', headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' }, body: JSON.stringify(body) }), '/mcp', async () => { throw new Error('no dispatch'); });
let r = await serveMcp(new Request('https://x/.well-known/oauth-protected-resource/mcp'), '/.well-known/oauth-protected-resource/mcp');
const prm = await r.json(); assert(prm.resource === 'https://www.housedge.eu/mcp' && prm.authorization_servers[0] === 'https://example.supabase.co/auth/v1', 'resource metadata');
r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, '');
assert(r.status === 401 && r.headers.get('www-authenticate').includes('resource_metadata="https://www.housedge.eu/.well-known/oauth-protected-resource/mcp"'), '401 challenge without token');
r = await serveMcp(new Request('https://x/mcp'), '/mcp'); assert(r.status === 405, 'GET is 405');
db.auth.getUser = async () => ({ data: { user: { id: '00000000-0000-0000-0000-000000000000', email: 't@x' } } });
r = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
assert(r.result.protocolVersion === '2025-06-18' && r.result.capabilities.tools && r.result.instructions.length > 100, 'initialize');
r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert(r.status === 202, 'notification is 202');
const tools = (await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools;
for (const t of tools) {
  if (!/^[a-z_]{1,64}$/.test(t.name) || !t.description || t.inputSchema?.type !== 'object' || !t.annotations?.title) throw new Error('bad tool ' + t.name);
  for (const req of t.inputSchema.required || []) if (!t.inputSchema.properties[req]) throw new Error(`required ${req} missing in ${t.name}`);
}
assert(tools.length === 20, `20 tools (${tools.map(t => t.name).join(', ')})`);
assert(tools.filter(t => !t.annotations.readOnlyHint).length === 6, '6 tools that change things');
const prompts = (await (await post({ jsonrpc: '2.0', id: 3, method: 'prompts/list' })).json()).result.prompts;
assert(prompts.map(p => p.name).join() === 'fix-website,weekly-summary', 'prompts');
r = await (await post({ jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'fix-website', arguments: { project_id: '7' } } })).json();
assert(r.result.messages[0].content.text.includes('project_id 7'), 'prompt text');
r = await (await post({ jsonrpc: '2.0', id: 5, method: 'nope' })).json(); assert(r.error.code === -32601, 'unknown method');
r = await (await post({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } })).json(); assert(r.error.code === -32602, 'unknown tool');
console.log('all good');
Deno.exit(0);
