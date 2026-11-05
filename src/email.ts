import type { Env } from './env';

/** Mail goes out through Cloudflare Email Sending; with no binding it is logged, so local login still works. */
export async function sendEmail(env: Env, m: { to: string; subject: string; text: string; html: string }): Promise<void> {
  if (!env.EMAIL) {
    console.log(`[email:dev] to=${m.to} subject="${m.subject}"\n${m.text}`);
    return;
  }
  await env.EMAIL.send({ ...m, from: env.EMAIL_FROM || 'penny@mail.keronlabs.com' });
}
