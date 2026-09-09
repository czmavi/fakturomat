ALTER TABLE bank_connections
  ADD COLUMN current_balance numeric(19, 4),
  ADD COLUMN balance_currency text,
  ADD COLUMN balance_date date,
  ADD CONSTRAINT bank_connections_balance_currency_valid
    CHECK (
      balance_currency IS NULL
      OR balance_currency ~ '^[A-Z]{3}$'
    ),
  ADD CONSTRAINT bank_connections_balance_complete
    CHECK (
      (current_balance IS NULL AND balance_currency IS NULL AND balance_date IS NULL)
      OR
      (current_balance IS NOT NULL AND balance_currency IS NOT NULL AND balance_date IS NOT NULL)
    );

CREATE TABLE bank_transactions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  bank_account_id uuid NOT NULL,
  provider text NOT NULL,
  provider_transaction_id text NOT NULL,
  booking_date date NOT NULL,
  amount numeric(19, 4) NOT NULL,
  currency text NOT NULL,
  counterparty_account text,
  counterparty_bank_code text,
  counterparty_name text,
  variable_symbol text,
  constant_symbol text,
  specific_symbol text,
  message text,
  raw_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_transactions_account_fk
    FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES bank_accounts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT bank_transactions_provider_valid CHECK (provider IN ('FIO')),
  CONSTRAINT bank_transactions_provider_id_valid
    CHECK (length(provider_transaction_id) BETWEEN 1 AND 256),
  CONSTRAINT bank_transactions_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  UNIQUE (organization_id, id),
  UNIQUE (provider, bank_account_id, provider_transaction_id)
);

CREATE INDEX bank_transactions_organization_date_idx
  ON bank_transactions (organization_id, booking_date DESC, id);

CREATE INDEX bank_transactions_account_date_idx
  ON bank_transactions (bank_account_id, booking_date DESC, id);
