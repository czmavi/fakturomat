-- Cloudflare D1 / SQLite. Monetary values are signed INTEGER units of 0.0001.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email text NOT NULL,
  display_name text NOT NULL,
  is_active INTEGER NOT NULL DEFAULT true,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  email_verified INTEGER NOT NULL DEFAULT false,
  image text,
  CONSTRAINT users_email_normalized CHECK (email = lower(email)),
  CONSTRAINT users_email_not_empty CHECK (length(email) > 0),
  CONSTRAINT users_display_name_not_empty CHECK (length(display_name) > 0)
);

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  type text NOT NULL,
  official_name text NOT NULL,
  display_name text NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  ico text,
  dic text,
  street text,
  city text,
  postal_code text,
  country TEXT NOT NULL DEFAULT 'CZ',
  email text,
  phone text,
  website text,
  logo_storage_key text,
  logo_mime_type text,
  default_currency TEXT NOT NULL DEFAULT 'CZK',
  default_due_days integer NOT NULL DEFAULT 14,
  invoice_footer text,
  custom_note text,
  default_invoice_template_id TEXT NOT NULL
    DEFAULT '10000000-0000-4000-8000-000000000001'
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  CONSTRAINT organizations_type_valid
    CHECK (type IN ('OSVC', 'ASSOCIATION', 'SRO', 'OTHER')),
  CONSTRAINT organizations_official_name_not_empty
    CHECK (length(trim(official_name)) > 0),
  CONSTRAINT organizations_display_name_not_empty
    CHECK (length(trim(display_name)) > 0),
  CONSTRAINT organizations_country_valid
    CHECK ((length(country) = 2 AND country NOT GLOB '*[^A-Z]*')),
  CONSTRAINT organizations_default_currency_valid
    CHECK ((length(default_currency) = 3 AND default_currency NOT GLOB '*[^A-Z]*')),
  CONSTRAINT organizations_default_due_days_valid
    CHECK (default_due_days BETWEEN 0 AND 365),
  CONSTRAINT organizations_logo_metadata_complete
    CHECK (
      (logo_storage_key IS NULL AND logo_mime_type IS NULL)
      OR (logo_storage_key IS NOT NULL AND logo_mime_type IS NOT NULL)
    )
);

CREATE TABLE organization_memberships (
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_memberships_role_valid
    CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  bank_name text,
  account_prefix text,
  account_number text,
  bank_code text,
  iban text,
  bic text,
  currency TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT false,
  is_active INTEGER NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT bank_accounts_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT bank_accounts_currency_valid CHECK ((length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  CONSTRAINT bank_accounts_prefix_valid
    CHECK (account_prefix IS NULL OR (length(account_prefix) BETWEEN 1 AND 6 AND account_prefix NOT GLOB '*[^0-9]*')),
  CONSTRAINT bank_accounts_number_valid
    CHECK (account_number IS NULL OR (length(account_number) BETWEEN 1 AND 10 AND account_number NOT GLOB '*[^0-9]*')),
  CONSTRAINT bank_accounts_code_valid
    CHECK (bank_code IS NULL OR (length(bank_code) BETWEEN 4 AND 4 AND bank_code NOT GLOB '*[^0-9]*')),
  CONSTRAINT bank_accounts_local_account_complete
    CHECK ((account_number IS NULL) = (bank_code IS NULL)),
  CONSTRAINT bank_accounts_payment_identifier_present
    CHECK (iban IS NOT NULL OR (account_number IS NOT NULL AND bank_code IS NOT NULL)),
  CONSTRAINT bank_accounts_default_is_active CHECK (NOT is_default OR is_active),
  CONSTRAINT bank_accounts_organization_id_id_unique
    UNIQUE (organization_id, id)
);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  ico text,
  dic text,
  street text,
  city text,
  postal_code text,
  country TEXT NOT NULL DEFAULT 'CZ',
  email text,
  phone text,
  default_due_days integer,
  note text,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT contacts_type_valid CHECK (type IN ('PERSON', 'COMPANY')),
  CONSTRAINT contacts_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT contacts_country_valid CHECK ((length(country) = 2 AND country NOT GLOB '*[^A-Z]*')),
  CONSTRAINT contacts_default_due_days_valid
    CHECK (default_due_days IS NULL OR default_due_days BETWEEN 0 AND 365),
  CONSTRAINT contacts_organization_id_id_unique
    UNIQUE (organization_id, id)
);

CREATE TABLE invoice_templates (
  id TEXT PRIMARY KEY NOT NULL,
  name text NOT NULL,
  description text,
  is_active INTEGER NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  current_version_id TEXT,
  organization_id TEXT
    REFERENCES organizations (id) ON DELETE RESTRICT,
  source_template_id TEXT
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  CONSTRAINT invoice_templates_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT invoice_templates_current_version_fk
    FOREIGN KEY (id, current_version_id)
    REFERENCES invoice_template_versions (invoice_template_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT invoice_templates_source_requires_organization
    CHECK (source_template_id IS NULL OR organization_id IS NOT NULL)
);

CREATE TABLE invoice_template_versions (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_template_id TEXT NOT NULL
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  html text NOT NULL,
  css text NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT invoice_template_versions_version_positive CHECK (version > 0),
  CONSTRAINT invoice_template_versions_html_not_empty CHECK (length(trim(html)) > 0),
  UNIQUE (invoice_template_id, version),
  UNIQUE (invoice_template_id, id)
);

CREATE TABLE invoice_number_sequences (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  padding integer NOT NULL DEFAULT 4,
  is_default INTEGER NOT NULL DEFAULT false,
  is_active INTEGER NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT invoice_number_sequences_name_not_empty
    CHECK (length(trim(name)) > 0),
  CONSTRAINT invoice_number_sequences_prefix_valid
    CHECK ((length(prefix) <= 20 AND prefix NOT GLOB '*[^A-Z0-9._/-]*')),
  CONSTRAINT invoice_number_sequences_padding_valid
    CHECK (padding BETWEEN 1 AND 9),
  CONSTRAINT invoice_number_sequences_default_active
    CHECK (NOT is_default OR is_active),
  UNIQUE (organization_id, id)
);

CREATE TABLE invoice_number_counters (
  invoice_number_sequence_id TEXT NOT NULL
    REFERENCES invoice_number_sequences (id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_value INTEGER NOT NULL CHECK (last_value <= 9007199254740991),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  PRIMARY KEY (invoice_number_sequence_id, year),
  CONSTRAINT invoice_number_counters_year_valid CHECK (year BETWEEN 2000 AND 9999),
  CONSTRAINT invoice_number_counters_value_positive CHECK (last_value > 0)
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  number_sequence_id TEXT NOT NULL,
  bank_account_id TEXT,
  invoice_template_id TEXT NOT NULL
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  template_version_id TEXT,
  number text,
  variable_symbol text,
  status text NOT NULL DEFAULT 'DRAFT',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal INTEGER NOT NULL DEFAULT 0 CHECK (subtotal IS NULL OR (typeof(subtotal) = 'integer' AND abs(subtotal) <= 9007199254740991)),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total IS NULL OR (typeof(total) = 'integer' AND abs(total) <= 9007199254740991)),
  supplier_snapshot TEXT,
  customer_snapshot TEXT,
  bank_account_snapshot TEXT,
  note text,
  issued_at INTEGER,
  paid_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  issued_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  document_ready INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'DRAFT' THEN 0 ELSE 1 END) STORED,
  issued_document_invoice_id TEXT GENERATED ALWAYS AS (CASE WHEN status = 'DRAFT' THEN NULL ELSE id END) STORED,
  UNIQUE (id, document_ready),
  FOREIGN KEY (issued_document_invoice_id) REFERENCES invoice_documents(invoice_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT invoices_contact_fk
    FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_number_sequence_fk
    FOREIGN KEY (organization_id, number_sequence_id)
    REFERENCES invoice_number_sequences (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_bank_account_fk
    FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES bank_accounts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_template_version_fk
    FOREIGN KEY (invoice_template_id, template_version_id)
    REFERENCES invoice_template_versions (invoice_template_id, id) ON DELETE RESTRICT,
  CONSTRAINT invoices_status_valid
    CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED')),
  CONSTRAINT invoices_number_not_empty
    CHECK (number IS NULL OR length(trim(number)) > 0),
  CONSTRAINT invoices_variable_symbol_valid
    CHECK (variable_symbol IS NULL OR (length(variable_symbol) BETWEEN 1 AND 10 AND variable_symbol NOT GLOB '*[^0-9]*')),
  CONSTRAINT invoices_currency_valid CHECK ((length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  CONSTRAINT invoices_dates_valid CHECK (due_date >= issue_date),
  CONSTRAINT invoices_amounts_valid
    CHECK (subtotal >= 0 AND total >= 0 AND subtotal = total),
  CONSTRAINT invoices_draft_has_no_issued_data CHECK (
    status <> 'DRAFT' OR (
      number IS NULL
      AND supplier_snapshot IS NULL
      AND customer_snapshot IS NULL
      AND bank_account_snapshot IS NULL
      AND template_version_id IS NULL
      AND issued_at IS NULL
      AND paid_at IS NULL
    )
  ),
  CONSTRAINT invoices_issued_data_complete CHECK (
    status = 'DRAFT' OR (
      number IS NOT NULL
      AND supplier_snapshot IS NOT NULL
      AND customer_snapshot IS NOT NULL
      AND template_version_id IS NOT NULL
      AND issued_at IS NOT NULL
    )
  ),
  CONSTRAINT invoices_organization_id_id_unique
    UNIQUE (organization_id, id)
);

CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity TEXT NOT NULL,
  unit text NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price IS NULL OR (typeof(unit_price) = 'integer' AND abs(unit_price) <= 9007199254740991)),
  total INTEGER NOT NULL CHECK (total IS NULL OR (typeof(total) = 'integer' AND abs(total) <= 9007199254740991)),
  position integer NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT invoice_items_description_not_empty
    CHECK (length(trim(description)) > 0),
  CONSTRAINT invoice_items_unit_not_empty CHECK (length(trim(unit)) > 0),
  CONSTRAINT invoice_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT invoice_items_amounts_valid CHECK (unit_price >= 0 AND total >= 0),
  CONSTRAINT invoice_items_position_positive CHECK (position > 0),
  UNIQUE (invoice_id, position)
);

CREATE TABLE invoice_documents (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  type text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  storage_provider TEXT NOT NULL CHECK (storage_provider = 'r2'),
  document_ready INTEGER NOT NULL DEFAULT 1 CHECK (document_ready = 1),
  etag text,
  UNIQUE (invoice_id),
  FOREIGN KEY (invoice_id, document_ready) REFERENCES invoices(id, document_ready) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT invoice_documents_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_documents_type_valid CHECK (type IN ('PDF')),
  CONSTRAINT invoice_documents_storage_key_valid
    CHECK ((length(storage_key) > 1 AND storage_key NOT GLOB '*[^A-Za-z0-9._/-]*' AND storage_key NOT LIKE '%..%')),
  CONSTRAINT invoice_documents_sha256_valid
    CHECK ((length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  CONSTRAINT invoice_documents_size_positive CHECK (size > 0),
  UNIQUE (invoice_id, type)
);

CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active INTEGER NOT NULL DEFAULT true,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT expense_categories_name_not_empty
    CHECK (length(trim(name)) > 0),
  UNIQUE (organization_id, id)
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT,
  document_type text NOT NULL,
  supplier_name text NOT NULL,
  supplier_invoice_number text,
  issue_date TEXT,
  taxable_supply_date TEXT,
  due_date TEXT,
  payment_date TEXT,
  description text NOT NULL,
  category_id TEXT,
  currency TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK (total_amount IS NULL OR (typeof(total_amount) = 'integer' AND abs(total_amount) <= 9007199254740991)),
  note text,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT expenses_contact_fk
    FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT expenses_category_fk
    FOREIGN KEY (organization_id, category_id)
    REFERENCES expense_categories (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT expenses_document_type_valid
    CHECK (document_type IN ('INVOICE', 'RECEIPT', 'OTHER')),
  CONSTRAINT expenses_supplier_name_not_empty
    CHECK (length(trim(supplier_name)) > 0),
  CONSTRAINT expenses_description_not_empty
    CHECK (length(trim(description)) > 0),
  CONSTRAINT expenses_currency_valid CHECK ((length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  CONSTRAINT expenses_total_amount_nonnegative CHECK (total_amount >= 0),
  UNIQUE (organization_id, id)
);

CREATE TABLE expense_vat_lines (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  position integer NOT NULL,
  vat_rate TEXT NOT NULL,
  base_amount INTEGER NOT NULL CHECK (base_amount IS NULL OR (typeof(base_amount) = 'integer' AND abs(base_amount) <= 9007199254740991)),
  vat_amount INTEGER NOT NULL CHECK (vat_amount IS NULL OR (typeof(vat_amount) = 'integer' AND abs(vat_amount) <= 9007199254740991)),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT expense_vat_lines_expense_fk
    FOREIGN KEY (organization_id, expense_id)
    REFERENCES expenses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT expense_vat_lines_position_positive CHECK (position > 0),
  CONSTRAINT expense_vat_lines_rate_nonnegative CHECK (vat_rate >= 0),
  CONSTRAINT expense_vat_lines_base_nonnegative CHECK (base_amount >= 0),
  CONSTRAINT expense_vat_lines_vat_nonnegative CHECK (vat_amount >= 0),
  UNIQUE (organization_id, id),
  UNIQUE (expense_id, position)
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size INTEGER NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT attachments_expense_fk
    FOREIGN KEY (organization_id, expense_id)
    REFERENCES expenses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT attachments_filename_valid
    CHECK (length(filename) BETWEEN 1 AND 255),
  CONSTRAINT attachments_mime_type_valid
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT attachments_size_valid CHECK (size > 0 AND size <= 20971520),
  CONSTRAINT attachments_storage_key_valid
    CHECK ((length(storage_key) > 1 AND storage_key NOT GLOB '*[^A-Za-z0-9._/-]*' AND storage_key NOT LIKE '%..%')),
  CONSTRAINT attachments_sha256_valid CHECK ((length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  UNIQUE (organization_id, id)
);

CREATE TABLE bank_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  provider text NOT NULL,
  encrypted_credentials text NOT NULL,
  last_sync_at INTEGER,
  status text NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  current_balance INTEGER CHECK (current_balance IS NULL OR (typeof(current_balance) = 'integer' AND abs(current_balance) <= 9007199254740991)),
  balance_currency text,
  balance_date TEXT,
  CONSTRAINT bank_connections_account_fk
    FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES bank_accounts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT bank_connections_provider_valid CHECK (provider IN ('FIO')),
  CONSTRAINT bank_connections_status_valid
    CHECK (status IN ('CONFIGURED', 'ACTIVE', 'ERROR', 'DISABLED')),
  CONSTRAINT bank_connections_credentials_not_empty
    CHECK (length(encrypted_credentials) > 0),
  UNIQUE (organization_id, id),
  UNIQUE (bank_account_id, provider),
  CONSTRAINT bank_connections_balance_currency_valid
    CHECK (
      balance_currency IS NULL
      OR (length(balance_currency) = 3 AND balance_currency NOT GLOB '*[^A-Z]*')
    ),
  CONSTRAINT bank_connections_balance_complete
    CHECK (
      (current_balance IS NULL AND balance_currency IS NULL AND balance_date IS NULL)
      OR
      (current_balance IS NOT NULL AND balance_currency IS NOT NULL AND balance_date IS NOT NULL)
    )
);

CREATE TABLE bank_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  provider text NOT NULL,
  provider_transaction_id text NOT NULL,
  booking_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount IS NULL OR (typeof(amount) = 'integer' AND abs(amount) <= 9007199254740991)),
  currency text NOT NULL,
  counterparty_account text,
  counterparty_bank_code text,
  counterparty_name text,
  variable_symbol text,
  constant_symbol text,
  specific_symbol text,
  message text,
  raw_data TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT bank_transactions_account_fk
    FOREIGN KEY (organization_id, bank_account_id)
    REFERENCES bank_accounts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT bank_transactions_provider_valid CHECK (provider IN ('FIO')),
  CONSTRAINT bank_transactions_provider_id_valid
    CHECK (length(provider_transaction_id) BETWEEN 1 AND 256),
  CONSTRAINT bank_transactions_currency_valid CHECK ((length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*')),
  UNIQUE (organization_id, id),
  UNIQUE (provider, bank_account_id, provider_transaction_id),
  CONSTRAINT bank_transactions_amount_nonzero CHECK (amount <> 0)
);

CREATE TABLE invoice_payments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount IS NULL OR (typeof(amount) = 'integer' AND abs(amount) <= 9007199254740991)),
  match_type text NOT NULL,
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT invoice_payments_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_payments_transaction_fk
    FOREIGN KEY (organization_id, bank_transaction_id)
    REFERENCES bank_transactions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT invoice_payments_match_type_valid
    CHECK (match_type IN ('AUTO', 'MANUAL')),
  UNIQUE (organization_id, id),
  UNIQUE (invoice_id, bank_transaction_id)
);

CREATE TABLE expense_payments (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  expense_id TEXT NOT NULL,
  bank_transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount IS NULL OR (typeof(amount) = 'integer' AND abs(amount) <= 9007199254740991)),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  CONSTRAINT expense_payments_expense_fk
    FOREIGN KEY (organization_id, expense_id)
    REFERENCES expenses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT expense_payments_transaction_fk
    FOREIGN KEY (organization_id, bank_transaction_id)
    REFERENCES bank_transactions (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT expense_payments_amount_positive CHECK (amount > 0),
  UNIQUE (organization_id, id),
  UNIQUE (expense_id, bank_transaction_id)
);

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope text,
  password text,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT auth_accounts_provider_account_unique
    UNIQUE (provider_id, account_id)
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL,
  token text NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip_address text,
  user_agent text,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE INDEX organization_memberships_user_id_idx
  ON organization_memberships (user_id, organization_id);

CREATE INDEX bank_accounts_organization_id_idx
  ON bank_accounts (organization_id, created_at);

CREATE UNIQUE INDEX bank_accounts_one_default_per_organization
  ON bank_accounts (organization_id)
  WHERE is_default;

CREATE UNIQUE INDEX bank_accounts_unique_iban_per_organization
  ON bank_accounts (organization_id, iban)
  WHERE iban IS NOT NULL;

CREATE INDEX contacts_organization_active_name_idx
  ON contacts (organization_id, archived_at, lower(name));

CREATE INDEX contacts_organization_ico_idx
  ON contacts (organization_id, ico)
  WHERE ico IS NOT NULL;

CREATE UNIQUE INDEX invoice_number_sequences_name_per_organization
  ON invoice_number_sequences (organization_id, lower(name));

CREATE UNIQUE INDEX invoice_number_sequences_one_default_per_organization
  ON invoice_number_sequences (organization_id)
  WHERE is_default;

CREATE UNIQUE INDEX invoices_number_per_sequence
  ON invoices (number_sequence_id, number)
  WHERE number IS NOT NULL;

CREATE INDEX invoices_organization_status_date_idx
  ON invoices (organization_id, status, issue_date DESC, created_at DESC);

CREATE INDEX invoices_organization_contact_idx
  ON invoices (organization_id, contact_id);

CREATE INDEX invoice_documents_organization_invoice_idx
  ON invoice_documents (organization_id, invoice_id);

CREATE UNIQUE INDEX expense_categories_name_per_organization
  ON expense_categories (organization_id, lower(name));

CREATE INDEX expenses_organization_issue_date_idx
  ON expenses (organization_id, issue_date DESC, created_at DESC);

CREATE INDEX expenses_organization_category_idx
  ON expenses (organization_id, category_id, issue_date DESC);

CREATE INDEX expenses_organization_document_type_idx
  ON expenses (organization_id, document_type, issue_date DESC);

CREATE INDEX expense_vat_lines_organization_expense_idx
  ON expense_vat_lines (organization_id, expense_id, position);

CREATE INDEX attachments_organization_expense_idx
  ON attachments (organization_id, expense_id, created_at, id);

CREATE INDEX bank_connections_organization_account_idx
  ON bank_connections (organization_id, bank_account_id);

CREATE INDEX bank_transactions_organization_date_idx
  ON bank_transactions (organization_id, booking_date DESC, id);

CREATE INDEX bank_transactions_account_date_idx
  ON bank_transactions (bank_account_id, booking_date DESC, id);

CREATE INDEX invoice_payments_invoice_idx
  ON invoice_payments (organization_id, invoice_id, created_at);

CREATE INDEX invoice_payments_transaction_idx
  ON invoice_payments (organization_id, bank_transaction_id, created_at);

CREATE INDEX expense_payments_expense_idx
  ON expense_payments (organization_id, expense_id, created_at);

CREATE INDEX expense_payments_transaction_idx
  ON expense_payments (organization_id, bank_transaction_id, created_at);

CREATE UNIQUE INDEX invoice_templates_organization_source_unique
  ON invoice_templates (organization_id, source_template_id)
  WHERE source_template_id IS NOT NULL;

CREATE INDEX invoice_templates_organization_id_idx
  ON invoice_templates (organization_id, id);

CREATE INDEX auth_accounts_user_id_idx ON auth_accounts (user_id);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);

CREATE INDEX auth_verifications_identifier_idx
  ON auth_verifications (identifier);

INSERT INTO invoice_templates (id, name, description)
VALUES (
  '10000000-0000-4000-8000-000000000001',
  'Čistá profesionální',
  'Výchozí jednostránková šablona pro faktury bez DPH.'
);

INSERT INTO invoice_template_versions (
  id, invoice_template_id, version, html, css
)
VALUES (
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  1,
  '
<main class="invoice">
  <header class="invoice-header">
    <section>
      <p class="eyebrow">FAKTURA</p>
      <h1>{{invoice.number}}</h1>
    </section>
    <section class="supplier-logo">{{supplier.logo}}</section>
  </header>

  <section class="parties">
    <div>
      <p class="label">Dodavatel</p>
      <h2>{{supplier.name}}</h2>
      <p>{{supplier.address}}</p>
      <p>IČO: {{supplier.ico}} &nbsp; DIČ: {{supplier.dic}}</p>
      <p>{{supplier.email}} &nbsp; {{supplier.phone}}</p>
      <p>{{supplier.website}}</p>
    </div>
    <div>
      <p class="label">Odběratel</p>
      <h2>{{customer.name}}</h2>
      <p>{{customer.address}}</p>
      <p>IČO: {{customer.ico}} &nbsp; DIČ: {{customer.dic}}</p>
    </div>
  </section>

  <section class="meta">
    <div><span>Datum vystavení</span><strong>{{invoice.issueDate}}</strong></div>
    <div><span>Datum splatnosti</span><strong>{{invoice.dueDate}}</strong></div>
    <div><span>Variabilní symbol</span><strong>{{invoice.variableSymbol}}</strong></div>
  </section>

  <table>
    <thead><tr><th>Popis</th><th>Množství</th><th>Jednotka</th><th>Cena</th><th>Celkem</th></tr></thead>
    <tbody>{{invoice.items}}</tbody>
  </table>

  <section class="totals">
    <div><span>Mezisoučet</span><strong>{{invoice.subtotal}} {{invoice.currency}}</strong></div>
    <div class="grand-total"><span>Celkem k úhradě</span><strong>{{invoice.total}} {{invoice.currency}}</strong></div>
  </section>

  <section class="payment">
    <div>
      <p class="label">Platební údaje</p>
      <p>Účet: <strong>{{payment.account}}</strong></p>
      <p>IBAN: <strong>{{payment.iban}}</strong></p>
    </div>
    <div class="qr">{{payment.qr}}</div>
  </section>

  <section class="note"><span>Poznámka</span><p>{{invoice.note}}</p></section>
</main>
  ',
  '
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #18211c; background: #fff; font-family: Arial, sans-serif; font-size: 12px; line-height: 1.5; }
.invoice { width: 100%; }
.invoice-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 22px; border-bottom: 2px solid #183e2a; }
.eyebrow, .label { margin: 0 0 5px; color: #277a4c; font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h1 { margin: 0; font-size: 30px; letter-spacing: -.03em; }
h2 { margin: 0 0 5px; font-size: 16px; }
p { margin: 2px 0; }
.supplier-logo { max-width: 150px; max-height: 60px; text-align: right; }
.supplier-logo img { max-width: 150px; max-height: 60px; object-fit: contain; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 35px; padding: 25px 0; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 14px; background: #f1f6f2; border-radius: 8px; }
.meta div, .totals div { display: flex; justify-content: space-between; gap: 10px; }
.meta span, .totals span, .note span { color: #69736c; }
table { width: 100%; margin-top: 24px; border-collapse: collapse; }
th { padding: 9px 8px; border-bottom: 1px solid #b9c4bb; color: #69736c; font-size: 10px; text-align: left; text-transform: uppercase; }
td { padding: 11px 8px; border-bottom: 1px solid #e0e5e1; }
th:not(:first-child), td:not(:first-child) { text-align: right; }
.totals { width: 48%; margin: 18px 0 0 auto; }
.totals div { padding: 5px 8px; }
.totals .grand-total { margin-top: 5px; padding: 12px; color: #fff; background: #183e2a; border-radius: 8px; font-size: 15px; }
.payment { display: flex; justify-content: space-between; align-items: center; margin-top: 28px; padding: 18px; border: 1px solid #d9dfda; border-radius: 8px; }
.qr svg { width: 90px; height: 90px; }
.note { margin-top: 22px; padding-top: 15px; border-top: 1px solid #e0e5e1; }
  '
);

UPDATE invoice_templates
SET current_version_id = '10000000-0000-4000-8000-000000000002'
WHERE id = '10000000-0000-4000-8000-000000000001';



CREATE TABLE _write_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);
INSERT INTO _write_epoch VALUES (1, 0);
CREATE TABLE _write_guard (id INTEGER PRIMARY KEY CHECK (id = 1), valid INTEGER CONSTRAINT transaction_conflict CHECK (valid = 1));
INSERT INTO _write_guard VALUES (1, 1);

CREATE TRIGGER epoch_users_insert AFTER INSERT ON users BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_users_update AFTER UPDATE ON users BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_users_delete AFTER DELETE ON users BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organizations_insert AFTER INSERT ON organizations BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organizations_update AFTER UPDATE ON organizations BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organizations_delete AFTER DELETE ON organizations BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organization_memberships_insert AFTER INSERT ON organization_memberships BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organization_memberships_update AFTER UPDATE ON organization_memberships BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_organization_memberships_delete AFTER DELETE ON organization_memberships BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_accounts_insert AFTER INSERT ON bank_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_accounts_update AFTER UPDATE ON bank_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_accounts_delete AFTER DELETE ON bank_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_contacts_insert AFTER INSERT ON contacts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_contacts_update AFTER UPDATE ON contacts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_contacts_delete AFTER DELETE ON contacts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_templates_insert AFTER INSERT ON invoice_templates BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_templates_update AFTER UPDATE ON invoice_templates BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_templates_delete AFTER DELETE ON invoice_templates BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_template_versions_insert AFTER INSERT ON invoice_template_versions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_template_versions_update AFTER UPDATE ON invoice_template_versions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_template_versions_delete AFTER DELETE ON invoice_template_versions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_sequences_insert AFTER INSERT ON invoice_number_sequences BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_sequences_update AFTER UPDATE ON invoice_number_sequences BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_sequences_delete AFTER DELETE ON invoice_number_sequences BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_counters_insert AFTER INSERT ON invoice_number_counters BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_counters_update AFTER UPDATE ON invoice_number_counters BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_number_counters_delete AFTER DELETE ON invoice_number_counters BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoices_insert AFTER INSERT ON invoices BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoices_update AFTER UPDATE ON invoices BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoices_delete AFTER DELETE ON invoices BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_items_insert AFTER INSERT ON invoice_items BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_items_update AFTER UPDATE ON invoice_items BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_items_delete AFTER DELETE ON invoice_items BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_documents_insert AFTER INSERT ON invoice_documents BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_documents_update AFTER UPDATE ON invoice_documents BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_documents_delete AFTER DELETE ON invoice_documents BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_categories_insert AFTER INSERT ON expense_categories BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_categories_update AFTER UPDATE ON expense_categories BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_categories_delete AFTER DELETE ON expense_categories BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expenses_insert AFTER INSERT ON expenses BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expenses_update AFTER UPDATE ON expenses BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expenses_delete AFTER DELETE ON expenses BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_vat_lines_insert AFTER INSERT ON expense_vat_lines BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_vat_lines_update AFTER UPDATE ON expense_vat_lines BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_vat_lines_delete AFTER DELETE ON expense_vat_lines BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_attachments_insert AFTER INSERT ON attachments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_attachments_update AFTER UPDATE ON attachments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_attachments_delete AFTER DELETE ON attachments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_connections_insert AFTER INSERT ON bank_connections BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_connections_update AFTER UPDATE ON bank_connections BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_connections_delete AFTER DELETE ON bank_connections BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_transactions_insert AFTER INSERT ON bank_transactions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_transactions_update AFTER UPDATE ON bank_transactions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_bank_transactions_delete AFTER DELETE ON bank_transactions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_payments_insert AFTER INSERT ON invoice_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_payments_update AFTER UPDATE ON invoice_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_invoice_payments_delete AFTER DELETE ON invoice_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_payments_insert AFTER INSERT ON expense_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_payments_update AFTER UPDATE ON expense_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_expense_payments_delete AFTER DELETE ON expense_payments BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_accounts_insert AFTER INSERT ON auth_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_accounts_update AFTER UPDATE ON auth_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_accounts_delete AFTER DELETE ON auth_accounts BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_sessions_insert AFTER INSERT ON auth_sessions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_sessions_update AFTER UPDATE ON auth_sessions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_sessions_delete AFTER DELETE ON auth_sessions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_verifications_insert AFTER INSERT ON auth_verifications BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_verifications_update AFTER UPDATE ON auth_verifications BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER epoch_auth_verifications_delete AFTER DELETE ON auth_verifications BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;

CREATE TRIGGER invoice_revision AFTER UPDATE ON invoices WHEN NEW.revision = OLD.revision BEGIN UPDATE invoices SET revision = OLD.revision + 1 WHERE id = NEW.id; END;

CREATE TABLE auth_rate_limits (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);
