ALTER TABLE invoices
  ADD COLUMN issued_by uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION prevent_issued_invoice_content_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
    OR NEW.number_sequence_id IS DISTINCT FROM OLD.number_sequence_id
    OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
    OR NEW.invoice_template_id IS DISTINCT FROM OLD.invoice_template_id
    OR NEW.template_version_id IS DISTINCT FROM OLD.template_version_id
    OR NEW.number IS DISTINCT FROM OLD.number
    OR NEW.variable_symbol IS DISTINCT FROM OLD.variable_symbol
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.due_date IS DISTINCT FROM OLD.due_date
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
    OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.supplier_snapshot IS DISTINCT FROM OLD.supplier_snapshot
    OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
    OR NEW.bank_account_snapshot IS DISTINCT FROM OLD.bank_account_snapshot
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
  ) THEN
    RAISE EXCEPTION 'Issued invoice content is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_issued_content_immutable
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION prevent_issued_invoice_content_update();

CREATE OR REPLACE FUNCTION prevent_issued_invoice_item_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_invoice_id uuid;
BEGIN
  target_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE id = target_invoice_id AND status <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Issued invoice items are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER invoice_items_issued_invoice_immutable
BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
FOR EACH ROW
EXECUTE FUNCTION prevent_issued_invoice_item_change();

