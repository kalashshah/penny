// The public front page. Static markup; the motion (tabs, accordion, reveals, tilt) is landing-motion.tsx.
// Product shots are HTML mock-ups.
import type { ComponentType, CSSProperties } from 'react';
import '../landing.css';
import { LandingMotion } from './landing-motion';
import { CallDemo } from './call-demo';
import { ApprovalMock, SummaryMock } from './mocks';

const d = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

// ---- Penny's screens, as markup ----------------------------------------------------

function AlertMock() {
  return (
    <div className="alertbar t-toast">
      <b>Invoice 0042 (USD 4,000.00) was paid by Acme</b>Money landed. Penny can confirm what is still outstanding.
      <div className="a">
        <span className="dark">Take the call</span>
        <span>Open</span>
        <span>Dismiss</span>
      </div>
    </div>
  );
}

function MemoryMock() {
  return (
    <div className="note">
      <div>Acme pays late; chase on day ten.</div>
      <div>Sam is paid on delivery, by email.</div>
      <div>Hold the AWS bill until the 15th.</div>
      <div>Northwind: NET 15, bill to Mia.</div>
      <div className="when">kept across calls · corrected when it changes</div>
    </div>
  );
}

function SettingsMock() {
  return (
    <div className="doc" style={{ fontSize: 13 }}>
      <div className="meta">Settings · PayPal</div>
      <h4 style={{ fontSize: 17 }}>Connect your app</h4>
      <div className="row">
        <span>Environment</span>
        <span>
          <span className="chip ok">sandbox</span>
        </span>
      </div>
      <div className="row">
        <span>Client ID</span>
        <span>AXk3…9Qe</span>
      </div>
      <div className="row">
        <span>Secret</span>
        <span>••••••••••</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <span
          className="b dark"
          style={{ display: 'inline-block', padding: '7px 14px', borderRadius: 999, background: 'var(--ink)', color: '#fff', fontSize: 13 }}
        >
          Connect PayPal
        </span>
      </div>
    </div>
  );
}

function Lights() {
  return (
    <span className="lights">
      <span />
      <span />
      <span />
    </span>
  );
}

function Wave() {
  return (
    <div className="wave">
      <b />
      <b />
      <b />
      <b />
      <b />
      <b />
    </div>
  );
}

function MiniCall() {
  return (
    <div className="win" style={{ boxShadow: 'none' }}>
      <div className="bar">
        <Lights />
        <span className="mid">Penny · 12:04</span>
        <span className="live">
          <i />
        </span>
      </div>
      <div className="stage" style={{ gridTemplateColumns: '1fr', padding: 8 }}>
        <div className="tile ptile" style={{ minHeight: 120 }}>
          <Wave />
          <div className="who">Penny</div>
        </div>
      </div>
    </div>
  );
}

function CallWindow() {
  return (
    <div className="win rise" style={d(0.3)}>
      <div className="bar">
        <Lights />
        <span className="mid">Weekly money call · Acme Studio</span>
        <span className="live">
          <i />
          12:04
        </span>
      </div>
      <div className="stage">
        <div className="tile ptile">
          <Wave />
          <div className="who">Penny</div>
          <div className="st">speaking · screen on</div>
          <span className="tag">AI CFO</span>
        </div>
        <div className="tile share">
          <SummaryMock />
          <span className="tag">Penny is sharing her screen</span>
        </div>
      </div>
      <div className="cap">
        <span className="who">Penny</span>
        <span className="t-stream">Eleven thousand two hundred collected. Two invoices overdue. Chase Acme?</span>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <span className="t-acc-chevron">
      <svg viewBox="0 0 16 16">
        <path d="M4 6.5L8 10.5L12 6.5" />
      </svg>
    </span>
  );
}

const FAQ: [string, string][] = [
  [
    'Does Penny get my PayPal password?',
    'No. You create a REST app in your PayPal developer account and paste its client id and secret. The secret is sealed with a master key before it is stored, and you can disconnect in one click. Start with a sandbox app and switch to live when you trust her.',
  ],
  [
    'What stops her from paying the wrong person?',
    "Money out above your threshold is held as a proposal and executed only after an explicit yes, recorded with the approver's name. Executions are idempotent, so a retry can never pay twice. Below the threshold she acts and tells you.",
  ],
  [
    'Can she work with Airwallex or Stripe?',
    'PayPal is the first rail. Penny talks to a small payment interface, so another rail is one adapter; nothing about calls, memory or approvals changes.',
  ],
  ['Is it free?', 'Penny was built for the PayPal AI Hackathon and is open source. Signing up is free; calls are metered by the minute by the call provider.'],
];

const STEPS = [
  { title: 'Connect your PayPal app', text: "Paste a sandbox app's keys to try her, a live app when you trust her. Penny registers her own webhook.", Pic: SettingsMock },
  { title: 'Call Penny', text: "One click starts a video call. She joins with the account open and last month's decisions in mind.", Pic: MiniCall },
  { title: 'Say it, approve it', text: 'Invoices and reminders just happen. Money out above your limit waits for your spoken yes.', Pic: ApprovalMock },
  { title: 'She calls you first', text: 'Paid invoice, new dispute, bounced payout: Penny posts the alert and is ready to take the call.', Pic: AlertMock },
];

const ASKS = [
  { label: 'Calls you first', say: '“Tell me when Acme pays.”', does: "webhook → alert → one click and she's on the call", Vis: AlertMock, d: 0 },
  { label: 'Remembers', say: '“Hold the AWS bill till the 15th.”', does: 'kept across every call, until you change it', Vis: MemoryMock, d: 0.1 },
  { label: 'Asks before money leaves', say: '“Refund Lumen the full amount.”', does: 'over your limit → held as a proposal → your yes', Vis: ApprovalMock, d: 0.1 },
  { label: 'Shows her work', say: '“Put the overdue list on screen.”', does: 'the live summary on the shared screen', Vis: SummaryMock, d: 0.2 },
];

export function Landing() {
  return (
    <div className="ui-landing">
      <div className="wrap">
        <nav>
          <a className="logo" href="/">
            <span className="mk">p</span>Penny
          </a>
          <div className="links">
            <a href="#call">What a call looks like</a>
            <a href="#how">How it works</a>
            <a href="#asks">What&apos;s possible</a>
            <a href="#questions">Questions</a>
          </div>
          <div className="right">
            <a className="btn" href="/login" style={{ padding: '10px 16px' }}>
              Sign in
            </a>
            <a className="btn dark" href="/login" style={{ padding: '10px 18px' }}>
              Meet Penny
            </a>
          </div>
        </nav>
      </div>

      <div className="wrap">
        <section className="hero" style={{ paddingTop: 40 }}>
          <div className="t-stagger" id="heroCopy">
            <span className="pill t-stagger-line t-stagger-line--1" style={{ display: 'inline-flex' }}>
              <span className="ok" />
              Built on PayPal · AI Hackathon 2026
            </span>
            <h1 className="t-stagger-line t-stagger-line--2" style={{ marginTop: 18 }}>
              What if your CFO actually joined the call?
            </h1>
            <p className="sub t-stagger-line t-stagger-line--3">
              Penny is an AI CFO for businesses that bill through PayPal. She joins your video calls, chases invoices, handles disputes and pays people. Above your
              limit, nothing moves without your spoken yes.
            </p>
            <div className="ctas t-stagger-line t-stagger-line--4">
              <a className="btn dark" href="/login">
                <span className="dot" />
                <span className="stack">
                  Meet Penny<small>Sandbox ready · free</small>
                </span>
              </a>
              <a className="btn t-learn" href="#call">
                See what a call looks like{' '}
                <span className="t-learn-chevron">
                  <svg viewBox="0 0 16 16">
                    <path className="t-learn-arm t-learn-arm-top" d="M6 4L10 8" />
                    <path className="t-learn-arm t-learn-arm-bot" d="M10 8L6 12" />
                  </svg>
                </span>
              </a>
            </div>
            <div className="tiny t-stagger-line t-stagger-line--5">Your own PayPal app, sandbox or live. Nothing to migrate.</div>
          </div>
          <CallWindow />
        </section>
      </div>

      <div className="wrap">
        <div className="strip reveal">
          <div>
            <b>Invoices, reminders, pay links</b>
            <span>Money in, by voice</span>
          </div>
          <div>
            <b>Payouts and refunds</b>
            <span>Money out, only with a yes</span>
          </div>
          <div>
            <b>Disputes answered</b>
            <span>Read, drafted, sent, on deadline</span>
          </div>
          <div>
            <b>One memory per business</b>
            <span>Decisions kept across calls</span>
          </div>
        </div>
        <div className="partners reveal" style={d(0.1)}>
          {['PayPal Invoicing', 'PayPal Payouts', 'PayPal Disputes', 'Transaction Search', 'Webhooks', 'LlamaCalls', 'MemoryHQ'].map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      </div>

      <section id="call">
        <div className="wrap">
          <div className="head reveal">
            <div>
              <h2>One call. Everything your finance person would do.</h2>
              <p className="sub">
                Say it the way you&apos;d say it to a colleague. Penny does the PayPal part, shows her work on screen, and writes down what you decided.
              </p>
            </div>
          </div>
          <div className="reveal" style={d(0.1)}>
            <CallDemo />
          </div>
        </div>
      </section>

      <section id="how" style={{ background: 'var(--card)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <div className="wrap">
          <div className="head reveal">
            <div>
              <h2>How it works</h2>
              <p className="sub">From sign-up to your first money call in a few minutes.</p>
            </div>
          </div>
          <div className="steps">
            {STEPS.map(({ title, text, Pic }, i) => (
              <div key={title} className="t-tilt reveal">
                <div className="step t-tilt-card" style={i ? d(i * 0.08) : undefined}>
                  <div className="pic">
                    <span className="num">{i + 1}</span>
                    <Pic />
                  </div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <div className="t-tilt-glare" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="asks">
        <div className="wrap">
          <div className="head reveal">
            <div>
              <h2>Ask for things a dashboard never does.</h2>
              <p className="sub">
                A finance hire who calls you first, keeps the notes, shows her work, and stops before the dangerous part. Each one a sentence on a call.
              </p>
            </div>
          </div>
          <div className="bento">
            {ASKS.map(({ label, say, does, Vis, d: delayS }) => (
              <div key={label} className="ask reveal" style={delayS ? d(delayS) : undefined}>
                <div className="mono">{label}</div>
                <div className="say">{say}</div>
                <div className="does">{does}</div>
                <div className="vis">
                  <Vis />
                </div>
              </div>
            ))}
          </div>
          <div className="rule reveal">
            <div>
              <span className="mono">The money-out rule</span>
              <h3>Nothing moves without a yes.</h3>
              <p>
                Payments, refunds and accepted disputes above your limit stop and wait. Penny reads the amount and the recipient back and asks. A maybe is not a yes.
                Approvals also work from the dashboard, and every one is recorded with a name.
              </p>
            </div>
            <div className="rlist">
              {[
                'You ask Penny to pay someone.',
                'Above your threshold it becomes a proposal. She reads it back.',
                'You say yes. She confirms and PayPal moves the money, once.',
                'Unanswered proposals expire in thirty minutes.',
              ].map((x, i) => (
                <div key={x}>
                  <span className="n">{i + 1}</span>
                  {x}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="head reveal">
            <div>
              <h2>Not a dashboard. Not a chatbot. Not a bookkeeper.</h2>
            </div>
          </div>
          <div className="prose reveal" style={d(0.1)}>
            <p>
              <b>A dashboard</b> shows you numbers when you remember to look. Penny tells you what changed, out loud, when it changes.
            </p>
            <p>
              <b>A chatbot</b> answers questions about your money. Penny sends the reminder, replies to the dispute, pays the contractor, and asks before she does the
              dangerous part.
            </p>
            <p>
              <b>A bookkeeper</b> is someone you pay monthly and see quarterly. Penny is on the call in one click, with the account open and last month&apos;s decisions in
              mind.
            </p>
            <p>Under the hood: your own PayPal app, your own memory workspace, and an approval rule that lives on the server, not in a prompt.</p>
          </div>
        </div>
      </section>

      <section id="questions" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="head reveal">
            <div>
              <h2>Fair questions.</h2>
            </div>
          </div>
          <div className="faq reveal" style={d(0.1)}>
            {FAQ.map(([q, a], i) => (
              <div key={q} className="t-acc" data-open={i === 0}>
                <button className="t-acc-head" aria-expanded={i === 0}>
                  {q}
                  <Chevron />
                </button>
                <div className="t-acc-panel">
                  <div className="t-acc-panel-inner">
                    <p>{a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="final reveal">
            <h2>It starts with one call.</h2>
            <p>An AI CFO for PayPal businesses. Free during the hackathon.</p>
            <a className="btn dark" href="/login" style={{ padding: '14px 24px', fontSize: 16 }}>
              <span className="dot" />
              Meet Penny
            </a>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <a className="logo" href="/" style={{ fontSize: 16 }}>
            <span className="mk" style={{ width: 20, height: 20, fontSize: 12 }}>
              p
            </span>
            Penny
          </a>
          <a href="#call">What a call looks like</a>
          <a href="#how">How it works</a>
          <a href="#questions">Questions</a>
          <span className="right">© 2026 Penny · Built for the PayPal AI Hackathon · calls by LlamaCalls, memory by MemoryHQ</span>
        </div>
      </footer>
      <LandingMotion />
    </div>
  );
}
