import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { currentOwner } from '@/context';
import { Dashboard } from './_dashboard/dashboard';
import { Landing } from './_landing/landing';

// One address, two faces: the front page for visitors, the dashboard for a signed-in owner.
export async function generateMetadata(): Promise<Metadata> {
  const owner = await currentOwner();
  return owner ? { title: `Penny · ${owner.tenant.businessName}` } : { title: 'Penny · the AI CFO that joins your calls' };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ alert?: string }> }) {
  const owner = await currentOwner();
  if (!owner) return <Landing />;
  const { alert } = await searchParams;
  return (
    <AppShell>
      <Dashboard owner={owner} openAlert={typeof alert === 'string' ? alert : undefined} />
    </AppShell>
  );
}
