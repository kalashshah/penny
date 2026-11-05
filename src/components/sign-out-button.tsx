'use client';

import { authClient } from '@/auth-client';

export function SignOutButton() {
  return (
    <button
      className="btn sm"
      onClick={async () => {
        await authClient.signOut();
        location.href = '/login';
      }}
    >
      Sign out
    </button>
  );
}
