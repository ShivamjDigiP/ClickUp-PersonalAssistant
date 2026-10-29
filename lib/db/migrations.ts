// Numbered, append-only. Never edit a migration that has shipped: add the next one. SQL stays portable (no SQLite-only
// tricks beyond INTEGER/TEXT) so the same schema can move to Postgres later.
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "core",
    sql: `
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row per connected tool per workspace. secret holds the API token ("enc:..." when encrypted).
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,            -- clickup | github | jira
  label TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- new | ok | error
  last_sync_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, provider, label)
);

-- The developers being measured.
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  level TEXT NOT NULL DEFAULT 'mid', -- junior | mid | senior | lead (set by the CXO)
  start_date INTEGER NOT NULL,
  team TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX people_ws ON people(workspace_id);

-- The same human in each tool (ClickUp user, GitHub login, Jira account). person_id NULL = not matched to anyone yet.
CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT,
  email TEXT,
  login TEXT,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, provider, external_id)
);
CREATE INDEX identities_person ON identities(person_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,               -- workspace:source:external_id:identity (a task with 2 assignees = 2 rows)
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  identity_id TEXT NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  project TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT NOT NULL,
  stage TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  done_at INTEGER,
  due_at INTEGER,
  reopened INTEGER,                  -- NULL = this source cannot tell
  url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_ws ON tasks(workspace_id, identity_id);
CREATE INDEX tasks_done ON tasks(workspace_id, done_at);

CREATE TABLE commits (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  sha TEXT NOT NULL,
  identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  at INTEGER NOT NULL,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  task_ref TEXT,
  PRIMARY KEY (workspace_id, repo, sha)
);
CREATE INDEX commits_at ON commits(workspace_id, at);

CREATE TABLE pull_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  first_review_at INTEGER,
  merged_at INTEGER,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  task_ref TEXT,
  PRIMARY KEY (workspace_id, repo, number)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,              -- running | ok | error
  counts_json TEXT,
  error TEXT
);

-- AI summaries cached by a hash of the numbers they were written from: same numbers = no new model call.
CREATE TABLE ai_insights (
  hash TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT,
  output_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`,
  },
  {
    id: 2,
    name: "platform_auth_and_projects",
    sql: `
-- Platform accounts. Independent of ClickUp: ClickUp, GitHub and Jira are only data sources a workspace connects.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,         -- always stored lower-case
  name TEXT NOT NULL,
  password_hash TEXT,                 -- NULL for accounts that only use Google
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE memberships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                 -- owner | cxo | manager | developer
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, workspace_id)
);

-- Only a hash of the session token is stored: a copy of the database cannot be used to sign in.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- A project is a named group of repositories and task lists, so the CXO sees one project across frontend, backend, ...
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE project_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- repo | tasks (a task list/project name from ClickUp or Jira)
  ref TEXT NOT NULL,                  -- "owner/name" for a repo, the list or project name for tasks
  layer TEXT,                         -- repos only: frontend | backend | mobile | infra | other
  part TEXT,                          -- repos only, free text: admin, user, public, ...
  UNIQUE (project_id, kind, ref)
);
CREATE INDEX project_sources_ws ON project_sources(workspace_id, kind, ref);
`,
  },
  {
    id: 3,
    name: "change_quality_signals",
    sql: `
-- What each change WAS and how it shipped, kept as raw text/numbers so the rules that read them can improve without a re-sync.
-- (additions/deletions stay in the database but are never shown or scored: lines of code do not measure work.)
ALTER TABLE commits ADD COLUMN message TEXT;
ALTER TABLE commits ADD COLUMN files_changed INTEGER;
ALTER TABLE commits ADD COLUMN parents INTEGER;
ALTER TABLE commits ADD COLUMN pr_number INTEGER;

ALTER TABLE pull_requests ADD COLUMN state TEXT;            -- open | merged | closed
ALTER TABLE pull_requests ADD COLUMN base_branch TEXT;
ALTER TABLE pull_requests ADD COLUMN head_branch TEXT;
ALTER TABLE pull_requests ADD COLUMN labels TEXT;           -- comma separated
ALTER TABLE pull_requests ADD COLUMN files_changed INTEGER;
ALTER TABLE pull_requests ADD COLUMN commit_count INTEGER;
ALTER TABLE pull_requests ADD COLUMN review_rounds INTEGER; -- reviews that asked for changes
ALTER TABLE pull_requests ADD COLUMN approvals INTEGER;
ALTER TABLE pull_requests ADD COLUMN reviewed INTEGER;      -- 1 when anyone reviewed it
ALTER TABLE pull_requests ADD COLUMN changelog_items INTEGER;
`,
  },
  {
    id: 4,
    name: "task_status_names",
    sql: `
-- The status as the tool shows it ("in development", "Done"), so the CXO sees the same words as the team.
ALTER TABLE tasks ADD COLUMN status TEXT;
`,
  },
  {
    id: 5,
    name: "task_parent",
    sql: `
-- The parent task of a subtask. The tools count subtasks differently by default (ClickUp's board hides them), so the
-- screens say how many of the numbers are subtasks instead of leaving the difference unexplained.
ALTER TABLE tasks ADD COLUMN parent TEXT;
`,
  },
  {
    id: 6,
    name: "integration_repos",
    sql: `
-- The repositories an integration covered at its last FULL sync. Data from a repository that is no longer covered by any
-- integration (for example after switching from a personal account to an organisation) is removed by the next full sync,
-- so old test data cannot linger in the totals.
CREATE TABLE integration_repos (
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  PRIMARY KEY (integration_id, repo)
);
`,
  },
  {
    id: 7,
    name: "person_role",
    sql: `
-- What the person does: developer | designer | client_success | manager. It decides what is tracked (developers by tasks and
-- GitHub work, everyone else by tasks). NULL = not set yet. Designation (the level column) is now junior | mid | senior;
-- start_date is the person's first interaction (first task or first commit), kept up to date automatically.
ALTER TABLE people ADD COLUMN role TEXT;
UPDATE people SET level = 'senior' WHERE level = 'lead';
UPDATE people SET role = 'developer' WHERE id IN (SELECT person_id FROM identities WHERE provider = 'github' AND person_id IS NOT NULL);
`,
  },
];
