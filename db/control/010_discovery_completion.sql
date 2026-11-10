ALTER TABLE discovery_runs DROP CONSTRAINT discovery_runs_status_check;
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_status_check
  CHECK (status IN ('queued','running','paused','blocked','failed','completed'));

GRANT UPDATE (repair_count) ON discovery_investigations TO :app_role;
GRANT UPDATE (repair_round) ON discovery_tasks TO :app_role;

CREATE TABLE discovery_investigation_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  requester_task_id TEXT NOT NULL,
  seller_entity_id TEXT,
  source_account_id TEXT,
  question TEXT NOT NULL CHECK (octet_length(question) BETWEEN 1 AND 8192),
  CHECK ((seller_entity_id IS NULL) = (source_account_id IS NULL)),
  UNIQUE (run_id, request_id),
  FOREIGN KEY (run_id, requester_task_id, request_id)
    REFERENCES discovery_tool_steps (run_id, task_id, id)
);

CREATE TABLE discovery_investigation_request_findings (
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  finding_revision INTEGER NOT NULL,
  PRIMARY KEY (run_id, request_id, finding_id, finding_revision),
  FOREIGN KEY (run_id, request_id)
    REFERENCES discovery_investigation_requests (run_id, request_id),
  FOREIGN KEY (run_id, finding_id, finding_revision)
    REFERENCES discovery_finding_revisions (run_id, finding_id, revision)
);

CREATE TABLE discovery_investigation_request_delegations (
  run_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  coordinator_task_id TEXT NOT NULL,
  delegation_step_id TEXT NOT NULL UNIQUE,
  delegated_task_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (run_id, request_id),
  FOREIGN KEY (run_id, request_id)
    REFERENCES discovery_investigation_requests (run_id, request_id),
  FOREIGN KEY (run_id, coordinator_task_id, delegation_step_id)
    REFERENCES discovery_tool_steps (run_id, task_id, id),
  FOREIGN KEY (run_id, delegated_task_id)
    REFERENCES discovery_tasks (run_id, id)
);

CREATE INDEX discovery_investigation_requests_task
  ON discovery_investigation_requests (run_id, requester_task_id, request_id);

GRANT SELECT, INSERT ON discovery_investigation_requests,
  discovery_investigation_request_findings,
  discovery_investigation_request_delegations TO :app_role;
