CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_expense_fk
    FOREIGN KEY (organization_id, expense_id)
    REFERENCES expenses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT attachments_filename_valid
    CHECK (length(filename) BETWEEN 1 AND 255),
  CONSTRAINT attachments_mime_type_valid
    CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT attachments_size_valid CHECK (size > 0 AND size <= 20971520),
  CONSTRAINT attachments_storage_key_valid
    CHECK (storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]+$'),
  CONSTRAINT attachments_sha256_valid CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  UNIQUE (organization_id, id)
);

CREATE INDEX attachments_organization_expense_idx
  ON attachments (organization_id, expense_id, created_at, id);
