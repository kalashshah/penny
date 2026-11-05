'use client';

import dynamic from 'next/dynamic';
import type { Boot } from './studio';

// AG Studio needs the DOM, and it is heavy: load it in the browser, in its own chunk.
const Studio = dynamic(() => import('./studio'), { ssr: false, loading: () => <p className="empty">Loading the report…</p> });

export function ReportsClient({ boot }: { boot: Boot }) {
  return <Studio boot={boot} />;
}
