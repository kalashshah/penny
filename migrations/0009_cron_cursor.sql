-- Where a cron job that pages through tenants got to: the last tenant id it handled (NULL between passes),
-- and when its current (or last) pass started, so a short tenant list is not re-read every five minutes.
CREATE TABLE cron_cursor (
  job TEXT PRIMARY KEY,
  cursor TEXT,
  pass_started_at INTEGER NOT NULL DEFAULT 0
);
