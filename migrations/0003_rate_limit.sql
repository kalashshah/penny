-- better-auth's rate-limit counters (rateLimit.storage = 'database'): shared by every isolate, unlike its in-memory default.
CREATE TABLE IF NOT EXISTS rateLimit (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
