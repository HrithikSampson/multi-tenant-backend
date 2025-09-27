BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role') THEN
    CREATE TYPE org_role AS ENUM ('OWNER','ADMIN','USER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'project_role') THEN
    CREATE TYPE project_role AS ENUM ('EDITOR','VIEWER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM ('TODO','INPROGRESS','DONE');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_kind') THEN
    CREATE TYPE activity_kind AS ENUM ('WARN','ALERT','NOTIFY','ANNOUNCE','SHOW');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        CITEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_touch_upd
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS organizations (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  subdomain   CITEXT NOT NULL UNIQUE,
  room_key    UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_orgs_touch_upd
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS org_memberships (
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'USER',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org_role ON org_memberships(organization_id, role);

CREATE TRIGGER trg_org_memberships_touch_upd
BEFORE UPDATE ON org_memberships
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS projects (
  id              BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(140) NOT NULL,
  slug            VARCHAR(140) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);

CREATE TRIGGER trg_projects_touch_upd
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS project_members (
  organization_id BIGINT NOT NULL,
  project_id      BIGINT NOT NULL,
  user_id         BIGINT NOT NULL,
  role            project_role NOT NULL DEFAULT 'VIEWER',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id, user_id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES org_memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_project_members_org_proj ON project_members(organization_id, project_id);

CREATE TRIGGER trg_project_members_touch_upd
BEFORE UPDATE ON project_members
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS tasks (
  id               BIGSERIAL PRIMARY KEY,
  organization_id  BIGINT NOT NULL,
  project_id       BIGINT NOT NULL,
  assignee_id      BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  assigned_by_id   BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  status           task_status NOT NULL DEFAULT 'TODO',
  title            VARCHAR(200) NOT NULL,
  description      TEXT NULL,
  due_date         DATE NULL,
  priority         SMALLINT NULL,
  order_in_board   INT NOT NULL DEFAULT 0,
  created_by       BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by       BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, assignee_id)
    REFERENCES org_memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, assigned_by_id)
    REFERENCES org_memberships(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tasks_org_project_status ON tasks (organization_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee_status ON tasks (organization_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_open ON tasks (organization_id, project_id)
  WHERE status <> 'DONE';

CREATE TRIGGER trg_tasks_touch_upd
BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE TABLE IF NOT EXISTS activities (
  id              BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            activity_kind NOT NULL,
  message         TEXT NOT NULL,
  object_type     VARCHAR(40) NULL,
  object_id       BIGINT NULL,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_org_time ON activities (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.user_in_org(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.organization_id = org_id
      AND m.user_id = current_setting('app.user_id', true)::bigint
  );
$$;

CREATE OR REPLACE FUNCTION app.is_org_admin(org_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.organization_id = org_id
      AND m.user_id = current_setting('app.user_id', true)::bigint
      AND m.role IN ('OWNER','ADMIN')
  );
$$;

CREATE OR REPLACE FUNCTION app.is_project_editor(org_id bigint, proj_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.organization_id = org_id
      AND pm.project_id = proj_id
      AND pm.user_id = current_setting('app.user_id', true)::bigint
      AND pm.role = 'EDITOR'
  );
$$;

ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities         ENABLE ROW LEVEL SECURITY;

CREATE POLICY orgs_select ON organizations
  FOR SELECT USING (app.user_in_org(id));
CREATE POLICY orgs_write ON organizations
  FOR ALL USING (app.is_org_admin(id))
  WITH CHECK (app.is_org_admin(id));

CREATE POLICY orgm_select_self ON org_memberships
  FOR SELECT USING (
    user_id = current_setting('app.user_id', true)::bigint
    OR app.is_org_admin(organization_id)
  );
CREATE POLICY orgm_admin_write ON org_memberships
  FOR ALL USING (app.is_org_admin(organization_id))
  WITH CHECK (app.is_org_admin(organization_id));

CREATE POLICY projects_select ON projects
  FOR SELECT USING (app.user_in_org(organization_id));
CREATE POLICY projects_write ON projects
  FOR ALL USING (app.is_org_admin(organization_id))
  WITH CHECK (app.is_org_admin(organization_id));

CREATE POLICY pm_select ON project_members
  FOR SELECT USING (app.user_in_org(organization_id));
CREATE POLICY pm_admin_write ON project_members
  FOR ALL USING (app.is_org_admin(organization_id))
  WITH CHECK (app.is_org_admin(organization_id));

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (app.user_in_org(organization_id));

CREATE POLICY tasks_admin_write ON tasks
  FOR ALL USING (app.is_org_admin(organization_id))
  WITH CHECK (
    app.is_org_admin(organization_id)
  );

CREATE POLICY tasks_editor_write ON tasks
  FOR ALL USING (
    app.is_project_editor(organization_id, project_id)
  )
  WITH CHECK (
    app.is_project_editor(organization_id, project_id)
  );

CREATE POLICY act_select ON activities
  FOR SELECT USING (app.user_in_org(organization_id));
CREATE POLICY act_insert ON activities
  FOR INSERT WITH CHECK (app.user_in_org(organization_id));

COMMIT;