import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Approvals } from '@/approvals';
import { getEnv, jsonError, memoryOf, providerOf } from '@/context';
import { isConnected, Tenants } from '@/tenants';
import { registerTools } from '@/tools';

// What LlamaCalls connects to during a call: one bearer token per tenant, so a call only ever reaches its own account.
async function handle(req: Request): Promise<Response> {
  try {
    const env = getEnv();
    const auth = req.headers.get('authorization') ?? '';
    const tenant = await new Tenants(env).byMcpToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (!tenant) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (!isConnected(tenant)) return Response.json({ error: 'PayPal is not connected for this business' }, { status: 503 });
    const [provider, memory] = await Promise.all([providerOf(tenant), memoryOf(tenant)]);
    const server = new McpServer({ name: 'penny', version: '0.2.0' });
    registerTools(server, { env, tenant, provider, approvals: new Approvals(env.DB, tenant.id), memory });
    // Stateless: a Worker request may land on any isolate, so no session ids.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (e) {
    return jsonError('/mcp', e);
  }
}

export { handle as GET, handle as POST, handle as DELETE };
