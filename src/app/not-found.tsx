import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { MessagePage } from '@/components/ui';

export default function NotFound() {
  return (
    <AppShell>
      <MessagePage title="Not found">
        <p className="sub">Nothing lives at this address.</p>
        <Link className="btn dark block lg" href="/">
          Back to Penny
        </Link>
      </MessagePage>
    </AppShell>
  );
}
