ALTER TABLE invoice_documents
  ADD COLUMN storage_provider text NOT NULL DEFAULT 'local'
    CHECK (storage_provider IN ('local', 's3')),
  ADD COLUMN etag text;

-- Require explicit provider metadata for all new documents. Existing rows stay local.
ALTER TABLE invoice_documents ALTER COLUMN storage_provider DROP DEFAULT;

-- Metadata is inserted before marking the invoice issued in the same transaction.
-- Validate the final state at COMMIT; the immutable UPDATE/DELETE trigger stays intact.
DROP TRIGGER invoice_documents_validate_insert ON invoice_documents;
CREATE CONSTRAINT TRIGGER invoice_documents_validate_insert
AFTER INSERT ON invoice_documents
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION protect_invoice_document();
