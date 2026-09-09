ALTER TABLE invoices
  ADD CONSTRAINT invoices_organization_id_id_unique
    UNIQUE (organization_id, id);

CREATE TABLE invoice_documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  type text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoice_documents_invoice_fk
    FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT invoice_documents_type_valid CHECK (type IN ('PDF')),
  CONSTRAINT invoice_documents_storage_key_valid
    CHECK (storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]+$'),
  CONSTRAINT invoice_documents_sha256_valid
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invoice_documents_size_positive CHECK (size > 0),
  UNIQUE (invoice_id, type)
);

CREATE INDEX invoice_documents_organization_invoice_idx
  ON invoice_documents (organization_id, invoice_id);

CREATE OR REPLACE FUNCTION protect_invoice_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM invoices
      WHERE id = NEW.invoice_id
        AND organization_id = NEW.organization_id
        AND status <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Invoice document requires an issued invoice'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Invoice document metadata is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id) THEN
    RAISE EXCEPTION 'Invoice document metadata is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER invoice_documents_validate_insert
BEFORE INSERT ON invoice_documents
FOR EACH ROW
EXECUTE FUNCTION protect_invoice_document();

CREATE TRIGGER invoice_documents_immutable
BEFORE UPDATE OR DELETE ON invoice_documents
FOR EACH ROW
EXECUTE FUNCTION protect_invoice_document();
