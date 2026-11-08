CREATE TABLE source_files (
  file_id text PRIMARY KEY,
  company_id text NOT NULL,
  source_ref text NOT NULL,
  document_id text NOT NULL,
  document_version bigint NOT NULL CHECK (document_version > 0),
  content_hash text NOT NULL,
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 10485760),
  metadata jsonb NOT NULL,
  extraction jsonb NOT NULL,
  extraction_hash text NOT NULL,
  batch_id text,
  batch_sequence bigint CHECK (batch_sequence > 0),
  batch_stream_id text,
  UNIQUE (company_id, source_ref, document_id, document_version),
  UNIQUE (source_ref, batch_stream_id, batch_id),
  UNIQUE (source_ref, batch_stream_id, batch_sequence),
  CHECK ((batch_id IS NULL AND batch_sequence IS NULL AND batch_stream_id IS NULL) OR
         (batch_id IS NOT NULL AND batch_sequence IS NOT NULL AND batch_stream_id IS NOT NULL))
);

CREATE TABLE source_events (
  source_ref text NOT NULL,
  stream_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id text NOT NULL,
  content_hash text NOT NULL,
  event jsonb NOT NULL,
  api_source_id text UNIQUE,
  api_original_hash text,
  api_byte_length integer CHECK (api_byte_length > 0),
  api_extraction jsonb,
  PRIMARY KEY (source_ref, event_id),
  UNIQUE (source_ref, stream_id, sequence),
  CHECK ((api_source_id IS NULL AND api_original_hash IS NULL AND api_byte_length IS NULL AND api_extraction IS NULL) OR
         (api_source_id IS NOT NULL AND api_original_hash IS NOT NULL AND api_byte_length IS NOT NULL AND api_extraction IS NOT NULL))
);

CREATE TABLE source_manifests (
  manifest_id text PRIMARY KEY,
  company_id text NOT NULL,
  source_ref text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0),
  manifest jsonb NOT NULL,
  UNIQUE (source_ref, epoch)
);
CREATE INDEX source_manifests_company_epoch ON source_manifests (company_id, epoch DESC);

CREATE TABLE source_snapshots (
  snapshot_id text PRIMARY KEY,
  manifest_id text NOT NULL REFERENCES source_manifests (manifest_id),
  stream_id text,
  snapshot jsonb NOT NULL,
  UNIQUE NULLS NOT DISTINCT (manifest_id, stream_id)
);

CREATE TABLE source_dossiers (
  manifest_id text PRIMARY KEY REFERENCES source_manifests (manifest_id),
  dossier jsonb NOT NULL
);

CREATE TABLE source_evidence (
  evidence_id text PRIMARY KEY,
  snapshot_id text NOT NULL,
  file_id text REFERENCES source_files (file_id),
  api_source_id text REFERENCES source_events (api_source_id),
  evidence jsonb NOT NULL,
  CHECK (num_nonnulls(file_id, api_source_id) = 1)
);

GRANT SELECT, INSERT ON source_files TO :app_role;
GRANT SELECT, INSERT ON source_events TO :app_role;
GRANT SELECT, INSERT ON source_manifests TO :app_role;
GRANT SELECT, INSERT ON source_snapshots TO :app_role;
GRANT SELECT, INSERT, UPDATE ON source_dossiers TO :app_role;
GRANT SELECT, INSERT ON source_evidence TO :app_role;
