ALTER TABLE discovery_tasks ADD UNIQUE (run_id,investigation_id,id);
ALTER TABLE discovery_tool_steps ADD UNIQUE (run_id,task_id,id);

CREATE TABLE discovery_finding_identities (
  run_id TEXT NOT NULL,
  id TEXT NOT NULL,
  investigation_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision BETWEEN 1 AND 10),
  PRIMARY KEY (run_id,id),
  UNIQUE (run_id,id,investigation_id),
  FOREIGN KEY (run_id,investigation_id) REFERENCES discovery_investigations(run_id,id)
);
CREATE INDEX discovery_finding_investigation ON discovery_finding_identities(run_id,investigation_id);

CREATE TABLE discovery_finding_revisions (
  run_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 10),
  investigation_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  tool_step_id TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY (run_id,finding_id,revision),
  FOREIGN KEY (run_id,finding_id,investigation_id) REFERENCES discovery_finding_identities(run_id,id,investigation_id),
  FOREIGN KEY (run_id,investigation_id,task_id) REFERENCES discovery_tasks(run_id,investigation_id,id),
  FOREIGN KEY (run_id,task_id,tool_step_id) REFERENCES discovery_tool_steps(run_id,task_id,id)
);
ALTER TABLE discovery_finding_identities ADD FOREIGN KEY (run_id,id,current_revision)
  REFERENCES discovery_finding_revisions(run_id,finding_id,revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE discovery_finding_derivations (
  run_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  input_finding_id TEXT NOT NULL,
  input_revision INTEGER NOT NULL,
  CHECK (finding_id <> input_finding_id),
  PRIMARY KEY (run_id,finding_id,revision,input_finding_id,input_revision),
  FOREIGN KEY (run_id,finding_id,revision) REFERENCES discovery_finding_revisions(run_id,finding_id,revision),
  FOREIGN KEY (run_id,input_finding_id,input_revision) REFERENCES discovery_finding_revisions(run_id,finding_id,revision)
);

CREATE TABLE discovery_finding_blockers (
  run_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  origin_revision INTEGER NOT NULL,
  investigation_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code IN ('FINDING_RESOLUTION_PENDING','FINDING_APPLICABILITY_UNRESOLVED')),
  PRIMARY KEY (run_id,finding_id,origin_revision,code),
  FOREIGN KEY (run_id,finding_id,origin_revision) REFERENCES discovery_finding_revisions(run_id,finding_id,revision),
  FOREIGN KEY (run_id,investigation_id) REFERENCES discovery_investigations(run_id,id)
);
CREATE INDEX discovery_finding_blocker_applicability ON discovery_finding_blockers(run_id,investigation_id);

CREATE TABLE discovery_proposal_identities (
  run_id TEXT NOT NULL REFERENCES discovery_runs(id),
  id TEXT NOT NULL,
  current_revision BIGINT NOT NULL CHECK (current_revision BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (run_id,id)
);

CREATE TABLE discovery_proposal_revisions (
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  task_id TEXT NOT NULL,
  tool_step_id TEXT NOT NULL UNIQUE,
  submitted JSONB NOT NULL CHECK (jsonb_typeof(submitted)='object'),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (run_id,proposal_id,revision),
  FOREIGN KEY (run_id,proposal_id) REFERENCES discovery_proposal_identities(run_id,id),
  FOREIGN KEY (run_id,task_id,tool_step_id) REFERENCES discovery_tool_steps(run_id,task_id,id)
);
ALTER TABLE discovery_proposal_identities ADD FOREIGN KEY (run_id,id,current_revision)
  REFERENCES discovery_proposal_revisions(run_id,proposal_id,revision) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE discovery_proposal_findings (
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision BIGINT NOT NULL,
  finding_id TEXT NOT NULL,
  finding_revision INTEGER NOT NULL,
  PRIMARY KEY (run_id,proposal_id,proposal_revision,finding_id,finding_revision),
  FOREIGN KEY (run_id,proposal_id,proposal_revision) REFERENCES discovery_proposal_revisions(run_id,proposal_id,revision),
  FOREIGN KEY (run_id,finding_id,finding_revision) REFERENCES discovery_finding_revisions(run_id,finding_id,revision)
);

CREATE TABLE discovery_proposal_investigations (
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  investigation_id TEXT NOT NULL,
  PRIMARY KEY (run_id,proposal_id,investigation_id),
  FOREIGN KEY (run_id,proposal_id) REFERENCES discovery_proposal_identities(run_id,id),
  FOREIGN KEY (run_id,investigation_id) REFERENCES discovery_investigations(run_id,id)
);

CREATE TABLE discovery_proposal_assessments (
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision BIGINT NOT NULL,
  assessment_revision BIGINT NOT NULL CHECK (assessment_revision BETWEEN 1 AND 9007199254740991),
  observed_run_revision BIGINT NOT NULL CHECK (observed_run_revision BETWEEN 1 AND 9007199254740991),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  PRIMARY KEY (run_id,proposal_id,proposal_revision,assessment_revision),
  FOREIGN KEY (run_id,proposal_id,proposal_revision) REFERENCES discovery_proposal_revisions(run_id,proposal_id,revision)
);

CREATE TABLE discovery_compile_steps (
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  tool_step_id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_revision BIGINT NOT NULL,
  assessment_revision BIGINT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  source_payload JSONB NOT NULL CHECK (jsonb_typeof(source_payload)='object'),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','registered','settled')),
  registration JSONB,
  result JSONB,
  CHECK (state <> 'registered' OR registration IS NOT NULL),
  CHECK ((state = 'settled') = (result IS NOT NULL)),
  CHECK (state <> 'reserved' OR registration IS NULL),
  UNIQUE (run_id,proposal_id,proposal_revision,assessment_revision,tool_step_id),
  FOREIGN KEY (run_id,task_id,tool_step_id) REFERENCES discovery_tool_steps(run_id,task_id,id),
  FOREIGN KEY (run_id,proposal_id,proposal_revision,assessment_revision)
    REFERENCES discovery_proposal_assessments(run_id,proposal_id,proposal_revision,assessment_revision)
);

CREATE TABLE discovery_proposal_current (
  run_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal_revision BIGINT NOT NULL,
  assessment_revision BIGINT NOT NULL,
  compile_step_id TEXT,
  result JSONB NOT NULL CHECK (jsonb_typeof(result)='object'),
  PRIMARY KEY (run_id,proposal_id),
  FOREIGN KEY (run_id,proposal_id,proposal_revision,assessment_revision)
    REFERENCES discovery_proposal_assessments(run_id,proposal_id,proposal_revision,assessment_revision),
  FOREIGN KEY (run_id,proposal_id,proposal_revision,assessment_revision,compile_step_id)
    REFERENCES discovery_compile_steps(run_id,proposal_id,proposal_revision,assessment_revision,tool_step_id)
);

GRANT SELECT, INSERT ON discovery_finding_identities, discovery_finding_revisions,
  discovery_finding_derivations, discovery_finding_blockers, discovery_proposal_identities,
  discovery_proposal_revisions, discovery_proposal_findings, discovery_proposal_investigations,
  discovery_proposal_assessments, discovery_proposal_current, discovery_compile_steps TO :app_role;
GRANT UPDATE (current_revision) ON discovery_finding_identities, discovery_proposal_identities TO :app_role;
GRANT UPDATE (proposal_revision,assessment_revision,compile_step_id,result) ON discovery_proposal_current TO :app_role;
GRANT UPDATE (state,registration,result) ON discovery_compile_steps TO :app_role;
