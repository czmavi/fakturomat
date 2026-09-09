CREATE TABLE bank_connections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  provider text NOT NULL,
  encrypted_credentials text NOT NULL,
  last_sync_at timestamptz,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_connections_account_fk
    FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES bank_accounts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT bank_connections_provider_valid CHECK (provider IN ('FIO')),
  CONSTRAINT bank_connections_status_valid
    CHECK (status IN ('CONFIGURED', 'ACTIVE', 'ERROR', 'DISABLED')),
  CONSTRAINT bank_connections_credentials_not_empty
    CHECK (length(encrypted_credentials) > 0),
  UNIQUE (organization_id, id),
  UNIQUE (bank_account_id, provider)
);

CREATE INDEX bank_connections_organization_account_idx
  ON bank_connections (organization_id, bank_account_id);
