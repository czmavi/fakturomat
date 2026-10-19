ALTER TABLE expenses ADD COLUMN invoice_details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(invoice_details));
