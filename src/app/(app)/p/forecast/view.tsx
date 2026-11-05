'use client';

import '@bryntum/scheduler/scheduler.css';
import '@bryntum/scheduler/stockholm-light.css';
import '@bryntum/scheduler/fontawesome/css/fontawesome.css';
import '@bryntum/scheduler/fontawesome/css/solid.css';
import type { Scheduler } from '@bryntum/scheduler';
import { useEffect, useRef, useState } from 'react';
import { delay, Kpi, money } from '@/components/ui';
import { addDays, project, type FlowItem, type Forecast, type Projection } from '@/forecast';

// Bryntum works in local time; the forecast in YYYY-MM-DD.
const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Fits a day cell: +4k, +1.5k, −18. */
const short = (n: number) => `${n < 0 ? '−' : '+'}${Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase()}`;
/** One row per customer or payee, money in first. */
const rowsOf = (items: FlowItem[]) =>
  [...new Map([...items].sort((a, b) => Number(b.amount > 0) - Number(a.amount > 0)).map((x) => [x.who, { id: x.who, name: x.who }])).values()];

/**
 * The timeline (Bryntum Scheduler) and the balance line under it. Dragging a
 * payment to another day re-runs the projection here, so "what if Acme pays a
 * week late" is a drag, not a question.
 */
export function ForecastView({ f }: { f: Forecast }) {
  const el = useRef<HTMLDivElement>(null);
  const sched = useRef<Scheduler | null>(null);
  const [items, setItems] = useState(f.items);
  const moved = items.some((x, i) => x.date !== f.items[i]?.date);
  const p = moved ? project(f.start, items, f.today, f.horizon) : f;

  useEffect(() => {
    let dead = false;
    void import('@bryntum/scheduler').then(({ Scheduler, StringHelper }) => {
      if (dead || !el.current) return;
      sched.current = new Scheduler({
        appendTo: el.current,
        startDate: toDate(f.today),
        endDate: toDate(addDays(f.today, f.horizon + 1)),
        viewPreset: f.horizon > 45 ? 'weekAndMonth' : 'weekAndDayLetter',
        rowHeight: 40,
        barMargin: 4,
        autoHeight: true,
        eventStyle: 'tonal',
        columns: [{ text: '', field: 'name', width: 170 }],
        resources: rowsOf(f.items),
        events: eventsOf(f.items),
        features: {
          // A payment moves in time, not to someone else.
          eventDrag: { constrainDragToResource: true },
          eventResize: false, eventEdit: false, eventMenu: false, scheduleMenu: false, cellMenu: false, eventDragCreate: false, eventTooltip: { template: ({ eventRecord: e }) => `<b>${StringHelper.encodeHtml(e.get('who'))}</b><br>${StringHelper.encodeHtml(e.get('label'))} · ${StringHelper.encodeHtml(money(e.get('amount'), f.currency))}${e.get('note') ? `<br>${StringHelper.encodeHtml(e.get('note'))}` : ''}` } },
        eventRenderer: ({ eventRecord: e }) => short(e.get('amount')),
        listeners: {
          afterEventDrop: ({ eventRecords }) => {
            const moves = new Map(eventRecords.map((e) => [String(e.id), fromDate(new Date(e.startDate))]));
            setItems((xs) => xs.map((x) => (moves.has(x.id) ? { ...x, date: moves.get(x.id)! } : x)));
          },
        },
      });
    });
    return () => {
      dead = true;
      sched.current?.destroy();
      sched.current = null;
    };
  }, [f]);

  const reset = () => {
    setItems(f.items);
    if (sched.current) sched.current.events = eventsOf(f.items);
  };

  const c = f.currency;
  return (
    <>
      <div className="kpis rise" style={delay(0.05)}>
        <Kpi label={f.startKnown ? 'Balance today' : 'Start'} value={money(f.start, c)} sub={f.startKnown ? 'PayPal balance' : 'PayPal did not share the balance'} />
        <Kpi label="Lowest point" value={money(p.low.balance, c)} sub={p.low.date} tone={p.low.balance < 0 ? 'bad' : p.low.balance < f.start ? 'warn' : 'ok'} />
        <Kpi label={`In ${f.horizon} days`} value={money(p.end, c)} tone={p.end >= f.start ? 'ok' : 'bad'} />
        <Kpi label="Expected moves" value={String(items.length)} sub={moved ? 'with your changes' : 'drag one to try another day'} />
      </div>
      <div className="card rise" style={{ ...delay(0.1), padding: 10 }}>
        <div className="row" style={{ justifyContent: 'space-between', padding: '4px 8px 10px' }}>
          <span className="small muted">Drag a payment to another day to see what it does to the balance.</span>
          {moved && (
            <button className="btn sm" onClick={reset}>
              Reset
            </button>
          )}
        </div>
        <div ref={el} className="forecast-tl" />
        {!items.length && <p className="empty">Nothing expected to move in this window.</p>}
      </div>
      <div className="card rise" style={delay(0.15)}>
        <h2>Balance</h2>
        <BalanceLine p={p} currency={c} />
      </div>
    </>
  );
}

function eventsOf(items: FlowItem[]) {
  return items.map((x) => ({
    id: x.id,
    resourceId: x.who,
    startDate: toDate(x.date),
    endDate: toDate(addDays(x.date, 1)),
    name: x.who,
    who: x.who,
    label: x.label,
    amount: x.amount,
    note: x.note ?? '',
    eventColor: x.amount >= 0 ? 'green' : x.kind === 'dispute' ? 'orange' : 'red',
    resizable: false,
  }));
}

function BalanceLine({ p, currency }: { p: Projection; currency: string }) {
  const W = 1000;
  const H = 200;
  const pad = 24;
  const vals = p.days.map((d) => d.balance);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(1, ...vals);
  const x = (i: number) => (i / Math.max(1, p.days.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const path = p.days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.balance).toFixed(1)}`).join('');
  const li = p.days.findIndex((d) => d.date === p.low.date);
  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Balance from ${money(p.days[0]?.balance ?? 0, currency)} to ${money(p.end, currency)}, lowest ${money(p.low.balance, currency)} on ${p.low.date}`}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--line2)" strokeDasharray="4 4" />
      <path d={`${path}L${W},${y(lo)}L0,${y(lo)}Z`} fill="var(--green-soft)" opacity={0.6} />
      <path d={path} fill="none" stroke="var(--green)" strokeWidth={2.5} strokeLinejoin="round" />
      {li >= 0 && (
        <g>
          <circle cx={x(li)} cy={y(p.low.balance)} r={5} fill={p.low.balance < 0 ? 'var(--red)' : 'var(--amber)'} />
          <text x={Math.min(W - 150, Math.max(4, x(li) - 60))} y={Math.min(H, y(p.low.balance) + 22)} fontSize={13} fill="var(--ink2)">
            low {money(p.low.balance, currency)}
          </text>
        </g>
      )}
      {[0, Math.floor((p.days.length - 1) / 2), p.days.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H + 16} fontSize={12} fill="var(--muted)" textAnchor={i === 0 ? 'start' : i === p.days.length - 1 ? 'end' : 'middle'}>
          {p.days[i]?.date}
        </text>
      ))}
    </svg>
  );
}
