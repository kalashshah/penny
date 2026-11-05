import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import type { Env } from './env';

type Auth = ReturnType<typeof betterAuth>;

// One instance per isolate: building better-auth is CPU-heavy. Keyed by the D1 binding.
const instances = new WeakMap<object, Auth>();

export function getAuth(env: Env): Auth {
  const cached = instances.get(env.DB);
  if (cached) return cached;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : undefined;
  // Cast once: better-auth's plugin generics make the configured type incompatible with the plain one.
  const auth = betterAuth({
    // Backed directly by the D1 binding, as LlamaCalls does.
    database: env.DB as unknown as never,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.PUBLIC_URL,
    trustedOrigins: [env.PUBLIC_URL],
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    // Counted in D1 so every isolate shares them. Login codes are capped per IP per hour, so the form can't spam
    // inboxes from our sending domain. ponytail: per-IP only; add a per-address cap if someone rotates IPs.
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: { '/email-otp/send-verification-otp': { window: 3600, max: 10 } },
    },
    ...(google ? { socialProviders: google } : {}),
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        async sendVerificationOTP({ email, otp }) {
          await sendEmail(env, { to: email, subject: 'Your Penny login code', text: `Your Penny login code is ${otp}. It expires in 10 minutes.`, html: otpHtml(otp) });
        },
      }),
    ],
  }) as unknown as Auth;
  instances.set(env.DB, auth);
  return auth;
}

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
}

export async function sessionUser(env: Env, headers: Headers): Promise<SessionUser | null> {
  try {
    const s = await getAuth(env).api.getSession({ headers });
    return s?.user ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
  } catch (e) {
    console.error('session_failed', String(e));
    return null;
  }
}

export function googleEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Login codes go out through Cloudflare Email Sending; with no binding they are logged, so local login still works. */
async function sendEmail(env: Env, m: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!env.EMAIL) {
    console.log(`[email:dev] to=${m.to} subject="${m.subject}"\n${m.text}`);
    return;
  }
  await env.EMAIL.send({ ...m, from: env.EMAIL_FROM || 'penny@mail.keronlabs.com' });
}

function otpHtml(otp: string): string {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#15171c;padding:32px"><div style="max-width:480px;margin:0 auto;text-align:center"><div style="font-weight:700;font-size:20px">Penny</div><p style="margin:24px 0 16px">Here is your login code.</p><div style="display:inline-block;background:#eef2fb;border-radius:12px;padding:20px 28px;font:700 34px/1 Menlo,monospace;letter-spacing:8px">${otp}</div><p style="color:#68707f;font-size:14px;margin-top:24px">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p></div></body></html>`;
}
