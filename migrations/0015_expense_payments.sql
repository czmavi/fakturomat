CREATE TABLE expense_payments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL,
  amount numeric(19, 4) NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
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

CREATE INDEX expense_payments_expense_idx
  ON expense_payments (organization_id, expense_id, created_at);

CREATE INDEX expense_payments_transaction_idx
  ON expense_payments (organization_id, bank_transaction_id, created_at);
