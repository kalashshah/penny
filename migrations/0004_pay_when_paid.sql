-- "Pay Sam when Acme pays": a payout held as status 'waiting' until the invoice.paid webhook for after_invoice releases it.
ALTER TABLE proposals ADD COLUMN after_invoice TEXT;
CREATE INDEX idx_proposals_after_invoice ON proposals(tenant_id, after_invoice) WHERE after_invoice IS NOT NULL;
