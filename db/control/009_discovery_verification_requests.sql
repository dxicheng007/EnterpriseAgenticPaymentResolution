CREATE TABLE discovery_verification_requests (
  request_key TEXT PRIMARY KEY CHECK (length(request_key) > 0),
  run_id TEXT NOT NULL CHECK (length(run_id) > 0),
  task_id TEXT NOT NULL CHECK (length(task_id) > 0),
  account_id TEXT NOT NULL CHECK (length(account_id) > 0),
  dispatch_id TEXT NOT NULL CHECK (length(dispatch_id) > 0),
  admitted_generation BIGINT NOT NULL CHECK (admitted_generation BETWEEN 1 AND 9007199254740991),
  admitted_task_revision BIGINT NOT NULL CHECK (admitted_task_revision BETWEEN 1 AND 9007199254740991),
  proposal_id TEXT NOT NULL CHECK (length(proposal_id) > 0),
  proposal_revision BIGINT NOT NULL CHECK (proposal_revision BETWEEN 1 AND 9007199254740991),
  assessment_revision BIGINT NOT NULL CHECK (assessment_revision BETWEEN 1 AND 9007199254740991),
  subject_hash TEXT NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  subject_bytes BYTEA NOT NULL CHECK (octet_length(subject_bytes) BETWEEN 1 AND 10485760),
  job_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (run_id, task_id, request_key) REFERENCES discovery_tool_steps (run_id, task_id, id),
  FOREIGN KEY (run_id, task_id, dispatch_id) REFERENCES discovery_dispatches (run_id, task_id, id),
  FOREIGN KEY (run_id, proposal_id, proposal_revision, assessment_revision)
    REFERENCES discovery_proposal_assessments (run_id, proposal_id, proposal_revision, assessment_revision),
  FOREIGN KEY (job_id, request_hash) REFERENCES financial_verification_reservations (job_id, request_hash)
);

CREATE INDEX discovery_verification_requests_run_idx ON discovery_verification_requests (run_id, request_key);

GRANT SELECT, INSERT ON discovery_verification_requests TO :app_role;
