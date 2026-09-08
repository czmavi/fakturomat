CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  official_name text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_type_valid
    CHECK (type IN ('OSVC', 'ASSOCIATION', 'SRO', 'OTHER')),
  CONSTRAINT organizations_official_name_not_empty
    CHECK (length(trim(official_name)) > 0),
  CONSTRAINT organizations_display_name_not_empty
    CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL
    REFERENCES organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT organization_memberships_role_valid
    CHECK (role IN ('OWNER', 'MEMBER'))
);

CREATE INDEX organization_memberships_user_id_idx
  ON organization_memberships (user_id, organization_id);
