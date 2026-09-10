ALTER TABLE invoice_templates
  ADD COLUMN organization_id uuid
    REFERENCES organizations (id) ON DELETE RESTRICT,
  ADD COLUMN source_template_id uuid
    REFERENCES invoice_templates (id) ON DELETE RESTRICT,
  ADD CONSTRAINT invoice_templates_source_requires_organization
    CHECK (source_template_id IS NULL OR organization_id IS NOT NULL);

CREATE UNIQUE INDEX invoice_templates_organization_source_unique
  ON invoice_templates (organization_id, source_template_id)
  WHERE source_template_id IS NOT NULL;

CREATE INDEX invoice_templates_organization_id_idx
  ON invoice_templates (organization_id, id);

CREATE OR REPLACE FUNCTION protect_global_invoice_template()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.organization_id IS NULL THEN
    RAISE EXCEPTION 'Global invoice templates are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.source_template_id IS DISTINCT FROM OLD.source_template_id
  ) THEN
    RAISE EXCEPTION 'Invoice template ownership is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER global_invoice_templates_immutable
BEFORE UPDATE OR DELETE ON invoice_templates
FOR EACH ROW
EXECUTE FUNCTION protect_global_invoice_template();

CREATE OR REPLACE FUNCTION protect_global_invoice_template_version_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM invoice_templates
    WHERE id = CASE WHEN TG_OP = 'DELETE'
      THEN OLD.invoice_template_id
      ELSE NEW.invoice_template_id
    END
      AND organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Global invoice template versions are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER global_invoice_template_versions_immutable
BEFORE INSERT OR DELETE ON invoice_template_versions
FOR EACH ROW
EXECUTE FUNCTION protect_global_invoice_template_version_write();
