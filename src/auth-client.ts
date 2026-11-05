import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/** The browser side of src/auth.ts: same origin, so no base URL. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
