CREATE TABLE review_heads (
  account_id TEXT PRIMARY KEY,
  package_id TEXT,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
  CHECK ((package_id IS NULL) = (revision = 0))
);

CREATE TABLE prepared_reviews (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES review_heads,
  source_ref TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  package_hash TEXT NOT NULL CHECK (package_hash ~ '^[0-9a-f]{64}$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  package_canonical TEXT NOT NULL CHECK (jsonb_typeof(package_canonical::jsonb) = 'object'),
  companion_canonical TEXT NOT NULL CHECK (jsonb_typeof(companion_canonical::jsonb) = 'object'),
  companion_digest TEXT NOT NULL CHECK (companion_digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (account_id, revision),
  UNIQUE (account_id, revision, id),
  UNIQUE (account_id, source_ref, id)
);

ALTER TABLE review_heads ADD FOREIGN KEY (account_id, revision, package_id)
  REFERENCES prepared_reviews (account_id, revision, id);

CREATE TABLE review_bootstrap_selections (
  selection_hash TEXT PRIMARY KEY CHECK (selection_hash ~ '^[0-9a-f]{64}$'),
  result_id TEXT NOT NULL REFERENCES bootstrap_verification_results
);

CREATE TABLE activation_intents (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  package_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request_canonical TEXT NOT NULL CHECK (jsonb_typeof(request_canonical::jsonb) = 'object'),
  bundle_hash TEXT NOT NULL CHECK (bundle_hash ~ '^[0-9a-f]{64}$'),
  bundle_canonical TEXT NOT NULL CHECK (jsonb_typeof(bundle_canonical::jsonb) = 'object'),
  bundle_digest TEXT NOT NULL CHECK (bundle_digest ~ '^[0-9a-f]{64}$'),
  committed_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (account_id, source_ref, package_id) REFERENCES prepared_reviews (account_id, source_ref, id)
);

CREATE TABLE activation_receipt_observations (
  intent_id TEXT PRIMARY KEY REFERENCES activation_intents,
  receipt_id TEXT NOT NULL UNIQUE,
  receipt_canonical TEXT NOT NULL CHECK (jsonb_typeof(receipt_canonical::jsonb) = 'object'),
  receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE FUNCTION reject_review_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Review history is immutable';
END;
$$;

CREATE TRIGGER prepared_reviews_immutable BEFORE UPDATE OR DELETE ON prepared_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_review_history_mutation();
CREATE TRIGGER review_bootstrap_selections_immutable BEFORE UPDATE OR DELETE ON review_bootstrap_selections
  FOR EACH ROW EXECUTE FUNCTION reject_review_history_mutation();
CREATE TRIGGER activation_intents_immutable BEFORE UPDATE OR DELETE ON activation_intents
  FOR EACH ROW EXECUTE FUNCTION reject_review_history_mutation();
CREATE TRIGGER activation_receipt_observations_immutable BEFORE UPDATE OR DELETE ON activation_receipt_observations
  FOR EACH ROW EXECUTE FUNCTION reject_review_history_mutation();

GRANT SELECT, INSERT ON review_heads, prepared_reviews, review_bootstrap_selections,
  activation_intents, activation_receipt_observations TO :app_role;
GRANT UPDATE (package_id, revision) ON review_heads TO :app_role;
