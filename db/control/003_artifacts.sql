CREATE TABLE artifact_objects (
  kind TEXT NOT NULL CHECK (kind IN ('spec', 'artifact', 'profile', 'manifest', 'snapshot')),
  identity TEXT NOT NULL,
  object_hash TEXT NOT NULL CHECK (object_hash ~ '^[0-9a-f]{64}$'),
  bytes_hash TEXT NOT NULL CHECK (bytes_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (kind, identity),
  UNIQUE (kind, object_hash)
);

CREATE TABLE artifact_captures (
  artifact_hash TEXT NOT NULL CHECK (artifact_hash ~ '^[0-9a-f]{64}$'),
  manifest_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  PRIMARY KEY (artifact_hash, manifest_id)
);

GRANT SELECT, INSERT ON artifact_objects, artifact_captures TO :app_role;

CREATE TABLE verification_attempt_budgets (
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 3),
  PRIMARY KEY (run_id, account_id)
);

CREATE TABLE verification_jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  source_refs TEXT[] NOT NULL CHECK (cardinality(source_refs) > 0),
  account_ids TEXT[] NOT NULL CHECK (cardinality(account_ids) > 0),
  task_run_id TEXT,
  artifact_hash TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  summary JSONB,
  CHECK ((state = 'completed') = (summary IS NOT NULL)),
  FOREIGN KEY (artifact_hash, manifest_id) REFERENCES artifact_captures
);

CREATE TABLE verification_reports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES verification_jobs(id),
  report JSONB NOT NULL CHECK (jsonb_typeof(report) = 'object')
);

GRANT SELECT, INSERT ON verification_attempt_budgets, verification_jobs, verification_reports TO :app_role;
GRANT UPDATE (attempts) ON verification_attempt_budgets TO :app_role;
GRANT UPDATE (state, summary) ON verification_jobs TO :app_role;
