-- The weekly digest, one row per tenant per week: inserting the row claims the week, so overlapping cron runs send it once.
CREATE TABLE digests (
  tenant_id TEXT NOT NULL,
  week TEXT NOT NULL,          -- UTC yyyy-mm-dd of that week's Monday
  sent_at INTEGER NOT NULL,
  via TEXT,                    -- email | alert, once sent
  PRIMARY KEY (tenant_id, week)
);
