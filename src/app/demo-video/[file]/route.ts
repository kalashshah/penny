import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * public/demos/*.mp4 with byte ranges. Workers static assets answer a Range
 * request with the whole file and a 200, and Safari will not play a <video>
 * from a server that does that. The clips are ~0.6 MB, so slicing here is cheap.
 */
export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^[a-z-]+\.mp4$/.test(file)) return new Response('not found', { status: 404 });

  const url = new URL(`/demos/${file}`, request.url);
  const { env } = await getCloudflareContext({ async: true });
  let upstream = await (env as { ASSETS?: { fetch(u: URL): Promise<Response> } }).ASSETS?.fetch(url).catch(() => undefined);
  // `next dev` has no built assets; it serves public/ itself.
  if (!upstream?.ok) upstream = await fetch(url);
  if (!upstream.ok) return new Response('not found', { status: 404 });

  const body = await upstream.arrayBuffer();
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') ?? '');
  if (!m || (!m[1] && !m[2])) return new Response(body, { headers: { ...headers, 'Content-Length': String(body.byteLength) } });

  const size = body.byteLength;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}
