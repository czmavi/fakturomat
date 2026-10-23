CREATE TABLE invoice_document_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoice_documents(invoice_id),
  type TEXT NOT NULL CHECK (type = 'PDF'),
  storage_provider TEXT NOT NULL CHECK (storage_provider = 'r2'),
  storage_key TEXT NOT NULL UNIQUE CHECK (length(storage_key) > 1 AND storage_key NOT GLOB '*[^A-Za-z0-9._/-]*' AND storage_key NOT LIKE '%..%'),
  etag TEXT,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size INTEGER NOT NULL CHECK (size > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY (organization_id, invoice_id) REFERENCES invoices(organization_id, id)
);
CREATE INDEX invoice_document_revisions_invoice_idx ON invoice_document_revisions(organization_id, invoice_id, revision DESC);
CREATE TRIGGER invoice_document_revisions_update BEFORE UPDATE ON invoice_document_revisions BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;
CREATE TRIGGER invoice_document_revisions_delete BEFORE DELETE ON invoice_document_revisions BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;
CREATE TRIGGER epoch_invoice_document_revisions_insert AFTER INSERT ON invoice_document_revisions BEGIN UPDATE _write_epoch SET revision = revision + 1 WHERE id = 1; END;
