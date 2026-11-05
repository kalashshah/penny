-- Local dedupe for calls PayPal does not document an idempotency header for (Invoicing v2 create/send, record payment):
-- the first call with a key claims the row and stores its answer; a retry within ten minutes gets that answer back.
CREATE TABLE idempotency (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  result TEXT,                 -- JSON answer once the first call finished; NULL while it runs (or if it ended unclearly)
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
