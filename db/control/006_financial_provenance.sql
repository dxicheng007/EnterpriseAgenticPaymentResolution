ALTER TABLE verification_reports ADD UNIQUE (id, job_id);

CREATE TABLE financial_verification_reservations (
  job_id TEXT PRIMARY KEY REFERENCES verification_jobs(id),
  artifact_hash TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  capture_hash TEXT NOT NULL CHECK (capture_hash ~ '^[0-9a-f]{64}$'),
  reservation_bytes BYTEA NOT NULL,
  reservation_hash TEXT NOT NULL CHECK (reservation_hash ~ '^[0-9a-f]{64}$'),
  request_bytes BYTEA NOT NULL CHECK (octet_length(request_bytes) BETWEEN 1 AND 10485760),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  UNIQUE (job_id, request_hash),
  FOREIGN KEY (artifact_hash, manifest_id) REFERENCES artifact_captures
);

CREATE INDEX financial_verification_capture_idx
  ON financial_verification_reservations (artifact_hash, manifest_id, snapshot_id);

CREATE TABLE financial_verification_attestations (
  report_id TEXT PRIMARY KEY CHECK (report_id = 'report:' || job_id),
  job_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  completion_bytes BYTEA NOT NULL CHECK (octet_length(completion_bytes) BETWEEN 1 AND 10485760),
  report_bytes BYTEA NOT NULL,
  report_hash TEXT NOT NULL CHECK (report_hash ~ '^[0-9a-f]{64}$'),
  attestation_bytes BYTEA NOT NULL,
  attestation_hash TEXT NOT NULL CHECK (attestation_hash ~ '^[0-9a-f]{64}$'),
  FOREIGN KEY (report_id, job_id) REFERENCES verification_reports (id, job_id),
  FOREIGN KEY (job_id, request_hash) REFERENCES financial_verification_reservations (job_id, request_hash)
);

GRANT SELECT, INSERT ON financial_verification_reservations, financial_verification_attestations TO :app_role;
