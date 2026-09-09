CREATE TABLE expense_vat_lines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  position integer NOT NULL,
  vat_rate numeric(7, 4) NOT NULL,
  base_amount numeric(18, 2) NOT NULL,
  vat_amount numeric(18, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_vat_lines_expense_fk
    FOREIGN KEY (organization_id, expense_id)
    REFERENCES expenses (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT expense_vat_lines_position_positive CHECK (position > 0),
  CONSTRAINT expense_vat_lines_rate_nonnegative CHECK (vat_rate >= 0),
  CONSTRAINT expense_vat_lines_base_nonnegative CHECK (base_amount >= 0),
  CONSTRAINT expense_vat_lines_vat_nonnegative CHECK (vat_amount >= 0),
  UNIQUE (organization_id, id),
  UNIQUE (expense_id, position)
);

CREATE INDEX expense_vat_lines_organization_expense_idx
  ON expense_vat_lines (organization_id, expense_id, position);
