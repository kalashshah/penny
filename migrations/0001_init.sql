-- Provider webhook events, keyed by the provider's event id so redeliveries are no-ops.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

-- Money-out actions. Above the threshold they wait here for a human yes.
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- payout | refund | accept_dispute
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  input TEXT NOT NULL,         -- JSON the provider call is rebuilt from
  status TEXT NOT NULL,        -- pending | approved | rejected | expired | done | failed
  approved_by TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

-- Calls Penny has started on LlamaCalls; transcripts go to memory once they end.
CREATE TABLE calls (
  room TEXT PRIMARY KEY,
  join_url TEXT NOT NULL,
  reason TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  ingested INTEGER NOT NULL DEFAULT 0
);

-- Things Penny wants to tell you; the dashboard turns one into a call with one click.
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  page TEXT,
  created_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);
