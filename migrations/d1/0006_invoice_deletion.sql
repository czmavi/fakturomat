-- A deletion permit exists only inside the transaction deleting the invoice.
CREATE TABLE invoice_deletion_permits (
  invoice_id TEXT PRIMARY KEY REFERENCES invoices(id) ON DELETE CASCADE
);
CREATE TABLE released_invoice_numbers (
  number_sequence_id TEXT NOT NULL REFERENCES invoice_number_sequences(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  number TEXT NOT NULL,
  PRIMARY KEY (number_sequence_id, number)
);
-- Persist cleanup work before removing metadata, so failed R2 deletes can be retried.
CREATE TABLE invoice_pdf_cleanup (
  storage_key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL
);
DROP TRIGGER issued_invoice_delete;
CREATE TRIGGER issued_invoice_delete BEFORE DELETE ON invoices
WHEN OLD.status <> 'DRAFT' AND NOT EXISTS (SELECT 1 FROM invoice_deletion_permits WHERE invoice_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Issued invoice is immutable'); END;
DROP TRIGGER issued_items_delete;
CREATE TRIGGER issued_items_delete BEFORE DELETE ON invoice_items
WHEN EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status <> 'DRAFT')
AND NOT EXISTS (SELECT 1 FROM invoice_deletion_permits WHERE invoice_id = OLD.invoice_id)
BEGIN SELECT RAISE(ABORT, 'Issued invoice items are immutable'); END;
DROP TRIGGER invoice_documents_delete;
CREATE TRIGGER invoice_documents_delete BEFORE DELETE ON invoice_documents
WHEN NOT EXISTS (SELECT 1 FROM invoice_deletion_permits WHERE invoice_id = OLD.invoice_id)
BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;
DROP TRIGGER invoice_document_revisions_delete;
CREATE TRIGGER invoice_document_revisions_delete BEFORE DELETE ON invoice_document_revisions
WHEN NOT EXISTS (SELECT 1 FROM invoice_deletion_permits WHERE invoice_id = OLD.invoice_id)
BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;
CREATE TRIGGER epoch_released_invoice_numbers_insert AFTER INSERT ON released_invoice_numbers BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_released_invoice_numbers_delete AFTER DELETE ON released_invoice_numbers BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_released_invoice_numbers_update AFTER UPDATE ON released_invoice_numbers BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_pdf_cleanup_insert AFTER INSERT ON invoice_pdf_cleanup BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_pdf_cleanup_delete AFTER DELETE ON invoice_pdf_cleanup BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_pdf_cleanup_update AFTER UPDATE ON invoice_pdf_cleanup BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_deletion_permits_insert AFTER INSERT ON invoice_deletion_permits BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_deletion_permits_delete AFTER DELETE ON invoice_deletion_permits BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER epoch_invoice_deletion_permits_update AFTER UPDATE ON invoice_deletion_permits BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
