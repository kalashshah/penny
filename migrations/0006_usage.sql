-- Per-tenant daily counters for things that cost Penny money (the reports assistant's OpenAI calls).
CREATE TABLE usage (
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,           -- UTC yyyy-mm-dd
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind, day)
);
