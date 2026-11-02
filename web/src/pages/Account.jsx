// Your account, for everyone signed in (clients and team): name, job title, password, and connecting Housedge to AI apps.
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { api } from '../lib.js';
import { useUser } from '../ctx.js';
import { Card, PageHeader, ErrorBox, useToast } from '../ui.jsx';

export default function Account() {
  const user = useUser();
  const toast = useToast();
  const [me, setMe] = useState({ name: user.name !== user.email ? user.name : '', jobTitle: user.jobTitle || '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState({});
  const saveMe = async () => {
    setErr({});
    try { await api('/me', { method: 'PATCH', body: me }); toast('Saved'); } catch (e) { setErr({ me: e.message }); }
  };
  const savePw = async () => {
    setErr({});
    if (pw.next !== pw.confirm) return setErr({ pw: 'The two new passwords do not match.' });
    try { await api('/me/password', { method: 'POST', body: { current: pw.current, next: pw.next } }); setPw({ current: '', next: '', confirm: '' }); toast('Password changed'); }
    catch (e) { setErr({ pw: e.message }); }
  };
  return (
    <>
      <PageHeader title="Your account" subtitle={user.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="About you">
          <div className="grid gap-3">
            <label className="block"><span className="label">Full name</span><input className="input" maxLength={120} value={me.name} onChange={e => setMe({ ...me, name: e.target.value })} autoComplete="name" /></label>
            <label className="block"><span className="label">Job title</span><input className="input" maxLength={120} value={me.jobTitle} onChange={e => setMe({ ...me, jobTitle: e.target.value })} autoComplete="organization-title" /></label>
            <ErrorBox error={err.me} />
            <button className="btn-primary w-fit" disabled={!me.name.trim()} onClick={saveMe}>Save</button>
          </div>
        </Card>
        <Card title="Change password" subtitle="10+ characters, with upper case, lower case and a number.">
          <div className="grid gap-3">
            <input className="input" type="password" aria-label="Current password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
            <input className="input" type="password" aria-label="New password" placeholder="New password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} />
            <input className="input" type="password" aria-label="Repeat the new password" placeholder="Repeat the new password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} />
            <ErrorBox error={err.pw} />
            <button className="btn-primary w-fit" disabled={!pw.current || !pw.next} onClick={savePw}>Change password</button>
          </div>
        </Card>
      </div>
      <Connect />
    </>
  );
}

// Housedge's MCP server: the same address works in Claude, ChatGPT, Claude Code and Cursor; each asks you to sign in once.
const MCP_URL = 'https://www.housedge.eu/mcp';
function Connect() {
  const toast = useToast();
  useEffect(() => { if (window.location.hash === '#connect') document.getElementById('connect')?.scrollIntoView({ behavior: 'smooth' }); }, []);
  const copy = text => navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy failed: select the text instead'));
  const Code = ({ text }) => (
    <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-fill px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-[12.5px]">{text}</code>
      <button className="btn-ghost btn-sm shrink-0" onClick={() => copy(text)} aria-label="Copy"><Copy size={13} />Copy</button>
    </div>
  );
  const apps = [
    ['Claude', 'In claude.ai: Settings, Connectors, Add custom connector. Name it Housedge, paste the address, then Connect and allow.'],
    ['ChatGPT', 'In ChatGPT: Settings, Apps, Advanced settings, turn on Developer mode, then Create app. Paste the address, choose OAuth, then connect and allow.'],
    ['Cursor and other MCP apps', 'Add a remote MCP server with the address above. The app opens Housedge in your browser to sign in.'],
  ];
  return (
    <div id="connect" className="mt-4 scroll-mt-6">
      <Card title="Use Housedge in Claude and ChatGPT" subtitle="Ask about your AI visibility from the AI assistant you already use. It works as you and sees only what you can see; changes always need your go-ahead in the chat.">
        <div className="grid gap-5 text-[14px]">
          <div><span className="label">Address</span><Code text={MCP_URL} /></div>
          <div className="grid gap-4 md:grid-cols-3">
            {apps.map(([name, how]) => <div key={name}><div className="font-semibold">{name}</div><p className="mt-1 text-[13px] text-ink2">{how}</p></div>)}
          </div>
          <div>
            <div className="font-semibold">For developers: Claude Code</div>
            <p className="mt-1 text-[13px] text-ink2">Connect once, type /mcp and sign in. Then, inside your website's code, run the Housedge fix command: Claude Code reads the fixes from Housedge and applies them to your site for you to review.</p>
            <Code text={`claude mcp add --transport http housedge ${MCP_URL}`} />
            <Code text="/mcp__housedge__fix-website" />
          </div>
          <p className="text-[12.5px] text-muted">Try asking: “How visible are we in ChatGPT this month?”, “Which competitor is named most, and why?”, “Add these three questions to Housedge.”</p>
        </div>
      </Card>
    </div>
  );
}
