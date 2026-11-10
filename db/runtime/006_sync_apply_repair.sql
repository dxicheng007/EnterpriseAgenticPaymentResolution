-- Keep receipt histories in their original domains. One shared record key
-- makes original economic ownership exclusive across both domains.

ALTER TABLE parent_financial_records
  ADD UNIQUE (account_id, company_id, seller_entity_id, record_id);
ALTER TABLE runtime_sync_economic_outcomes
  ADD FOREIGN KEY (account_id, company_id, seller_entity_id, record_id)
    REFERENCES parent_financial_records (account_id, company_id, seller_entity_id, record_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE runtime_financial_origins (
  record_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  initial_import_key TEXT,
  initial_receipt_id TEXT,
  sync_receipt_id TEXT,
  UNIQUE (account_id, company_id, seller_entity_id, record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, record_id)
    REFERENCES parent_financial_records (account_id, company_id, seller_entity_id, record_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id)
    REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (account_id, company_id, seller_entity_id, sync_receipt_id)
    REFERENCES runtime_sync_receipts (account_id, company_id, seller_entity_id, receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK ((initial_import_key IS NOT NULL AND initial_receipt_id IS NOT NULL AND sync_receipt_id IS NULL)
      OR (initial_import_key IS NULL AND initial_receipt_id IS NULL AND sync_receipt_id IS NOT NULL))
);

LOCK TABLE runtime_economic_outcomes IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM parent_financial_records r
    LEFT JOIN runtime_economic_outcomes i USING (account_id, company_id, seller_entity_id, record_id)
    LEFT JOIN runtime_sync_economic_outcomes o USING (account_id, company_id, seller_entity_id, record_id)
    WHERE (i.record_id IS NULL) = (o.record_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'Missing or ambiguous financial origin' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH receipt_records AS (
      SELECT receipt_id, parent_index_projection(receipt)->'targetRecordIds' AS records, 'initial' AS kind
      FROM runtime_activation_imports
      UNION ALL
      SELECT receipt_id, parent_index_projection(receipt)->'targetRecordIds', 'sync' FROM runtime_sync_receipts
    ), domain_records AS (
      SELECT receipt_id, record_id, 'initial' AS kind FROM runtime_economic_outcomes
      UNION ALL
      SELECT receipt_id, record_id, 'sync' FROM runtime_sync_economic_outcomes
    )
    SELECT 1 FROM receipt_records r
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(record_id)) AS records, count(*) AS count
      FROM domain_records d WHERE d.receipt_id = r.receipt_id AND d.kind = r.kind
    ) d ON TRUE
    WHERE CASE WHEN jsonb_typeof(r.records) = 'array'
      THEN d.count = 0 OR jsonb_array_length(r.records) <> d.count OR NOT COALESCE(d.records @> r.records, FALSE)
      ELSE TRUE END
  ) THEN
    RAISE EXCEPTION 'Receipt record is missing its original economic claim' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH claims AS (
      SELECT i.account_id, i.company_id, i.seller_entity_id, i.record_id,
        a.approved_snapshot_hash AS snapshot_hash, a.target_version, a.receipt_id, a.receipt, a.receipt_digest
      FROM runtime_economic_outcomes i
      JOIN runtime_activation_imports a USING (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
      UNION ALL
      SELECT o.account_id, o.company_id, o.seller_entity_id, o.record_id,
        s.after_snapshot_hash, s.after_version, s.receipt_id, s.receipt, s.receipt_digest
      FROM runtime_sync_economic_outcomes o
      JOIN runtime_sync_receipts s USING (account_id, company_id, seller_entity_id, receipt_id)
    )
    SELECT 1
    FROM claims c
    JOIN parent_financial_records r USING (account_id, company_id, seller_entity_id, record_id)
    JOIN parent_snapshots s USING (account_id, company_id, seller_entity_id, snapshot_hash, target_version)
    CROSS JOIN LATERAL (SELECT parent_index_projection(c.receipt) AS receipt, parent_index_projection(s.canonical) AS snapshot) j
    WHERE c.receipt_digest <> encode(sha256(convert_to(c.receipt, 'UTF8')), 'hex')
      OR j.receipt->'id' IS DISTINCT FROM to_jsonb(c.receipt_id)
      OR j.receipt->'scope' IS DISTINCT FROM
        jsonb_build_object('accountId', c.account_id, 'companyId', c.company_id, 'sellerEntityId', c.seller_entity_id)
      OR NOT COALESCE((j.receipt->'targetRecordIds') @> jsonb_build_array(c.record_id), FALSE)
      OR r.digest <> encode(sha256(convert_to(r.canonical, 'UTF8')), 'hex')
      OR s.digest <> encode(sha256(convert_to(s.canonical, 'UTF8')), 'hex')
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          (j.snapshot->'invoices') || (j.snapshot->'payments') || (j.snapshot->'credits') ||
          (j.snapshot->'allocations') || (j.snapshot->'reversals')
        ) AS record(value)
        WHERE record.value = parent_index_projection(r.canonical)
      )
  ) THEN
    RAISE EXCEPTION 'Financial origin does not bind its record and receipt' USING ERRCODE = '23514';
  END IF;
END;
$$;

INSERT INTO runtime_financial_origins
  (account_id, company_id, seller_entity_id, record_id, initial_import_key, initial_receipt_id)
SELECT account_id, company_id, seller_entity_id, record_id, idempotency_key, receipt_id FROM runtime_economic_outcomes;
INSERT INTO runtime_financial_origins (account_id, company_id, seller_entity_id, record_id, sync_receipt_id)
SELECT account_id, company_id, seller_entity_id, record_id, receipt_id FROM runtime_sync_economic_outcomes;

CREATE FUNCTION insert_runtime_financial_origin() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'runtime_economic_outcomes' THEN
    INSERT INTO runtime_financial_origins
      (account_id, company_id, seller_entity_id, record_id, initial_import_key, initial_receipt_id)
    VALUES (NEW.account_id, NEW.company_id, NEW.seller_entity_id, NEW.record_id, NEW.idempotency_key, NEW.receipt_id);
  ELSE
    INSERT INTO runtime_financial_origins (account_id, company_id, seller_entity_id, record_id, sync_receipt_id)
    VALUES (NEW.account_id, NEW.company_id, NEW.seller_entity_id, NEW.record_id, NEW.receipt_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runtime_initial_economic_origin AFTER INSERT ON runtime_economic_outcomes
FOR EACH ROW EXECUTE FUNCTION insert_runtime_financial_origin();
CREATE TRIGGER runtime_sync_economic_origin AFTER INSERT ON runtime_sync_economic_outcomes
FOR EACH ROW EXECUTE FUNCTION insert_runtime_financial_origin();

-- A capture lane may be shared by several imports. Bind each unit/head to its
-- own committed import and that import's exact lane, independently of which
-- activation first created the lane.
ALTER TABLE runtime_activation_imports
  ADD capture_source_ref TEXT GENERATED ALWAYS AS (parent_index_projection(bundle) #>> '{manifest,sourceRef}') STORED,
  ADD capture_manifest_hash TEXT GENERATED ALWAYS AS (parent_index_projection(bundle) #>> '{manifest,hash}') STORED,
  ADD UNIQUE (account_id, company_id, seller_entity_id, activation_id, bundle_hash, capture_source_ref, capture_manifest_hash);
ALTER TABLE runtime_capture_checkpoints ADD UNIQUE (source_ref, manifest_hash, stream_id, baseline_cursor);
ALTER TABLE runtime_inbox ADD UNIQUE (source_ref, manifest_hash, stream_id, sequence, event_id);

CREATE TABLE runtime_sync_units (
  unit_hash TEXT PRIMARY KEY CHECK (unit_hash ~ '^[0-9a-f]{64}$'),
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  activation_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  epoch BIGINT NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  from_cursor BIGINT NOT NULL CHECK (from_cursor BETWEEN 0 AND 9007199254740991),
  through_cursor BIGINT NOT NULL CHECK (through_cursor BETWEEN 1 AND 9007199254740991),
  before_version BIGINT NOT NULL CHECK (before_version BETWEEN 0 AND 9007199254740991),
  before_snapshot_hash TEXT NOT NULL,
  after_version BIGINT NOT NULL CHECK (after_version BETWEEN 0 AND 9007199254740991),
  after_snapshot_hash TEXT NOT NULL,
  receipt_id TEXT UNIQUE,
  audit TEXT NOT NULL CHECK (audit IS JSON OBJECT),
  audit_digest TEXT NOT NULL CHECK (audit_digest = encode(sha256(convert_to(audit, 'UTF8')), 'hex')),
  UNIQUE (activation_id, manifest_hash, stream_id, from_cursor),
  UNIQUE (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id, unit_hash),
  FOREIGN KEY (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash)
    REFERENCES runtime_activation_imports
      (account_id, company_id, seller_entity_id, activation_id, bundle_hash, capture_source_ref, capture_manifest_hash),
  FOREIGN KEY (source_ref, manifest_hash, stream_id) REFERENCES runtime_capture_checkpoints (source_ref, manifest_hash, stream_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, before_snapshot_hash, before_version)
    REFERENCES parent_snapshots (account_id, company_id, seller_entity_id, snapshot_hash, target_version),
  FOREIGN KEY (account_id, company_id, seller_entity_id, after_snapshot_hash, after_version)
    REFERENCES parent_snapshots (account_id, company_id, seller_entity_id, snapshot_hash, target_version),
  FOREIGN KEY (account_id, company_id, seller_entity_id, receipt_id)
    REFERENCES runtime_sync_receipts (account_id, company_id, seller_entity_id, receipt_id),
  CHECK (through_cursor - from_cursor BETWEEN 1 AND 1000),
  CHECK (CASE WHEN receipt_id IS NULL
    THEN after_version = before_version AND after_snapshot_hash = before_snapshot_hash
    ELSE after_version = before_version + 1 END),
  CHECK (parent_index_projection(audit)->'identity' IS NOT DISTINCT FROM
    jsonb_build_object('scope', jsonb_build_object('accountId', account_id, 'companyId', company_id, 'sellerEntityId', seller_entity_id),
      'activationId', activation_id, 'bundleHash', bundle_hash)),
  CHECK (parent_index_projection(audit)->'lane' IS NOT DISTINCT FROM
    jsonb_build_object('schemaVersion', '1', 'sourceRef', source_ref, 'manifestHash', manifest_hash)),
  CHECK (parent_index_projection(audit)->'unitHash' IS NOT DISTINCT FROM to_jsonb(unit_hash)),
  CHECK (parent_index_projection(audit)->'streamId' IS NOT DISTINCT FROM to_jsonb(stream_id)),
  CHECK (parent_index_projection(audit)->'expectedEpoch' IS NOT DISTINCT FROM to_jsonb(epoch)),
  CHECK (parent_index_projection(audit)->'fromCursor' IS NOT DISTINCT FROM to_jsonb(from_cursor::text)),
  CHECK (parent_index_projection(audit)->'throughCursor' IS NOT DISTINCT FROM to_jsonb(through_cursor::text)),
  CHECK (parent_index_projection(audit)->'expectedTargetVersion' IS NOT DISTINCT FROM to_jsonb(before_version)),
  CHECK (parent_index_projection(audit)->'beforeSnapshotHash' IS NOT DISTINCT FROM to_jsonb(before_snapshot_hash)),
  CHECK (parent_index_projection(audit)->'afterTargetVersion' IS NOT DISTINCT FROM to_jsonb(after_version)),
  CHECK (parent_index_projection(audit)->'afterSnapshotHash' IS NOT DISTINCT FROM to_jsonb(after_snapshot_hash)),
  CHECK (parent_index_projection(audit)->'receiptId' IS NOT DISTINCT FROM COALESCE(to_jsonb(receipt_id), 'null'::jsonb))
);

CREATE TABLE runtime_sync_event_outcomes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  activation_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  event_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  unit_hash TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('new', 'replay', 'coalesced')),
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest = encode(sha256(convert_to(canonical, 'UTF8')), 'hex')),
  PRIMARY KEY (source_ref, event_id),
  UNIQUE (activation_id, manifest_hash, stream_id, sequence),
  FOREIGN KEY (account_id, company_id, seller_entity_id, record_id)
    REFERENCES runtime_financial_origins (account_id, company_id, seller_entity_id, record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id, unit_hash)
    REFERENCES runtime_sync_units (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id, unit_hash),
  FOREIGN KEY (source_ref, manifest_hash, stream_id, sequence, event_id)
    REFERENCES runtime_inbox (source_ref, manifest_hash, stream_id, sequence, event_id),
  FOREIGN KEY (source_ref, stream_id, sequence, event_id)
    REFERENCES runtime_source_positions (source_ref, stream_id, sequence, event_id),
  CHECK (parent_index_projection(canonical)->'identity' IS NOT DISTINCT FROM
    jsonb_build_object('scope', jsonb_build_object('accountId', account_id, 'companyId', company_id, 'sellerEntityId', seller_entity_id),
      'activationId', activation_id, 'bundleHash', bundle_hash)),
  CHECK (parent_index_projection(canonical)->'lane' IS NOT DISTINCT FROM
    jsonb_build_object('schemaVersion', '1', 'sourceRef', source_ref, 'manifestHash', manifest_hash)),
  CHECK (parent_index_projection(canonical) #> '{event,sourceRef}' IS NOT DISTINCT FROM to_jsonb(source_ref)),
  CHECK (parent_index_projection(canonical) #> '{event,streamId}' IS NOT DISTINCT FROM to_jsonb(stream_id)),
  CHECK (parent_index_projection(canonical) #> '{event,sequence}' IS NOT DISTINCT FROM to_jsonb(sequence)),
  CHECK (parent_index_projection(canonical) #> '{event,eventId}' IS NOT DISTINCT FROM to_jsonb(event_id)),
  CHECK (parent_index_projection(canonical)->'recordId' IS NOT DISTINCT FROM to_jsonb(record_id)),
  CHECK (parent_index_projection(canonical)->'unitHash' IS NOT DISTINCT FROM to_jsonb(unit_hash)),
  CHECK (parent_index_projection(canonical)->'disposition' IS NOT DISTINCT FROM to_jsonb(disposition))
);

CREATE FUNCTION check_runtime_sync_event_outcome() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  payload JSONB := parent_index_projection(NEW.canonical);
  origin runtime_financial_origins%ROWTYPE;
  receipt_payload JSONB;
  unit_members JSONB;
  delivery_hash TEXT;
BEGIN
  SELECT content_hash INTO delivery_hash
    FROM runtime_deliveries WHERE source_ref = NEW.source_ref AND event_id = NEW.event_id;
  IF FOUND AND payload #> '{event,contentHash}' IS DISTINCT FROM to_jsonb(delivery_hash) THEN
    RAISE EXCEPTION 'Event outcome differs from its captured delivery hash' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO origin FROM runtime_financial_origins WHERE record_id = NEW.record_id;
  IF NOT FOUND THEN RETURN NEW; END IF; -- The scoped foreign key reports a missing origin.
  IF origin.initial_import_key IS NOT NULL THEN
    SELECT parent_index_projection(receipt) INTO receipt_payload
      FROM runtime_activation_imports WHERE idempotency_key = origin.initial_import_key;
    IF payload->'origin' IS DISTINCT FROM jsonb_build_object(
      'kind', 'initial', 'recordId', NEW.record_id, 'importKey', origin.initial_import_key, 'receipt', receipt_payload
    ) THEN
      RAISE EXCEPTION 'Event outcome differs from initial financial origin' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT parent_index_projection(receipt) INTO receipt_payload
      FROM runtime_sync_receipts WHERE receipt_id = origin.sync_receipt_id;
    IF payload->'origin' IS DISTINCT FROM jsonb_build_object(
      'kind', 'sync', 'recordId', NEW.record_id, 'receipt', receipt_payload
    ) THEN
      RAISE EXCEPTION 'Event outcome differs from ongoing financial origin' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT parent_index_projection(audit)->'members' INTO unit_members FROM runtime_sync_units WHERE unit_hash = NEW.unit_hash;
  IF FOUND AND NOT COALESCE(unit_members @> jsonb_build_array(payload - ARRAY['identity', 'lane', 'unitHash']), FALSE) THEN
    RAISE EXCEPTION 'Event outcome is absent from its acknowledging unit' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runtime_sync_event_outcome_origin BEFORE INSERT ON runtime_sync_event_outcomes
FOR EACH ROW EXECUTE FUNCTION check_runtime_sync_event_outcome();

CREATE TABLE runtime_sync_application_heads (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  activation_id TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  baseline_cursor BIGINT NOT NULL CHECK (baseline_cursor BETWEEN 0 AND 9007199254740991),
  applied_through BIGINT NOT NULL CHECK (applied_through BETWEEN baseline_cursor AND 9007199254740991),
  last_unit_hash TEXT,
  PRIMARY KEY (activation_id, source_ref, manifest_hash, stream_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash)
    REFERENCES runtime_activation_imports
      (account_id, company_id, seller_entity_id, activation_id, bundle_hash, capture_source_ref, capture_manifest_hash),
  FOREIGN KEY (source_ref, manifest_hash, stream_id, baseline_cursor)
    REFERENCES runtime_capture_checkpoints (source_ref, manifest_hash, stream_id, baseline_cursor),
  FOREIGN KEY (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id, last_unit_hash)
    REFERENCES runtime_sync_units (account_id, company_id, seller_entity_id, activation_id, bundle_hash, source_ref, manifest_hash, stream_id, unit_hash),
  CHECK ((last_unit_hash IS NULL) = (applied_through = baseline_cursor))
);

CREATE FUNCTION guard_runtime_sync_application_head() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Application progress must be retained' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.applied_through <> NEW.baseline_cursor OR NEW.last_unit_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Application head must start at its approved baseline' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.account_id, NEW.company_id, NEW.seller_entity_id, NEW.activation_id, NEW.bundle_hash,
        NEW.source_ref, NEW.manifest_hash, NEW.stream_id, NEW.baseline_cursor) IS DISTINCT FROM
       (OLD.account_id, OLD.company_id, OLD.seller_entity_id, OLD.activation_id, OLD.bundle_hash,
        OLD.source_ref, OLD.manifest_hash, OLD.stream_id, OLD.baseline_cursor) THEN
      RAISE EXCEPTION 'Application head identity and baseline are immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.applied_through <= OLD.applied_through OR NOT EXISTS (
      SELECT 1
      FROM runtime_sync_units u
      JOIN runtime_capture_checkpoints c USING (source_ref, manifest_hash, stream_id)
      WHERE u.unit_hash = NEW.last_unit_hash AND u.from_cursor = OLD.applied_through
        AND u.through_cursor = NEW.applied_through AND c.transport = 'api' AND c.capture_cursor >= u.through_cursor
    ) THEN
      RAISE EXCEPTION 'Application progress must advance through its next captured financial unit' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runtime_sync_application_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_sync_application_heads
FOR EACH ROW EXECUTE FUNCTION guard_runtime_sync_application_head();

CREATE TRIGGER runtime_financial_origins_immutable BEFORE UPDATE OR DELETE ON runtime_financial_origins
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_sync_units_immutable BEFORE UPDATE OR DELETE ON runtime_sync_units
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_sync_event_outcomes_immutable BEFORE UPDATE OR DELETE ON runtime_sync_event_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();

REVOKE INSERT ON runtime_sync_delivery_outcomes FROM :app_role;
GRANT SELECT, INSERT ON runtime_financial_origins, runtime_sync_units, runtime_sync_event_outcomes,
  runtime_sync_application_heads TO :app_role;
GRANT UPDATE (applied_through, last_unit_hash) ON runtime_sync_application_heads TO :app_role;
