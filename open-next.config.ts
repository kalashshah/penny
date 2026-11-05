import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every page is per-tenant and rendered on request, so there is no ISR/data cache to back.
export default defineCloudflareConfig();
