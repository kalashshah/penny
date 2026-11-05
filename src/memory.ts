import type { Env } from './env';

export interface Recalled {
  content: string;
  type?: string;
  createdAt?: string;
}

/** MemoryHQ for one tenant: a context block per call, facts in, facts out. Every tenant is an
 *  end user (x-end-user-id) of Penny's one workspace, so their memories never mix. */
export class Memory {
  constructor(
    private readonly env: Env,
    private readonly tenantId: string | null,
  ) {}

  get enabled(): boolean {
    return Boolean(this.env.MEMORYHQ_WORKSPACE && this.env.MEMORYHQ_KEY && this.tenantId);
  }

  static off(env: Env): Memory {
    return new Memory(env, null);
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const url = `${this.env.MEMORYHQ_URL}/api/${this.env.MEMORYHQ_WORKSPACE}${path}`;
    const init = {
      method: body ? 'POST' : 'GET',
      headers: { 'x-api-key': this.env.MEMORYHQ_KEY ?? '', 'x-end-user-id': this.tenantId ?? '', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    };
    const res = await (this.env.MEMORYHQ ? this.env.MEMORYHQ.fetch(url, init) : fetch(url, init));
    if (!res.ok && res.status !== 202) throw new Error(`MemoryHQ ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** A markdown block for the system prompt: profiles plus the memories nearest to `query`. Empty when memory is off or down. */
  async contextPrompt(query: string): Promise<string> {
    if (!this.enabled) return '';
    try {
      const j = await this.call<{ prompt?: string }>('/context', { query, limit: 15 });
      return j.prompt ?? '';
    } catch (e) {
      console.error('memory.context_failed', String(e));
      return '';
    }
  }

  async remember(content: string, infer = true): Promise<string> {
    if (!this.enabled) return 'Memory is not set up for this business, so this was not saved.';
    const j = await this.call<{ added?: unknown[]; updated?: number; queued?: boolean }>('/memories', { scope: 'user', content, infer });
    if (j.queued) return 'Saved; being filed in the background.';
    return `Saved: ${j.added?.length ?? 0} new, ${j.updated ?? 0} updated.`;
  }

  async recall(query: string, limit = 8): Promise<Recalled[]> {
    if (!this.enabled) return [];
    const j = await this.call<{ memories?: { content?: string; type?: string; createdAt?: string }[] }>('/memories/search', { query, scope: 'all', limit });
    return (j.memories ?? []).map((m) => ({ content: m.content ?? '', type: m.type, createdAt: m.createdAt }));
  }
}
