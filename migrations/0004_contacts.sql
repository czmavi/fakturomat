CREATE TABLE contacts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  ico text,
  dic text,
  street text,
  city text,
  postal_code text,
  country char(2) NOT NULL DEFAULT 'CZ',
  email text,
  phone text,
  default_due_days integer,
  note text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_type_valid CHECK (type IN ('PERSON', 'COMPANY')),
  CONSTRAINT contacts_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT contacts_country_valid CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT contacts_default_due_days_valid
    CHECK (default_due_days IS NULL OR default_due_days BETWEEN 0 AND 365)
);

CREATE INDEX contacts_organization_active_name_idx
  ON contacts (organization_id, archived_at, lower(name));

CREATE INDEX contacts_organization_ico_idx
  ON contacts (organization_id, ico)
  WHERE ico IS NOT NULL;
