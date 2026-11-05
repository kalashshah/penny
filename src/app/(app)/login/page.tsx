import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { googleEnabled } from '@/auth';
import { currentUser, getEnv } from '@/context';
import { delay, Logo } from '@/components/ui';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Penny' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next: raw } = await searchParams;
  // Only same-site paths: `//evil.com` is protocol-relative, so it is refused too.
  const next = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  if (await currentUser()) redirect(next);
  return (
    <div className="auth">
      <div className="rise">
        <Logo />
      </div>
      <h1 className="rise" style={delay(0.05)}>
        Meet your CFO.
      </h1>
      <p className="sub rise" style={delay(0.1)}>
        Sign in with a one-time code. No password to remember.
      </p>
      <div className="card rise" style={{ ...delay(0.15), margin: 0 }}>
        <LoginForm next={next} google={googleEnabled(getEnv())} />
      </div>
      <p className="small muted" style={{ textAlign: 'center', marginTop: 18 }}>
        Free during the PayPal AI Hackathon. <Link href="/">What Penny does</Link>
      </p>
    </div>
  );
}
