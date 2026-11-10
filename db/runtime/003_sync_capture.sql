CREATE TABLE runtime_capture_lanes (
  source_ref TEXT NOT NULL CHECK (source_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  manifest_hash TEXT NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  initial_activation_id TEXT NOT NULL REFERENCES runtime_activation_imports (activation_id)
    CHECK (initial_activation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  manifest_canonical TEXT NOT NULL,
  manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  capture_canonical TEXT NOT NULL,
  capture_digest TEXT NOT NULL CHECK (capture_digest ~ '^[0-9a-f]{64}$'),
  initialized_at TEXT NOT NULL CHECK (initialized_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  PRIMARY KEY (source_ref, manifest_hash),
  CHECK (jsonb_typeof(parent_index_projection(manifest_canonical)) IS NOT DISTINCT FROM 'object'),
  CHECK (parent_index_projection(manifest_canonical)->'sourceRef' IS NOT DISTINCT FROM to_jsonb(source_ref)),
  CHECK (parent_index_projection(manifest_canonical)->'hash' IS NOT DISTINCT FROM to_jsonb(manifest_hash)),
  CHECK (jsonb_typeof(parent_index_projection(capture_canonical)) IS NOT DISTINCT FROM 'array')
);

CREATE TABLE runtime_capture_checkpoints (
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL CHECK (stream_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  transport TEXT NOT NULL CHECK (transport IN ('api', 'semantic')),
  baseline_cursor BIGINT NOT NULL CHECK (baseline_cursor BETWEEN 0 AND 9007199254740991),
  capture_cursor BIGINT NOT NULL CHECK (capture_cursor BETWEEN 0 AND 9007199254740991),
  captured_pages BIGINT NOT NULL CHECK (captured_pages BETWEEN 0 AND 9007199254740991),
  last_captured_at TEXT CHECK (last_captured_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  PRIMARY KEY (source_ref, manifest_hash, stream_id),
  FOREIGN KEY (source_ref, manifest_hash) REFERENCES runtime_capture_lanes (source_ref, manifest_hash),
  CHECK (capture_cursor >= baseline_cursor AND captured_pages <= capture_cursor - baseline_cursor),
  CHECK ((capture_cursor = baseline_cursor) = (captured_pages = 0)),
  CHECK ((captured_pages = 0) = (last_captured_at IS NULL))
);

CREATE TABLE runtime_source_positions (
  source_ref TEXT NOT NULL,
  stream_id TEXT NOT NULL CHECK (stream_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  sequence BIGINT NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  event_id TEXT NOT NULL,
  PRIMARY KEY (source_ref, stream_id, sequence),
  UNIQUE (source_ref, event_id),
  UNIQUE (source_ref, stream_id, sequence, event_id),
  FOREIGN KEY (source_ref, event_id) REFERENCES runtime_deliveries (source_ref, event_id)
);

CREATE TABLE runtime_capture_pages (
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  after_cursor BIGINT NOT NULL CHECK (after_cursor BETWEEN 0 AND 9007199254740991),
  next_cursor BIGINT NOT NULL CHECK (next_cursor BETWEEN 1 AND 9007199254740991),
  event_count BIGINT NOT NULL CHECK (event_count BETWEEN 1 AND 1000),
  canonical TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  captured_at TEXT NOT NULL CHECK (captured_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  PRIMARY KEY (source_ref, manifest_hash, stream_id, after_cursor),
  FOREIGN KEY (source_ref, manifest_hash, stream_id)
    REFERENCES runtime_capture_checkpoints (source_ref, manifest_hash, stream_id),
  CHECK (next_cursor > after_cursor AND next_cursor - after_cursor = event_count),
  CHECK (jsonb_typeof(parent_index_projection(canonical)) IS NOT DISTINCT FROM 'object'),
  CHECK (parent_index_projection(canonical)->'sourceRef' IS NOT DISTINCT FROM to_jsonb(source_ref)),
  CHECK (parent_index_projection(canonical)->'streamId' IS NOT DISTINCT FROM to_jsonb(stream_id)),
  CHECK (parent_index_projection(canonical)->'after' IS NOT DISTINCT FROM to_jsonb(after_cursor::text)),
  CHECK (parent_index_projection(canonical)->'next' IS NOT DISTINCT FROM to_jsonb(next_cursor::text)),
  CHECK (parent_index_projection(canonical)->'complete' IS NOT DISTINCT FROM 'true'::jsonb),
  CHECK (CASE WHEN jsonb_typeof(parent_index_projection(canonical)->'events') = 'array'
              THEN jsonb_array_length(parent_index_projection(canonical)->'events') = event_count ELSE FALSE END)
);

CREATE TABLE runtime_inbox (
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  event_id TEXT NOT NULL,
  after_cursor BIGINT NOT NULL,
  PRIMARY KEY (source_ref, manifest_hash, stream_id, sequence),
  UNIQUE (source_ref, manifest_hash, event_id),
  FOREIGN KEY (source_ref, manifest_hash, stream_id, after_cursor)
    REFERENCES runtime_capture_pages (source_ref, manifest_hash, stream_id, after_cursor),
  FOREIGN KEY (source_ref, stream_id, sequence, event_id)
    REFERENCES runtime_source_positions (source_ref, stream_id, sequence, event_id),
  CHECK (after_cursor < sequence)
);

CREATE FUNCTION valid_capture_incident_ids(ids JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN CASE WHEN jsonb_typeof(ids) = 'array' THEN
  jsonb_array_length(ids) <= 20 AND (
    SELECT COALESCE(bool_and(
      jsonb_typeof(id) = 'string' AND (id #>> '{}') ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' AND
      (previous IS NULL OR (previous #>> '{}') COLLATE "C" < (id #>> '{}') COLLATE "C")
    ), TRUE)
    FROM (
      SELECT id, lag(id) OVER (ORDER BY ordinal) AS previous
      FROM jsonb_array_elements(ids) WITH ORDINALITY AS item(id, ordinal)
    ) ordered
  )
  ELSE FALSE
END;

CREATE TABLE runtime_capture_incidents (
  source_ref TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  incident_hash TEXT NOT NULL CHECK (incident_hash ~ '^[0-9a-f]{64}$'),
  code TEXT NOT NULL CHECK (code IN ('CAPTURE_IDENTITY_CONFLICT', 'CAPTURE_PAGE_CONFLICT', 'CAPTURE_GAP')),
  page_hash TEXT NOT NULL CHECK (page_hash ~ '^[0-9a-f]{64}$'),
  source_ids_canonical TEXT NOT NULL,
  source_ids_digest TEXT NOT NULL CHECK (source_ids_digest ~ '^[0-9a-f]{64}$'),
  observed_at TEXT NOT NULL CHECK (observed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'),
  PRIMARY KEY (source_ref, manifest_hash, stream_id, incident_hash),
  FOREIGN KEY (source_ref, manifest_hash, stream_id)
    REFERENCES runtime_capture_checkpoints (source_ref, manifest_hash, stream_id),
  CHECK (valid_capture_incident_ids(parent_index_projection(source_ids_canonical)))
);

CREATE TRIGGER runtime_capture_lanes_immutable BEFORE UPDATE OR DELETE ON runtime_capture_lanes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_source_positions_immutable BEFORE UPDATE OR DELETE ON runtime_source_positions
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_capture_pages_immutable BEFORE UPDATE OR DELETE ON runtime_capture_pages
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_inbox_immutable BEFORE UPDATE OR DELETE ON runtime_inbox
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_capture_incidents_immutable BEFORE UPDATE OR DELETE ON runtime_capture_incidents
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();

GRANT SELECT, INSERT ON runtime_capture_lanes, runtime_source_positions, runtime_capture_pages, runtime_inbox,
  runtime_capture_incidents, runtime_capture_checkpoints TO :app_role;
GRANT UPDATE (capture_cursor, captured_pages, last_captured_at) ON runtime_capture_checkpoints TO :app_role;
