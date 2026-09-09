ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_amount_nonzero CHECK (amount <> 0);

CREATE OR REPLACE FUNCTION prevent_bank_transaction_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Imported bank transactions are immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER bank_transactions_immutable
BEFORE UPDATE ON bank_transactions
FOR EACH ROW
EXECUTE FUNCTION prevent_bank_transaction_update();

CREATE OR REPLACE FUNCTION prevent_attachment_metadata_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Attachment metadata is immutable'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER attachments_metadata_immutable
BEFORE UPDATE ON attachments
FOR EACH ROW
EXECUTE FUNCTION prevent_attachment_metadata_update();

CREATE OR REPLACE FUNCTION protect_invoice_template_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.invoice_template_id IS DISTINCT FROM OLD.invoice_template_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.html IS DISTINCT FROM OLD.html
    OR NEW.css IS DISTINCT FROM OLD.css
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NOT (
      NEW.created_by IS NOT DISTINCT FROM OLD.created_by
      OR (OLD.created_by IS NOT NULL AND NEW.created_by IS NULL)
    )
  THEN
    RAISE EXCEPTION 'Invoice template versions are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_template_versions_immutable
BEFORE UPDATE ON invoice_template_versions
FOR EACH ROW
EXECUTE FUNCTION protect_invoice_template_version_update();

CREATE OR REPLACE FUNCTION validate_invoice_payment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_amount numeric;
  transaction_currency text;
  invoice_total numeric;
  invoice_currency text;
  allocated_to_transaction numeric;
  allocated_to_invoice numeric;
BEGIN
  SELECT amount, currency
  INTO transaction_amount, transaction_currency
  FROM bank_transactions
  WHERE id = NEW.bank_transaction_id
    AND organization_id = NEW.organization_id
  FOR UPDATE;

  SELECT total, currency
  INTO invoice_total, invoice_currency
  FROM invoices
  WHERE id = NEW.invoice_id
    AND organization_id = NEW.organization_id
    AND status IN ('ISSUED', 'PAID')
  FOR UPDATE;

  IF transaction_amount IS NULL OR invoice_total IS NULL THEN
    RAISE EXCEPTION 'Invoice payment requires matching scoped records'
      USING ERRCODE = '23514';
  END IF;
  IF transaction_amount <= 0 OR transaction_currency <> invoice_currency THEN
    RAISE EXCEPTION 'Invoice payment direction or currency is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Invoice payment amount must be positive'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO allocated_to_transaction
  FROM invoice_payments
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND id <> NEW.id;
  SELECT COALESCE(SUM(amount), 0)
  INTO allocated_to_invoice
  FROM invoice_payments
  WHERE invoice_id = NEW.invoice_id
    AND id <> NEW.id;

  IF allocated_to_transaction + NEW.amount > transaction_amount
    OR allocated_to_invoice + NEW.amount > invoice_total
  THEN
    RAISE EXCEPTION 'Invoice payment exceeds remaining amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_payments_validate_write
BEFORE INSERT OR UPDATE ON invoice_payments
FOR EACH ROW
EXECUTE FUNCTION validate_invoice_payment_write();

CREATE OR REPLACE FUNCTION validate_expense_payment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transaction_amount numeric;
  transaction_currency text;
  expense_total numeric;
  expense_currency text;
  allocated_to_transaction numeric;
  allocated_to_expense numeric;
BEGIN
  SELECT -amount, currency
  INTO transaction_amount, transaction_currency
  FROM bank_transactions
  WHERE id = NEW.bank_transaction_id
    AND organization_id = NEW.organization_id
  FOR UPDATE;

  SELECT total_amount, currency
  INTO expense_total, expense_currency
  FROM expenses
  WHERE id = NEW.expense_id
    AND organization_id = NEW.organization_id
  FOR UPDATE;

  IF transaction_amount IS NULL OR expense_total IS NULL THEN
    RAISE EXCEPTION 'Expense payment requires matching scoped records'
      USING ERRCODE = '23514';
  END IF;
  IF transaction_amount <= 0 OR transaction_currency <> expense_currency THEN
    RAISE EXCEPTION 'Expense payment direction or currency is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Expense payment amount must be positive'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
  INTO allocated_to_transaction
  FROM expense_payments
  WHERE bank_transaction_id = NEW.bank_transaction_id
    AND id <> NEW.id;
  SELECT COALESCE(SUM(amount), 0)
  INTO allocated_to_expense
  FROM expense_payments
  WHERE expense_id = NEW.expense_id
    AND id <> NEW.id;

  IF allocated_to_transaction + NEW.amount > transaction_amount
    OR allocated_to_expense + NEW.amount > expense_total
  THEN
    RAISE EXCEPTION 'Expense payment exceeds remaining amount'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expense_payments_validate_write
BEFORE INSERT OR UPDATE ON expense_payments
FOR EACH ROW
EXECUTE FUNCTION validate_expense_payment_write();
