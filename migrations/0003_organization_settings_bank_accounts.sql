ALTER TABLE organizations
  ADD COLUMN ico text,
  ADD COLUMN dic text,
  ADD COLUMN street text,
  ADD COLUMN city text,
  ADD COLUMN postal_code text,
  ADD COLUMN country char(2) NOT NULL DEFAULT 'CZ',
  ADD COLUMN email text,
  ADD COLUMN phone text,
  ADD COLUMN website text,
  ADD COLUMN logo_storage_key text,
  ADD COLUMN logo_mime_type text,
  ADD COLUMN default_currency char(3) NOT NULL DEFAULT 'CZK',
  ADD COLUMN default_due_days integer NOT NULL DEFAULT 14,
  ADD COLUMN invoice_footer text,
  ADD COLUMN custom_note text,
  ADD CONSTRAINT organizations_country_valid
    CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT organizations_default_currency_valid
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT organizations_default_due_days_valid
    CHECK (default_due_days BETWEEN 0 AND 365),
  ADD CONSTRAINT organizations_logo_metadata_complete
    CHECK (
      (logo_storage_key IS NULL AND logo_mime_type IS NULL)
      OR (logo_storage_key IS NOT NULL AND logo_mime_type IS NOT NULL)
    );

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  bank_name text,
  account_prefix text,
  account_number text,
  bank_code text,
  iban text,
  bic text,
  currency char(3) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_accounts_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT bank_accounts_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT bank_accounts_prefix_valid
    CHECK (account_prefix IS NULL OR account_prefix ~ '^[0-9]{1,6}$'),
  CONSTRAINT bank_accounts_number_valid
    CHECK (account_number IS NULL OR account_number ~ '^[0-9]{1,10}$'),
  CONSTRAINT bank_accounts_code_valid
    CHECK (bank_code IS NULL OR bank_code ~ '^[0-9]{4}$'),
  CONSTRAINT bank_accounts_local_account_complete
    CHECK ((account_number IS NULL) = (bank_code IS NULL)),
  CONSTRAINT bank_accounts_payment_identifier_present
    CHECK (iban IS NOT NULL OR (account_number IS NOT NULL AND bank_code IS NOT NULL)),
  CONSTRAINT bank_accounts_default_is_active CHECK (NOT is_default OR is_active)
);

CREATE INDEX bank_accounts_organization_id_idx
  ON bank_accounts (organization_id, created_at);

CREATE UNIQUE INDEX bank_accounts_one_default_per_organization
  ON bank_accounts (organization_id)
  WHERE is_default;

CREATE UNIQUE INDEX bank_accounts_unique_iban_per_organization
  ON bank_accounts (organization_id, iban)
  WHERE iban IS NOT NULL;
