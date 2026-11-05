'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { startCallAction } from '../actions';

interface Call {
  room: string;
  joinUrl: string;
}

interface CallState {
  call: Call | null;
  starting: boolean;
  start(alertId?: string): void;
}

const Ctx = createContext<CallState | null>(null);
const useCall = () => useContext(Ctx)!;

/**
 * The dashboard's one live call: the header button, the alerts' "Take the call" and `?alert=` all start it,
 * and the frame shows it. `openAlert` starts a call as soon as the page loads (the link in an alert email).
 */
export function CallProvider({ openAlert, children }: { openAlert?: string; children: ReactNode }) {
  const [call, setCall] = useState<Call | null>(null);
  const [starting, startTransition] = useTransition();
  const opened = useRef(false);

  const start = (alertId?: string) => {
    if (call || starting) return;
    startTransition(async () => {
      const r = await startCallAction(alertId ?? null);
      if (!r.ok) return alert(r.error);
      setCall({ room: r.room, joinUrl: r.joinUrl });
    });
  };

  useEffect(() => {
    if (openAlert && !opened.current) {
      opened.current = true;
      start(openAlert);
    }
  });

  return <Ctx.Provider value={{ call, starting, start }}>{children}</Ctx.Provider>;
}

export function CallButton({ connected }: { connected: boolean }) {
  const { call, starting, start } = useCall();
  return (
    <button className="btn dark lg" onClick={() => start()} disabled={!connected || starting || !!call} title={connected ? undefined : 'Connect PayPal first'}>
      <span className="dot" />
      {call ? 'In call' : starting ? 'Starting…' : 'Call Penny'}
    </button>
  );
}

export function TakeCallButton({ alertId }: { alertId: string }) {
  const { call, starting, start } = useCall();
  return (
    <button className="btn dark sm" onClick={() => start(alertId)} disabled={starting || !!call}>
      Take the call
    </button>
  );
}

export function CallFrame() {
  const { call } = useCall();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (call) ref.current?.scrollIntoView({ behavior: 'smooth' });
  }, [call]);
  if (!call) return null;
  return (
    <div className="card rise" ref={ref}>
      <iframe className="call" allow="microphone; camera; autoplay; display-capture; clipboard-write" src={call.joinUrl} />
      <div className="row small muted" style={{ marginTop: 10 }}>
        Room {call.room} ·{' '}
        <a href={call.joinUrl} target="_blank" rel="noopener">
          open in a new tab
        </a>
      </div>
    </div>
  );
}

/** Refreshes the dashboard when an alert or approval arrives, unless a call is on screen. */
export function StatePoller({ alerts, pending }: { alerts: number; pending: number }) {
  const router = useRouter();
  const { call } = useCall();
  useEffect(() => {
    if (call) return;
    const id = setInterval(async () => {
      try {
        const s = (await (await fetch('/api/state')).json()) as { alerts?: number; pending?: number };
        if (s.alerts !== alerts || s.pending !== pending) router.refresh();
      } catch {
        /* offline for a moment; try again next tick */
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [alerts, pending, call, router]);
  return null;
}
