CREATE TRIGGER issued_invoice_content BEFORE UPDATE ON invoices WHEN OLD.status <> 'DRAFT' AND (NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.contact_id IS NOT OLD.contact_id OR NEW.number_sequence_id IS NOT OLD.number_sequence_id OR NEW.bank_account_id IS NOT OLD.bank_account_id OR NEW.invoice_template_id IS NOT OLD.invoice_template_id OR NEW.template_version_id IS NOT OLD.template_version_id OR NEW.number IS NOT OLD.number OR NEW.variable_symbol IS NOT OLD.variable_symbol OR NEW.issue_date IS NOT OLD.issue_date OR NEW.due_date IS NOT OLD.due_date OR NEW.currency IS NOT OLD.currency OR NEW.subtotal IS NOT OLD.subtotal OR NEW.total IS NOT OLD.total OR NEW.supplier_snapshot IS NOT OLD.supplier_snapshot OR NEW.customer_snapshot IS NOT OLD.customer_snapshot OR NEW.bank_account_snapshot IS NOT OLD.bank_account_snapshot OR NEW.note IS NOT OLD.note OR NEW.issued_at IS NOT OLD.issued_at OR NEW.issued_by IS NOT OLD.issued_by OR NEW.status = 'DRAFT') BEGIN SELECT RAISE(ABORT, 'Issued invoice content is immutable'); END;

CREATE TRIGGER issued_invoice_delete BEFORE DELETE ON invoices WHEN OLD.status <> 'DRAFT' BEGIN SELECT RAISE(ABORT, 'Issued invoice is immutable'); END;

CREATE TRIGGER issued_items_insert BEFORE INSERT ON invoice_items WHEN EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status <> 'DRAFT') BEGIN SELECT RAISE(ABORT, 'Issued invoice items are immutable'); END;

CREATE TRIGGER issued_items_update BEFORE UPDATE ON invoice_items WHEN EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status <> 'DRAFT') OR EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status <> 'DRAFT') BEGIN SELECT RAISE(ABORT, 'Issued invoice items are immutable'); END;

CREATE TRIGGER issued_items_delete BEFORE DELETE ON invoice_items WHEN EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND status <> 'DRAFT') BEGIN SELECT RAISE(ABORT, 'Issued invoice items are immutable'); END;

CREATE TRIGGER invoice_documents_update BEFORE UPDATE ON invoice_documents WHEN 1 BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;

CREATE TRIGGER invoice_documents_delete BEFORE DELETE ON invoice_documents WHEN 1 BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;

CREATE TRIGGER bank_transactions_update BEFORE UPDATE ON bank_transactions WHEN 1 BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;

CREATE TRIGGER attachments_update BEFORE UPDATE ON attachments WHEN 1 BEGIN SELECT RAISE(ABORT, 'Historical metadata is immutable'); END;

CREATE TRIGGER version_immutable BEFORE UPDATE ON invoice_template_versions WHEN NEW.id IS NOT OLD.id OR NEW.invoice_template_id IS NOT OLD.invoice_template_id OR NEW.version IS NOT OLD.version OR NEW.html IS NOT OLD.html OR NEW.css IS NOT OLD.css OR NEW.created_at IS NOT OLD.created_at OR (NEW.created_by IS NOT OLD.created_by AND NEW.created_by IS NOT NULL) BEGIN SELECT RAISE(ABORT, 'Template versions are immutable'); END;

CREATE TRIGGER global_template_update BEFORE UPDATE ON invoice_templates WHEN OLD.organization_id IS NULL OR NEW.organization_id IS NOT OLD.organization_id OR NEW.source_template_id IS NOT OLD.source_template_id BEGIN SELECT RAISE(ABORT, 'Template ownership and global templates are immutable'); END;

CREATE TRIGGER global_template_delete BEFORE DELETE ON invoice_templates WHEN OLD.organization_id IS NULL BEGIN SELECT RAISE(ABORT, 'Template ownership and global templates are immutable'); END;

CREATE TRIGGER global_version_insert BEFORE INSERT ON invoice_template_versions WHEN EXISTS (SELECT 1 FROM invoice_templates WHERE id = NEW.invoice_template_id AND organization_id IS NULL) BEGIN SELECT RAISE(ABORT, 'Global template versions are immutable'); END;

CREATE TRIGGER global_version_delete BEFORE DELETE ON invoice_template_versions WHEN EXISTS (SELECT 1 FROM invoice_templates WHERE id = OLD.invoice_template_id AND organization_id IS NULL) BEGIN SELECT RAISE(ABORT, 'Global template versions are immutable'); END;

CREATE TRIGGER invoice_payments_insert BEFORE INSERT ON invoice_payments WHEN NOT EXISTS (
    SELECT 1 FROM bank_transactions AS movement JOIN invoices AS document
    ON document.id = NEW.invoice_id AND document.organization_id = NEW.organization_id
    WHERE movement.id = NEW.bank_transaction_id AND movement.organization_id = NEW.organization_id
      AND movement.amount > 0 AND movement.currency = document.currency AND document.status IN ('ISSUED', 'PAID')
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE bank_transaction_id = NEW.bank_transaction_id AND id <> NEW.id), 0) <= movement.amount
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = NEW.invoice_id AND id <> NEW.id), 0) <= document.total
  ) BEGIN SELECT RAISE(ABORT, 'Payment exceeds balance or violates scope/currency'); END;

CREATE TRIGGER invoice_payments_update BEFORE UPDATE ON invoice_payments WHEN NOT EXISTS (
    SELECT 1 FROM bank_transactions AS movement JOIN invoices AS document
    ON document.id = NEW.invoice_id AND document.organization_id = NEW.organization_id
    WHERE movement.id = NEW.bank_transaction_id AND movement.organization_id = NEW.organization_id
      AND movement.amount > 0 AND movement.currency = document.currency AND document.status IN ('ISSUED', 'PAID')
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE bank_transaction_id = NEW.bank_transaction_id AND id <> NEW.id), 0) <= movement.amount
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM invoice_payments WHERE invoice_id = NEW.invoice_id AND id <> NEW.id), 0) <= document.total
  ) BEGIN SELECT RAISE(ABORT, 'Payment exceeds balance or violates scope/currency'); END;

CREATE TRIGGER expense_payments_insert BEFORE INSERT ON expense_payments WHEN NOT EXISTS (
    SELECT 1 FROM bank_transactions AS movement JOIN expenses AS document
    ON document.id = NEW.expense_id AND document.organization_id = NEW.organization_id
    WHERE movement.id = NEW.bank_transaction_id AND movement.organization_id = NEW.organization_id
      AND -movement.amount > 0 AND movement.currency = document.currency
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM expense_payments WHERE bank_transaction_id = NEW.bank_transaction_id AND id <> NEW.id), 0) <= -movement.amount
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM expense_payments WHERE expense_id = NEW.expense_id AND id <> NEW.id), 0) <= document.total_amount
  ) BEGIN SELECT RAISE(ABORT, 'Payment exceeds balance or violates scope/currency'); END;

CREATE TRIGGER expense_payments_update BEFORE UPDATE ON expense_payments WHEN NOT EXISTS (
    SELECT 1 FROM bank_transactions AS movement JOIN expenses AS document
    ON document.id = NEW.expense_id AND document.organization_id = NEW.organization_id
    WHERE movement.id = NEW.bank_transaction_id AND movement.organization_id = NEW.organization_id
      AND -movement.amount > 0 AND movement.currency = document.currency
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM expense_payments WHERE bank_transaction_id = NEW.bank_transaction_id AND id <> NEW.id), 0) <= -movement.amount
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM expense_payments WHERE expense_id = NEW.expense_id AND id <> NEW.id), 0) <= document.total_amount
  ) BEGIN SELECT RAISE(ABORT, 'Payment exceeds balance or violates scope/currency'); END;

CREATE TRIGGER expense_allocation_update BEFORE UPDATE ON expenses WHEN NEW.total_amount < COALESCE((SELECT SUM(amount) FROM expense_payments WHERE expense_id = OLD.id), 0) OR (NEW.currency IS NOT OLD.currency AND EXISTS (SELECT 1 FROM expense_payments WHERE expense_id = OLD.id)) BEGIN SELECT RAISE(ABORT, 'Expense has incompatible payments'); END;
