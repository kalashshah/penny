-- A webhook is recorded before it is acted on; processed = 1 only once the alert (and any release) is done,
-- so a redelivery after a failure halfway is acted on again instead of dropped as a duplicate.
ALTER TABLE events ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;
-- Everything already stored was handled under the old code.
UPDATE events SET processed = 1;
