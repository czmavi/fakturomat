CREATE TABLE invoice_payments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL,
  amount numeric(19, 4) NOT NULL,
  match_type text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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

CREATE INDEX invoice_payments_invoice_idx
  ON invoice_payments (organization_id, invoice_id, created_at);

CREATE INDEX invoice_payments_transaction_idx
  ON invoice_payments (organization_id, bank_transaction_id, created_at);
