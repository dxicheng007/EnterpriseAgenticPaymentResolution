CREATE TABLE bootstrap_verification_jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
  artifact_hash TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  binding JSONB NOT NULL CHECK (jsonb_typeof(binding) = 'object'),
  pin JSONB NOT NULL CHECK (jsonb_typeof(pin) = 'object'),
  request_bytes BYTEA NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  target_bytes BYTEA NOT NULL,
  target_hash TEXT NOT NULL CHECK (target_hash ~ '^[0-9a-f]{64}$'),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (artifact_hash, manifest_id) REFERENCES artifact_captures,
  UNIQUE (id, request_hash)
);

CREATE TABLE bootstrap_verification_results (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  result_hash TEXT NOT NULL UNIQUE CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  request_hash TEXT NOT NULL,
  completion_bytes BYTEA NOT NULL,
  result_bytes BYTEA NOT NULL,
  observed_plan_bytes BYTEA,
  observed_plan_bytes_hash TEXT CHECK (observed_plan_bytes_hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (job_id, request_hash) REFERENCES bootstrap_verification_jobs (id, request_hash),
  CHECK ((observed_plan_bytes IS NULL) = (observed_plan_bytes_hash IS NULL))
);

GRANT SELECT, INSERT ON bootstrap_verification_jobs, bootstrap_verification_results TO :app_role;
GRANT UPDATE (state) ON bootstrap_verification_jobs TO :app_role;
