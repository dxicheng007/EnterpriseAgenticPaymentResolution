-- Runtime first-import storage. All durable facts except the latest pointer are append-only.

-- PostgreSQL JSONB cannot decode NUL or lone UTF-16 surrogates, which canonical
-- JSON can preserve in escaped, unindexed strings. Only the SQL validation
-- projection replaces those escapes. Repositories verify the original bytes
-- and strict domain schemas. A literal escaped backslash is preserved.
CREATE FUNCTION parent_index_projection(canonical TEXT) RETURNS JSONB
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN regexp_replace(canonical,
  $pattern$(?<!\\)((?:\\\\)*)\\u(?:0000|[dD][89a-fA-F][0-9a-fA-F]{2})$pattern$,
  $replacement$\1�$replacement$, 'g')::jsonb;

CREATE TABLE parent_scopes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE (account_id, company_id, seller_entity_id),
  CHECK (account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  CHECK (company_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  CHECK (seller_entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$')
);

CREATE TABLE parent_snapshots (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  target_version BIGINT NOT NULL CHECK (target_version BETWEEN 0 AND 9007199254740991),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  recorded_as_of TEXT NOT NULL CHECK (recorded_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (account_id, snapshot_hash),
  UNIQUE (account_id, target_version),
  UNIQUE (account_id, company_id, seller_entity_id, snapshot_hash, target_version),
  FOREIGN KEY (account_id, company_id, seller_entity_id) REFERENCES parent_scopes (account_id, company_id, seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{version}') IS NOT DISTINCT FROM 'number' AND (parent_index_projection(canonical) #>> '{version}') IS NOT DISTINCT FROM target_version::text),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{asOf}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{asOf}') IS NOT DISTINCT FROM recorded_as_of)
);

CREATE TABLE parent_targets (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  target_version BIGINT NOT NULL CHECK (target_version BETWEEN 0 AND 9007199254740991),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (account_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, snapshot_hash, target_version) REFERENCES parent_snapshots (account_id, company_id, seller_entity_id, snapshot_hash, target_version)
);

CREATE TABLE parent_metadata (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('customer', 'account', 'billing_configuration')),
  record_id TEXT NOT NULL,
  customer_id TEXT,
  customer_family TEXT GENERATED ALWAYS AS ('customer'::text) STORED,
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (account_id, family, record_id),
  UNIQUE (account_id, company_id, seller_entity_id, family, record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id) REFERENCES parent_scopes (account_id, company_id, seller_entity_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, customer_family, customer_id) REFERENCES parent_metadata (account_id, company_id, seller_entity_id, family, record_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{id}') IS NOT DISTINCT FROM record_id),
  CHECK ((family = 'account') = (customer_id IS NOT NULL)),
  CHECK (family <> 'account' OR record_id = account_id),
  CHECK (family <> 'account' OR (parent_index_projection(canonical)->>'parentCustomerId') IS NOT DISTINCT FROM customer_id),
  CHECK (family = 'customer' OR (
    jsonb_typeof(parent_index_projection(canonical) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id AND
    jsonb_typeof(parent_index_projection(canonical) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id AND
    jsonb_typeof(parent_index_projection(canonical) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id
  ))
);

CREATE TABLE parent_financial_records (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  record_id TEXT PRIMARY KEY,
  source_ref TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'payment', 'credit', 'allocation', 'reversal')),
  source_record_id TEXT NOT NULL,
  source_record_version BIGINT NOT NULL CHECK (source_record_version BETWEEN 1 AND 9007199254740991),
  event_id TEXT NOT NULL,
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (source_ref, seller_entity_id, kind, source_record_id),
  UNIQUE (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id) REFERENCES parent_scopes (account_id, company_id, seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{id}') IS NOT DISTINCT FROM record_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{kind}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{kind}') IS NOT DISTINCT FROM kind),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{identity,kind}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{identity,kind}') IS NOT DISTINCT FROM kind),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{identity,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{identity,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{identity,sourceRef}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{identity,sourceRef}') IS NOT DISTINCT FROM source_ref),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{identity,recordId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{identity,recordId}') IS NOT DISTINCT FROM source_record_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{sourceRecordVersion}') IS NOT DISTINCT FROM 'number' AND (parent_index_projection(canonical) #>> '{sourceRecordVersion}') IS NOT DISTINCT FROM source_record_version::text),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{sourceEventId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{sourceEventId}') IS NOT DISTINCT FROM event_id)
);

CREATE TABLE runtime_deliveries (
  source_ref TEXT NOT NULL,
  event_id TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (source_ref, event_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{sourceRef}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{sourceRef}') IS NOT DISTINCT FROM source_ref),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{id}') IS NOT DISTINCT FROM event_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{contentHash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{contentHash}') IS NOT DISTINCT FROM content_hash)
);

CREATE TABLE runtime_activation_imports (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  idempotency_key TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL UNIQUE,
  receipt_id TEXT NOT NULL UNIQUE,
  bundle_hash TEXT NOT NULL CHECK (bundle_hash ~ '^[0-9a-f]{64}$'),
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  recorded_snapshot_hash TEXT NOT NULL CHECK (recorded_snapshot_hash ~ '^[0-9a-f]{64}$'),
  planner_snapshot_hash TEXT NOT NULL CHECK (planner_snapshot_hash ~ '^[0-9a-f]{64}$'),
  approved_snapshot_hash TEXT NOT NULL CHECK (approved_snapshot_hash ~ '^[0-9a-f]{64}$'),
  target_version BIGINT NOT NULL CHECK (target_version BETWEEN 0 AND 9007199254740991),
  request TEXT NOT NULL CHECK (request IS JSON OBJECT),
  request_digest TEXT NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  reviewer TEXT NOT NULL CHECK (reviewer IS JSON OBJECT),
  reviewer_digest TEXT NOT NULL CHECK (reviewer_digest ~ '^[0-9a-f]{64}$'),
  bundle TEXT NOT NULL CHECK (bundle IS JSON OBJECT),
  bundle_digest TEXT NOT NULL CHECK (bundle_digest ~ '^[0-9a-f]{64}$'),
  plan TEXT NOT NULL CHECK (plan IS JSON OBJECT),
  plan_digest TEXT NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  activation TEXT NOT NULL CHECK (activation IS JSON OBJECT),
  activation_digest TEXT NOT NULL CHECK (activation_digest ~ '^[0-9a-f]{64}$'),
  receipt TEXT NOT NULL CHECK (receipt IS JSON OBJECT),
  receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  recorded_target TEXT NOT NULL CHECK (recorded_target IS JSON OBJECT),
  recorded_target_digest TEXT NOT NULL CHECK (recorded_target_digest ~ '^[0-9a-f]{64}$'),
  planner_target TEXT NOT NULL CHECK (planner_target IS JSON OBJECT),
  planner_target_digest TEXT NOT NULL CHECK (planner_target_digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (account_id),
  UNIQUE (account_id, company_id, seller_entity_id, idempotency_key, receipt_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, approved_snapshot_hash, target_version) REFERENCES parent_snapshots (account_id, company_id, seller_entity_id, snapshot_hash, target_version),
  CHECK (jsonb_typeof(parent_index_projection(activation) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(activation) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(activation) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(activation) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(activation) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(activation) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(plan) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(plan) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(plan) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(plan) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(plan) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(plan) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(recorded_target) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(recorded_target) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(recorded_target) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(recorded_target) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(recorded_target) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(recorded_target) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(planner_target) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(planner_target) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(planner_target) #> '{scope,companyId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(planner_target) #>> '{scope,companyId}') IS NOT DISTINCT FROM company_id),
  CHECK (jsonb_typeof(parent_index_projection(planner_target) #> '{scope,sellerEntityId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(planner_target) #>> '{scope,sellerEntityId}') IS NOT DISTINCT FROM seller_entity_id),
  CHECK (jsonb_typeof(parent_index_projection(request) #> '{idempotencyKey}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(request) #>> '{idempotencyKey}') IS NOT DISTINCT FROM idempotency_key),
  CHECK (jsonb_typeof(parent_index_projection(activation) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(activation) #>> '{id}') IS NOT DISTINCT FROM activation_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{activationId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{activationId}') IS NOT DISTINCT FROM activation_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{id}') IS NOT DISTINCT FROM receipt_id),
  CHECK (jsonb_typeof(parent_index_projection(bundle) #> '{hash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(bundle) #>> '{hash}') IS NOT DISTINCT FROM bundle_hash),
  CHECK (jsonb_typeof(parent_index_projection(plan) #> '{hash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(plan) #>> '{hash}') IS NOT DISTINCT FROM plan_hash),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{planHash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{planHash}') IS NOT DISTINCT FROM plan_hash),
  CHECK (parent_index_projection(activation)->>'status' IS NOT DISTINCT FROM 'active'),
  CHECK (parent_index_projection(activation)->'epoch' IS NOT DISTINCT FROM '1'::jsonb),
  CHECK (parent_index_projection(receipt)->'epoch' IS NOT DISTINCT FROM '1'::jsonb),
  CHECK (parent_index_projection(receipt)->>'status' IS NOT DISTINCT FROM 'applied')
);

CREATE TABLE runtime_economic_outcomes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (source_ref, seller_entity_id, kind, source_record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id)
    REFERENCES parent_financial_records (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, idempotency_key, receipt_id) REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
);

CREATE TABLE runtime_delivery_outcomes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome = 'applied'),
  PRIMARY KEY (source_ref, event_id),
  FOREIGN KEY (source_ref, event_id) REFERENCES runtime_deliveries (source_ref, event_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, idempotency_key, receipt_id) REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
);

CREATE TABLE runtime_import_lineage (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  ordinal BIGINT NOT NULL CHECK (ordinal BETWEEN 0 AND 9007199254740991),
  operation_index BIGINT NOT NULL CHECK (operation_index BETWEEN 0 AND 9007199254740991),
  target_pointer TEXT NOT NULL,
  canonical TEXT NOT NULL CHECK (canonical IS JSON OBJECT),
  digest TEXT NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (idempotency_key, ordinal),
  FOREIGN KEY (account_id, company_id, seller_entity_id, idempotency_key, receipt_id) REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{operationIndex}') IS NOT DISTINCT FROM 'number' AND (parent_index_projection(canonical) #>> '{operationIndex}') IS NOT DISTINCT FROM operation_index::text),
  CHECK (jsonb_typeof(parent_index_projection(canonical) #> '{targetField}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(canonical) #>> '{targetField}') IS NOT DISTINCT FROM target_pointer)
);

CREATE FUNCTION reject_parent_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Parent import history is immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER parent_scopes_immutable BEFORE UPDATE OR DELETE ON parent_scopes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON parent_scopes TO :app_role;

CREATE TRIGGER parent_snapshots_immutable BEFORE UPDATE OR DELETE ON parent_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON parent_snapshots TO :app_role;

CREATE TRIGGER parent_metadata_immutable BEFORE UPDATE OR DELETE ON parent_metadata
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON parent_metadata TO :app_role;

CREATE TRIGGER parent_financial_records_immutable BEFORE UPDATE OR DELETE ON parent_financial_records
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON parent_financial_records TO :app_role;

CREATE TRIGGER runtime_deliveries_immutable BEFORE UPDATE OR DELETE ON runtime_deliveries
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_deliveries TO :app_role;

CREATE TRIGGER runtime_activation_imports_immutable BEFORE UPDATE OR DELETE ON runtime_activation_imports
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_activation_imports TO :app_role;

CREATE TRIGGER runtime_economic_outcomes_immutable BEFORE UPDATE OR DELETE ON runtime_economic_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_economic_outcomes TO :app_role;

CREATE TRIGGER runtime_delivery_outcomes_immutable BEFORE UPDATE OR DELETE ON runtime_delivery_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_delivery_outcomes TO :app_role;

CREATE TRIGGER runtime_import_lineage_immutable BEFORE UPDATE OR DELETE ON runtime_import_lineage
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_import_lineage TO :app_role;

GRANT SELECT, INSERT, UPDATE (snapshot_hash, target_version) ON parent_targets TO :app_role;
