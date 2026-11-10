-- Ongoing sync receipts. Initial import tables stay untouched; records remain globally unique in parent_financial_records.

CREATE TABLE runtime_sync_receipts (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  receipt_id TEXT PRIMARY KEY CHECK (receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  plan_hash TEXT NOT NULL CHECK (plan_hash ~ '^[0-9a-f]{64}$'),
  activation_id TEXT NOT NULL,
  epoch BIGINT NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  before_version BIGINT NOT NULL CHECK (before_version BETWEEN 0 AND 9007199254740991),
  after_version BIGINT NOT NULL CHECK (after_version = before_version + 1),
  after_snapshot_hash TEXT NOT NULL CHECK (after_snapshot_hash ~ '^[0-9a-f]{64}$'),
  receipt TEXT NOT NULL CHECK (receipt IS JSON OBJECT),
  receipt_digest TEXT NOT NULL CHECK (receipt_digest ~ '^[0-9a-f]{64}$'),
  plan TEXT NOT NULL CHECK (plan IS JSON OBJECT),
  plan_digest TEXT NOT NULL CHECK (plan_digest ~ '^[0-9a-f]{64}$'),
  UNIQUE (account_id, plan_hash),
  UNIQUE (account_id, after_version),
  UNIQUE (account_id, company_id, seller_entity_id, receipt_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id) REFERENCES parent_scopes (account_id, company_id, seller_entity_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, after_snapshot_hash, after_version)
    REFERENCES parent_snapshots (account_id, company_id, seller_entity_id, snapshot_hash, target_version),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{id}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{id}') IS NOT DISTINCT FROM receipt_id),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{planHash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{planHash}') IS NOT DISTINCT FROM plan_hash),
  CHECK (jsonb_typeof(parent_index_projection(receipt) #> '{scope,accountId}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(receipt) #>> '{scope,accountId}') IS NOT DISTINCT FROM account_id),
  CHECK (jsonb_typeof(parent_index_projection(plan) #> '{hash}') IS NOT DISTINCT FROM 'string' AND (parent_index_projection(plan) #>> '{hash}') IS NOT DISTINCT FROM plan_hash),
  CHECK (parent_index_projection(receipt)->>'status' IS NOT DISTINCT FROM 'applied')
);

CREATE TABLE runtime_sync_economic_outcomes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  record_id TEXT PRIMARY KEY REFERENCES parent_financial_records (record_id),
  receipt_id TEXT NOT NULL,
  FOREIGN KEY (account_id, company_id, seller_entity_id, receipt_id)
    REFERENCES runtime_sync_receipts (account_id, company_id, seller_entity_id, receipt_id)
);

CREATE TABLE runtime_sync_delivery_outcomes (
  account_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  seller_entity_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  event_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (source_ref, event_id),
  FOREIGN KEY (source_ref, event_id) REFERENCES runtime_deliveries (source_ref, event_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, receipt_id)
    REFERENCES runtime_sync_receipts (account_id, company_id, seller_entity_id, receipt_id)
);

CREATE TRIGGER runtime_sync_receipts_immutable BEFORE UPDATE OR DELETE ON runtime_sync_receipts
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_sync_economic_outcomes_immutable BEFORE UPDATE OR DELETE ON runtime_sync_economic_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
CREATE TRIGGER runtime_sync_delivery_outcomes_immutable BEFORE UPDATE OR DELETE ON runtime_sync_delivery_outcomes
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();
GRANT SELECT, INSERT ON runtime_sync_receipts, runtime_sync_economic_outcomes, runtime_sync_delivery_outcomes TO :app_role;
