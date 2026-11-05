-- One alert per tenant per event: a webhook replay racing the first delivery cannot alert twice (createAlert inserts OR IGNOREs).
-- Older duplicates keep their alert but give up the key, so the index can be built.
UPDATE alerts SET event_id = NULL
WHERE event_id IS NOT NULL
  AND rowid NOT IN (SELECT MIN(rowid) FROM alerts WHERE event_id IS NOT NULL GROUP BY tenant_id, event_id);
CREATE UNIQUE INDEX idx_alerts_event ON alerts(tenant_id, event_id) WHERE event_id IS NOT NULL;
