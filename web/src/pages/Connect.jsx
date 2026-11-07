// Connect: how to use Housedge inside Claude, Claude Code, ChatGPT and other MCP apps. Plain instructions with the
// apps' own logos (web/public/logos, rules in README.txt), no icon set.
import { Link } from 'react-router-dom';
import { Card, PageHeader, useToast } from '../ui.jsx';

const MCP_URL = 'https://www.housedge.eu/mcp';
const LOGO = { claude: ['Claude', '/logos/claude.svg'], chatgpt: ['ChatGPT', '/logos/chatgpt.svg'] };

function Logo({ id, size = 22 }) {
  const [name, src] = LOGO[id];
  return (
    <span className="inline-grid shrink-0 place-items-center rounded-full bg-white ring-1 ring-black/10" style={{ width: size + 10, height: size + 10 }}>
      <img src={src} alt={name} width={size} height={size} />
    </span>
  );
}

function Code({ text }) {
  const toast = useToast();
  const copy = () => navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy failed: select the text instead'));
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-fill px-3 py-2">
      <code className="min-w-0 flex-1 break-all text-[12.5px]">{text}</code>
      <button className="btn-ghost btn-sm shrink-0" onClick={copy}>Copy</button>
    </div>
  );
}

const Steps = ({ items }) => (
  <ol className="mt-3 grid gap-2 text-[14px] text-ink2">
    {items.map((t, i) => <li key={i} className="flex gap-3"><span className="tnum w-5 shrink-0 text-right font-semibold text-ink">{i + 1}.</span><span className="min-w-0">{t}</span></li>)}
  </ol>
);

const Section = ({ logo, title, subtitle, children }) => (
  <Card>
    <div className="flex items-center gap-3">
      {logo && <Logo id={logo} />}
      <div><h2 className="text-[17px] font-semibold">{title}</h2>{subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}</div>
    </div>
    {children}
  </Card>
);

export default function Connect() {
  return (
    <>
      <PageHeader title="Use Housedge in Claude and ChatGPT" subtitle="Housedge is an MCP server: a standard plug that lets AI apps read your Housedge data and, with your go-ahead, make changes. Connect it once in the app you already use, then ask in plain words." />
      <div className="grid gap-4">
        <Section title="Before you start">
          <div className="mt-3 grid gap-3 text-[14px] text-ink2">
            <p>Every app needs the same address. You sign in with your normal Housedge account and the app sees only what you can see.</p>
            <div><span className="label">Server address</span><Code text={MCP_URL} /></div>
            <p>Connecting is free. Only <b>Run a check</b> spends from the company's monthly AI budget, and the assistant asks before it starts one.</p>
          </div>
        </Section>

        <Section logo="claude" title="Claude" subtitle="claude.ai on the web, and the Claude desktop and mobile apps">
          <Steps items={[
            'Open Settings, then Connectors.',
            'Choose Add custom connector.',
            <>Name it <b>Housedge</b> and paste the server address. Leave the client id and secret empty.</>,
            'Choose Add, then Connect. Housedge opens in a new window: sign in and choose Allow.',
            'Start a new chat and turn Housedge on under the tools menu if it is not on already.',
          ]} />
        </Section>

        <Section logo="claude" title="Claude Code" subtitle="For developers: in the terminal, the Claude desktop app, or the VS Code and JetBrains extensions">
          <Steps items={[
            <>In a terminal, add the server once:<Code text={`claude mcp add --transport http housedge ${MCP_URL}`} /></>,
            <>Start <code>claude</code>, type <code>/mcp</code>, choose <b>housedge</b> and then <b>Authenticate</b>. Your browser opens: sign in and choose Allow.</>,
            <>Open your website's code and run the fix command. Claude Code reads the website fixes from Housedge and applies them for you to review before you publish.<Code text="/mcp__housedge__fix-website" /></>,
          ]} />
        </Section>

        <Section logo="chatgpt" title="ChatGPT" subtitle="Paid ChatGPT plans, on the web">
          <Steps items={[
            'Open Settings, then Apps, then Advanced settings, and turn on Developer mode.',
            'Choose Create app.',
            <>Name it <b>Housedge</b>, paste the server address, and choose <b>OAuth</b> as the sign-in method.</>,
            'Choose Create, then Connect. Sign in to Housedge and choose Allow.',
            'In a new chat, add Housedge from the plus menu, then ask your question.',
          ]} />
        </Section>

        <Section title="Cursor, Windsurf and other MCP apps">
          <p className="mt-3 text-[14px] text-ink2">Add a remote MCP server with the address above. Transport is HTTP (sometimes called Streamable HTTP). The app opens Housedge in your browser to sign in; no API key is needed.</p>
        </Section>

        <Section title="What to ask">
          <ul className="mt-3 grid gap-1.5 text-[14px] text-ink2">
            {['How visible are we in ChatGPT this month, and how does that compare with last month?',
              'Which competitor is named most often, and which websites do the answers cite?',
              'What are the top three things we should fix, and why?',
              'Read the answers that describe us negatively.',
              'Add these three questions to Housedge.',
              'Write me a weekly summary.'].map(q => <li key={q} className="rounded-lg bg-fill px-3 py-1.5">{q}</li>)}
          </ul>
          <p className="mt-3 text-[13px] text-muted">Reading never changes anything. Adding questions or competitors, changing an action's status, logging work, running a website check or starting an AI check all need your go-ahead in the chat, and only client accounts can make changes. The assistant is told to treat the text of AI answers as data, never as instructions.</p>
        </Section>

        <Section title="If something goes wrong">
          <dl className="mt-3 grid gap-3 text-[14px]">
            <div><dt className="font-semibold">The sign-in page says "unauthorized request origin"</dt><dd className="text-ink2">Open the sign-in link at www.housedge.eu, not housedge.eu without www. If it keeps happening, tell your Housedge contact.</dd></div>
            <div><dt className="font-semibold">Claude Code shows "Needs authentication"</dt><dd className="text-ink2">That is normal before the first sign-in. Type /mcp, choose housedge, then Authenticate.</dd></div>
            <div><dt className="font-semibold">The assistant cannot see a project</dt><dd className="text-ink2">It sees the same projects you see when signed in. Ask your Housedge contact to add you to the company.</dd></div>
            <div><dt className="font-semibold">To disconnect</dt><dd className="text-ink2">Remove the connector in the app's settings. In Claude Code: <code>claude mcp remove housedge</code>. Changing your Housedge password also signs every connected app out.</dd></div>
          </dl>
        </Section>

        <p className="text-[12px] text-muted">Claude is a trademark of Anthropic, PBC. ChatGPT is a trademark of OpenAI. The logos only show which apps Housedge connects to; Housedge is not affiliated with either company. Your account details are on the <Link to="/account" className="underline">Account</Link> page.</p>
      </div>
    </>
  );
}
