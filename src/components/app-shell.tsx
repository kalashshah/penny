import type { ReactNode } from 'react';

/** Everything but the landing page renders inside this: app.css is scoped to .ui-app. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="ui-app">
      <div className="wrap">{children}</div>
    </div>
  );
}
