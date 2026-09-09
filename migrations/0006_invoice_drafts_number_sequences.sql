CREATE TABLE invoice_number_sequences (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  padding integer NOT NULL DEFAULT 4,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_number_sequences_name_not_empty
    CHECK (length(trim(name)) > 0),
  CONSTRAINT invoice_number_sequences_prefix_valid
    CHECK (prefix ~ '^[A-Z0-9._/-]{0,20}$'),
  CONSTRAINT invoice_number_sequences_padding_valid
    CHECK (padding BETWEEN 1 AND 9),
  CONSTRAINT invoice_number_sequences_default_active
    CHECK (NOT is_default OR is_active),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX invoice_number_sequences_name_per_organization
  ON invoice_number_sequences (organization_id, lower(name));

CREATE UNIQUE INDEX invoice_number_sequences_one_default_per_organization
  ON invoice_number_sequences (organization_id)
  WHERE is_default;

CREATE TABLE invoice_number_counters (
  invoice_number_sequence_id uuid NOT NULL
    REFERENCES invoice_number_sequences (id) ON DELETE CASCADE,
  year integer NOT NULL,
  last_value bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_number_sequence_id, year),
  CONSTRAINT invoice_number_counters_year_valid CHECK (year BETWEEN 2000 AND 9999),
  CONSTRAINT invoice_number_counters_value_positive CHECK (last_value > 0)
);

INSERT INTO invoice_number_sequences (
  id, organization_id, name, prefix, padding, is_default
)
SELECT gen_random_uuid(), id, 'Výchozí', '', 4, true
FROM organizations;

ALTER TABLE contacts
  ADD CONSTRAINT contacts_organization_id_id_unique
    UNIQUE (organization_id, id);

ALTER TABLE bank_accounts
  ADD CONSTRAINT bank_accounts_organization_id_id_unique
    UNIQUE (organization_id, id);

CREATE TABLE invoices (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  number_sequence_id uuid NOT NULL,
  bank_account_id uuid,
  invoice_template_id uuid NOT NULL
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  template_version_id uuid,
  number text,
  variable_symbol text,
  status text NOT NULL DEFAULT 'DRAFT',
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL,
  subtotal numeric(18, 2) NOT NULL DEFAULT 0,
  total numeric(18, 2) NOT NULL DEFAULT 0,
  supplier_snapshot jsonb,
  customer_snapshot jsonb,
  bank_account_snapshot jsonb,
  note text,
  issued_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
    CHECK (variable_symbol IS NULL OR variable_symbol ~ '^[0-9]{1,10}$'),
  CONSTRAINT invoices_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
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
  )
);

CREATE UNIQUE INDEX invoices_number_per_sequence
  ON invoices (number_sequence_id, number)
  WHERE number IS NOT NULL;

CREATE INDEX invoices_organization_status_date_idx
  ON invoices (organization_id, status, issue_date DESC, created_at DESC);

CREATE INDEX invoices_organization_contact_idx
  ON invoices (organization_id, contact_id);

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  unit text NOT NULL,
  unit_price numeric(18, 2) NOT NULL,
  total numeric(18, 2) NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_items_description_not_empty
    CHECK (length(trim(description)) > 0),
  CONSTRAINT invoice_items_unit_not_empty CHECK (length(trim(unit)) > 0),
  CONSTRAINT invoice_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT invoice_items_amounts_valid CHECK (unit_price >= 0 AND total >= 0),
  CONSTRAINT invoice_items_position_positive CHECK (position > 0),
  UNIQUE (invoice_id, position)
);

