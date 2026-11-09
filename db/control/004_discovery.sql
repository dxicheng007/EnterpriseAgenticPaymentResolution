CREATE TABLE discovery_supervisor (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  generation BIGINT NOT NULL CHECK (generation BETWEEN 0 AND 9007199254740991)
);
INSERT INTO discovery_supervisor (generation) VALUES (0);

CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  start_key TEXT NOT NULL,
  start_hash TEXT NOT NULL,
  start_response JSONB NOT NULL,
  binding JSONB NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('scripted', 'live')),
  model_id TEXT NOT NULL,
  policy JSONB NOT NULL,
  grants JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','blocked','failed')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  model_calls BIGINT NOT NULL DEFAULT 0 CHECK (model_calls BETWEEN 0 AND 9007199254740991),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
  unknown_calls BIGINT NOT NULL DEFAULT 0 CHECK (unknown_calls BETWEEN 0 AND model_calls),
  diagnostics TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (reviewer_id, start_key)
);

CREATE TABLE discovery_investigations (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  id TEXT PRIMARY KEY,
  seller_entity_id TEXT,
  source_account_id TEXT,
  CHECK ((seller_entity_id IS NULL) = (source_account_id IS NULL)),
  specialist_count INTEGER NOT NULL DEFAULT 0 CHECK (specialist_count BETWEEN 0 AND 10),
  repair_count INTEGER NOT NULL DEFAULT 0 CHECK (repair_count BETWEEN 0 AND 2),
  UNIQUE (run_id,id),
  UNIQUE (run_id,seller_entity_id,source_account_id)
);
CREATE UNIQUE INDEX discovery_one_source_investigation
  ON discovery_investigations(run_id) WHERE seller_entity_id IS NULL;

CREATE TABLE discovery_tasks (
  run_id TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('coordinator','identity','contract','receivables','connector')),
  question TEXT NOT NULL,
  grants JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting','succeeded','failed','interrupted')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 9),
  tool_rounds INTEGER NOT NULL DEFAULT 0 CHECK (tool_rounds BETWEEN 0 AND 8),
  repair_round INTEGER NOT NULL DEFAULT 0 CHECK (repair_round BETWEEN 0 AND 2),
  diagnostics TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (run_id,id),
  FOREIGN KEY (run_id,investigation_id) REFERENCES discovery_investigations(run_id,id)
);
CREATE UNIQUE INDEX discovery_one_coordinator ON discovery_tasks(run_id) WHERE role = 'coordinator';

CREATE TABLE discovery_task_dependencies (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  predecessor_id TEXT NOT NULL,
  PRIMARY KEY (run_id,task_id,predecessor_id),
  CHECK (task_id <> predecessor_id),
  FOREIGN KEY (run_id,task_id) REFERENCES discovery_tasks(run_id,id),
  FOREIGN KEY (run_id,predecessor_id) REFERENCES discovery_tasks(run_id,id)
);

CREATE TABLE discovery_dispatches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 9),
  generation BIGINT NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  task_revision BIGINT NOT NULL CHECK (task_revision BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','returned','interrupted')),
  request_hash TEXT NOT NULL,
  result_hash TEXT,
  accepted JSONB CHECK (octet_length(accepted::text) <= 262144),
  accounting TEXT CHECK (accounting IN ('known','unknown')),
  CHECK ((state = 'reserved') = (accounting IS NULL)),
  CHECK (result_hash IS NULL OR state = 'returned'),
  CHECK (accepted IS NULL OR (result_hash IS NOT NULL AND accounting = 'known')),
  UNIQUE (task_id,attempt),
  UNIQUE (run_id,task_id,id),
  FOREIGN KEY (run_id,task_id) REFERENCES discovery_tasks(run_id,id)
);

CREATE TABLE discovery_tool_steps (
  id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  native_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
  name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  arguments JSONB NOT NULL CHECK (octet_length(arguments::text) <= 131072),
  generation BIGINT NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','interrupted')),
  result JSONB CHECK (octet_length(result::text) <= 131072),
  UNIQUE (dispatch_id,native_id),
  UNIQUE (dispatch_id,ordinal),
  FOREIGN KEY (run_id,task_id,dispatch_id) REFERENCES discovery_dispatches(run_id,task_id,id)
);

CREATE TABLE discovery_actions (
  reviewer_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  action_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pause','resume')),
  request_hash TEXT NOT NULL,
  response JSONB NOT NULL,
  PRIMARY KEY (reviewer_id,run_id,action_key)
);

GRANT SELECT ON discovery_supervisor TO :app_role;
GRANT UPDATE (generation) ON discovery_supervisor TO :app_role;
GRANT SELECT, INSERT ON discovery_runs, discovery_investigations, discovery_tasks,
  discovery_task_dependencies, discovery_dispatches, discovery_tool_steps, discovery_actions TO :app_role;
GRANT UPDATE (status,revision,model_calls,input_tokens,output_tokens,unknown_calls,diagnostics)
  ON discovery_runs TO :app_role;
GRANT UPDATE (specialist_count) ON discovery_investigations TO :app_role;
GRANT UPDATE (status,revision,attempt,tool_rounds,diagnostics) ON discovery_tasks TO :app_role;
GRANT UPDATE (state,result_hash,accepted,accounting) ON discovery_dispatches TO :app_role;
GRANT UPDATE (state,result,generation) ON discovery_tool_steps TO :app_role;
