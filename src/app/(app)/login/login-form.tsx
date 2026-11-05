'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { authClient } from '@/auth-client';

function GoogleMark() {
  return (
    <svg className="gmark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** Email one-time code (two steps), or Google when this deployment has a client configured. */
export function LoginForm({ next, google }: { next: string; google: boolean }) {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, startTransition] = useTransition();

  const run = (fn: () => Promise<string | void>) =>
    startTransition(async () => {
      setError('');
      const failure = await fn();
      if (failure) setError(failure);
    });

  const sendCode = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (!email.trim()) return 'Enter your email';
      const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' });
      if (error) return error.message || 'Could not send the code';
      setSent(true);
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (otp.trim().length < 6) return 'Enter the 6-digit code';
      const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: otp.trim() });
      if (error) return error.message || 'That code did not work';
      // A full load, so the server renders the dashboard with the new session cookie.
      location.href = next;
    });
  };

  const withGoogle = () =>
    run(async () => {
      const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: next });
      if (error) return error.message || 'Google sign-in is not available';
    });

  return (
    <>
      {!sent ? (
        <form onSubmit={sendCode}>
          <div className="fld" style={{ marginTop: 0 }}>
            <label className="f" htmlFor="email">
              Work email
            </label>
            <input className="f" id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <button className="btn dark block lg" style={{ marginTop: 16 }} disabled={busy}>
            Email me a code
          </button>
          {google && (
            <>
              <div className="or">or</div>
              <button type="button" className="btn block lg" onClick={withGoogle} disabled={busy}>
                <GoogleMark />
                Continue with Google
              </button>
            </>
          )}
        </form>
      ) : (
        <form onSubmit={verify} className="rise">
          <p className="sub" style={{ margin: 0 }}>
            We sent a 6-digit code to <b>{email}</b>.
          </p>
          <div className="fld">
            <label className="f" htmlFor="otp">
              Code
            </label>
            <input
              className="f otp"
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn dark block lg" style={{ marginTop: 16 }} disabled={busy}>
            Sign in
          </button>
          <p className="small muted" style={{ textAlign: 'center', margin: '14px 0 0' }}>
            <button type="button" className="linklike" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </p>
        </form>
      )}
      {error && (
        <p className="small" role="alert" style={{ color: 'var(--red)', margin: '12px 0 0' }}>
          {error}
        </p>
      )}
    </>
  );
}
