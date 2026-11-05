-- better-auth owns these four tables: camelCase columns, TEXT timestamps.
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  image TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id),
  token TEXT UNIQUE NOT NULL,
  expiresAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id),
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  idToken TEXT,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now')),
  updatedAt TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(userId);
CREATE INDEX IF NOT EXISTS idx_account_user ON account(userId);

-- One business per signed-in user. Every secret is sealed with PENNY_MASTER_KEY.
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES user(id),
  business_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  approval_threshold REAL NOT NULL DEFAULT 100,
  provider TEXT NOT NULL DEFAULT 'paypal',
  paypal_env TEXT NOT NULL DEFAULT 'sandbox',
  paypal_client_id TEXT,
  paypal_secret_ct TEXT,
  paypal_secret_iv TEXT,
  paypal_webhook_id TEXT,
  paypal_connected_at INTEGER,
  memory_workspace_id TEXT,
  memory_key_ct TEXT,
  memory_key_iv TEXT,
  mcp_token_hash TEXT NOT NULL UNIQUE,
  mcp_token_ct TEXT NOT NULL,
  mcp_token_iv TEXT NOT NULL,
  page_key TEXT NOT NULL UNIQUE,
  avatar_id TEXT,
  voice_id TEXT,
  telegram_chat_id TEXT,
  created_at INTEGER NOT NULL
);

ALTER TABLE events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE proposals ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE calls ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
ALTER TABLE alerts ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_events_tenant ON events(tenant_id, received_at);
CREATE INDEX idx_proposals_tenant ON proposals(tenant_id, created_at);
CREATE INDEX idx_calls_tenant ON calls(tenant_id, started_at);
CREATE INDEX idx_alerts_tenant ON alerts(tenant_id, created_at);
