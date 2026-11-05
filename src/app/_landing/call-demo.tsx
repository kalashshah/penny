'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import timings from './call-demos.json';
import { ApprovalMock, DisputeMock, ForecastMock, SummaryMock } from './mocks';

/**
 * The "One call" demos: real LlamaCalls clips of Penny (POST /api/clips), with
 * the transcript, her tool calls and her shared screen read off the video's
 * clock. Line times come from the clip itself (call-demos.json), so the words
 * stay on her lips; cues are pinned to a line's start or end.
 */

type DemoId = keyof typeof timings;
type Cue = { line: number; edge?: 'start' | 'end'; offset?: number } & ({ tool: string } | { screen: string });
type Demo = { id: DemoId; tab: string; cues: Cue[]; screens: Record<string, ReactNode> };

/** Bump when a clip is re-rendered in place: /demo-video is cached for a day. */
const VIDEO_VERSION = 2;

const DEMOS: Demo[] = [
  {
    id: 'checkin',
    tab: 'Money check-in',
    cues: [
      { line: 0, edge: 'end', tool: 'PayPal · invoices and disputes' },
      { line: 1, edge: 'end', offset: -1.8, screen: 'summary' },
      { line: 2, edge: 'end', tool: 'PayPal · reminder to Acme' },
      { line: 3, edge: 'start', offset: 1, screen: 'reminded' },
      { line: 3, edge: 'end', offset: -2.5, tool: 'Memory · Acme pays late, chase on day 10' },
    ],
    screens: { summary: <SummaryMock />, reminded: <SummaryMock reminded /> },
  },
  {
    id: 'forecast',
    tab: 'Make payroll?',
    cues: [
      { line: 0, edge: 'end', tool: 'PayPal · balance, open invoices, payouts' },
      { line: 1, edge: 'end', offset: -2, screen: 'expected' },
      { line: 2, edge: 'end', tool: 'Forecast · what if Acme pays 14 days later' },
      { line: 3, edge: 'start', offset: 0.5, screen: 'late' },
      { line: 4, edge: 'end', tool: 'Penny · pay Sam $800 when Acme pays' },
      { line: 5, edge: 'start', offset: 0.8, screen: 'waiting' },
    ],
    screens: { expected: <ForecastMock />, late: <ForecastMock late />, waiting: <ForecastMock late waiting /> },
  },
  {
    id: 'dispute',
    tab: 'A dispute lands',
    cues: [
      { line: 0, edge: 'start', offset: -0.4, tool: 'PayPal webhook · dispute opened' },
      { line: 1, edge: 'end', tool: 'PayPal · dispute, order and tracking' },
      { line: 2, edge: 'end', offset: -2, screen: 'draft' },
      { line: 3, edge: 'end', tool: 'PayPal · reply to the dispute' },
      { line: 4, edge: 'start', screen: 'sent' },
    ],
    screens: { draft: <DisputeMock />, sent: <DisputeMock sent /> },
  },
  {
    id: 'pay',
    tab: 'Pay a contractor',
    cues: [
      { line: 0, edge: 'end', tool: 'Penny · over your limit, held for approval' },
      { line: 1, edge: 'start', offset: 0.8, screen: 'asking' },
      { line: 2, edge: 'end', tool: 'PayPal · payout to sam@studio.co' },
      { line: 3, edge: 'start', screen: 'paid' },
      { line: 3, edge: 'end', offset: -2.5, tool: 'Memory · Sam is paid on delivery' },
    ],
    screens: { asking: <ApprovalMock />, paid: <ApprovalMock paid /> },
  },
];

type Line = { speaker: string; text: string; start: number; end: number };

function cueTime(lines: Line[], cue: Cue): number {
  const line = lines[cue.line]!;
  return (cue.edge === 'end' ? line.end : line.start) + (cue.offset ?? 0);
}

/** The words said so far, as a share of the line's audio. */
function spoken(text: string, fraction: number): string {
  if (fraction >= 1) return text;
  const words = text.split(' ');
  return words.slice(0, Math.max(1, Math.ceil(words.length * fraction))).join(' ');
}

/**
 * Sound is on by default. Browsers refuse unmuted autoplay before the visitor
 * has touched the page, so a refused play falls back to muted and the first
 * click or key anywhere turns sound back on, unless they chose mute themselves.
 * Same as LlamaCalls' landing (web/src/components/landing/use-sound.ts).
 */
function useSound() {
  const [muted, setMuted] = useState(false);
  const chose = useRef(false);

  useEffect(() => {
    if (!muted || chose.current) return;
    // Window listeners run after React's, so a click on the toggle itself sets `chose` first.
    const unmute = () => {
      if (!chose.current) setMuted(false);
    };
    window.addEventListener('click', unmute);
    window.addEventListener('keydown', unmute);
    return () => {
      window.removeEventListener('click', unmute);
      window.removeEventListener('keydown', unmute);
    };
  }, [muted]);

  const play = (v: HTMLVideoElement) =>
    v.play().catch((e: DOMException) => {
      if (e.name !== 'NotAllowedError' || v.muted) return;
      v.muted = true;
      setMuted(true);
      v.play().catch(() => undefined);
    });

  const toggle = (v: HTMLVideoElement | null) => {
    chose.current = true;
    setMuted(!muted);
    if (v) v.play().catch(() => undefined);
  };

  return { muted, play, toggle };
}

export function CallDemo() {
  const player = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [time, setTime] = useState(0);
  const { muted, play, toggle } = useSound();
  const [inView, setInView] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [pill, setPill] = useState({ x: 0, w: 0 });
  const demo = DEMOS[active]!;
  const lines = timings[demo.id].turns as Line[];
  const now = reduce ? Infinity : time;

  useEffect(() => setReduce(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  // Plays only while the player is mostly on screen: people read the heading first.
  useEffect(() => {
    // isIntersecting stays true while any sliver shows, so the ratio decides (with slack for rounding).
    const io = new IntersectionObserver(([e]) => setInView((e?.intersectionRatio ?? 0) >= 0.79), { threshold: 0.8 });
    if (player.current) io.observe(player.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v || reduce) return;
    if (inView) play(v);
    else v.pause();
  }, [inView, reduce, active]);

  // The clock, read off the video every frame.
  useEffect(() => {
    setTime(0);
    let raf = 0;
    const tick = () => {
      if (video.current) setTime(video.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useLayoutEffect(() => {
    const move = () => {
      const tab = bar.current?.querySelectorAll<HTMLElement>('.t-tab')[active];
      if (tab) setPill({ x: tab.offsetLeft, w: tab.offsetWidth });
    };
    move();
    window.addEventListener('resize', move);
    return () => window.removeEventListener('resize', move);
  }, [active]);

  const events = [
    ...lines.map((line, i) => ({ at: line.start, key: `l${i}`, line })),
    ...demo.cues.flatMap((cue, i) => ('tool' in cue ? [{ at: cueTime(lines, cue), key: `t${i}`, tool: cue.tool }] : [])),
  ]
    .filter((e) => e.at <= now)
    .sort((a, b) => a.at - b.at);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [events.length]);

  const screens = demo.cues.filter((c): c is Cue & { screen: string } => 'screen' in c && cueTime(lines, c) <= now);
  const screen = screens[screens.length - 1]?.screen;
  const talking = (who: string) => lines.some((l) => l.speaker === who && now >= l.start && now < l.end);
  const progress = reduce ? 1 : Math.min(1, time / (timings[demo.id].durationMs / 1000));

  return (
    <div className="call-demo">
      <div className="tabs">
        <div ref={bar} className="t-tabs" role="tablist">
          <span className="t-tabs-pill" aria-hidden="true" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} />
          {DEMOS.map((d, i) => (
            <button key={d.id} className="t-tab" role="tab" aria-selected={i === active} onClick={() => setActive(i)}>
              {d.tab}
            </button>
          ))}
        </div>
      </div>

      <div ref={player} className="cd">
        <div className="cd-stage">
          <div className={`cd-screen${screen ? ' is-on' : ''}`} aria-hidden={!screen}>
            <div className="cd-screen-bar">
              <span className="dot" /> Penny is sharing her screen
            </div>
            <div className="cd-screen-body">{screen ? demo.screens[screen] : null}</div>
          </div>
          <div className={`cd-face${screen ? ' is-pip' : ''}${talking('agent') ? ' is-talking' : ''}`}>
            <video
              key={demo.id}
              ref={video}
              src={`/demo-video/${demo.id}.mp4?v=${VIDEO_VERSION}`}
              poster={`/demos/${demo.id}.jpg`}
              muted={muted}
              playsInline
              preload="auto"
              onEnded={() => setActive((active + 1) % DEMOS.length)}
            />
            <span className="cd-tag">Penny</span>
          </div>
          <div className={`cd-you${talking('you') ? ' is-talking' : ''}`}>
            <span>You</span>
          </div>
          {!reduce && (
            <button className="cd-sound" onClick={() => toggle(video.current)} aria-label={muted ? 'Turn sound on' : 'Mute'}>
              {muted ? 'Sound on' : 'Mute'}
            </button>
          )}
          {!reduce && (
            <div className="cd-progress" aria-hidden="true">
              <i style={{ transform: `scaleX(${progress})` }} />
            </div>
          )}
        </div>

        <div ref={feed} className="cd-feed" aria-live="off">
          {events.map((e) =>
            'line' in e && e.line ? (
              <div key={e.key} className={`cd-line ${e.line.speaker === 'agent' ? 'penny' : 'you'}`}>
                <b>{e.line.speaker === 'agent' ? 'Penny' : 'You'}</b>
                {spoken(e.line.text, (now - e.line.start) / (e.line.end - e.line.start))}
              </div>
            ) : 'tool' in e ? (
              <span key={e.key} className="cd-tool">
                <span className="ok">✓</span>
                {e.tool}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
