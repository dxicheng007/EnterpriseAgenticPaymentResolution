CREATE TABLE migration_ledger (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE seed_ledger (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE activity_counter (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  sequence BIGINT NOT NULL CHECK (sequence BETWEEN 0 AND 9007199254740991)
);
INSERT INTO activity_counter (sequence) VALUES (0);

CREATE TABLE activity_events (
  sequence BIGINT PRIMARY KEY CHECK (sequence BETWEEN 1 AND 9007199254740991),
  event JSONB NOT NULL CHECK (
    jsonb_typeof(event) = 'object'
    AND event ? 'stream' AND event->>'stream' = 'runtime'
    AND event ? 'sequence' AND (event->>'sequence')::bigint = sequence
  )
);
