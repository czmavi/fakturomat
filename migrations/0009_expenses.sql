CREATE TABLE expense_categories (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_categories_name_not_empty
    CHECK (length(trim(name)) > 0),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX expense_categories_name_per_organization
  ON expense_categories (organization_id, lower(name));

INSERT INTO expense_categories (id, organization_id, name)
SELECT gen_random_uuid(), organizations.id, defaults.name
FROM organizations
CROSS JOIN (
  VALUES
    ('Software'),
    ('Hardware'),
    ('Hosting'),
    ('Reklama'),
    ('Kancelář'),
    ('Cestovné'),
    ('Ostatní')
) AS defaults(name);

CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id uuid,
  document_type text NOT NULL,
  supplier_name text NOT NULL,
  supplier_invoice_number text,
  issue_date date,
  taxable_supply_date date,
  due_date date,
  payment_date date,
  description text NOT NULL,
  category_id uuid,
  currency char(3) NOT NULL,
  total_amount numeric(18, 2) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
  CONSTRAINT expenses_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT expenses_total_amount_nonnegative CHECK (total_amount >= 0),
  UNIQUE (organization_id, id)
);

CREATE INDEX expenses_organization_issue_date_idx
  ON expenses (organization_id, issue_date DESC NULLS LAST, created_at DESC);

CREATE INDEX expenses_organization_category_idx
  ON expenses (organization_id, category_id, issue_date DESC NULLS LAST);

CREATE INDEX expenses_organization_document_type_idx
  ON expenses (organization_id, document_type, issue_date DESC NULLS LAST);
