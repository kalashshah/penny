import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `pnpm typecheck` runs tsc over the whole repo (worker entry and tests included); no need to do it twice.
  typescript: { ignoreBuildErrors: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // No one may frame Penny: the dashboard's approve buttons move money.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          // /p links carry the page key in the query string; keep it off other sites.
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};

export default nextConfig;

// `next dev` gets the wrangler.jsonc bindings (D1, vars, .dev.vars secrets) through getCloudflareContext().
initOpenNextCloudflareForDev();
