-- Only the explicitly designated existing account becomes an administrator.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1));
UPDATE users SET is_admin = 1 WHERE email = 'mail@martinvich.net' AND is_active = 1;

-- Keep ordinary repository membership checks authoritative for administrators too.
INSERT INTO organization_memberships (organization_id, user_id, role)
SELECT o.id, u.id, 'OWNER' FROM organizations o CROSS JOIN users u
WHERE u.is_admin = 1
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'OWNER';

CREATE TRIGGER admin_new_organization AFTER INSERT ON organizations BEGIN
  INSERT INTO organization_memberships (organization_id, user_id, role)
  SELECT NEW.id, id, 'OWNER' FROM users WHERE is_admin = 1;
END;
CREATE TRIGGER admin_new_user AFTER INSERT ON users WHEN NEW.is_admin = 1 BEGIN
  INSERT INTO organization_memberships (organization_id, user_id, role)
  SELECT id, NEW.id, 'OWNER' FROM organizations;
END;
CREATE TRIGGER admin_promoted AFTER UPDATE OF is_admin ON users
WHEN NEW.is_admin = 1 AND OLD.is_admin = 0 BEGIN
  INSERT INTO organization_memberships (organization_id, user_id, role)
  SELECT id, NEW.id, 'OWNER' FROM organizations WHERE true
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'OWNER';
END;
