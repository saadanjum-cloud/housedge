// Your account, for everyone signed in (clients and team): name, job title and password.
import { useState } from 'react';
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
    </>
  );
}
