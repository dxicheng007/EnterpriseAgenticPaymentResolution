-- Current authority is retained separately from the immutable initial import.
CREATE TABLE runtime_authority_heads (
  account_id TEXT PRIMARY KEY CHECK (account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  company_id TEXT NOT NULL CHECK (company_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  seller_entity_id TEXT NOT NULL CHECK (seller_entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  initial_import_key TEXT NOT NULL CHECK (initial_import_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  initial_receipt_id TEXT NOT NULL CHECK (initial_receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  grant_canonical TEXT NOT NULL CHECK (grant_canonical IS JSON OBJECT),
  grant_digest TEXT NOT NULL CHECK (grant_digest ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
  epoch BIGINT NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
  changed_at TEXT NOT NULL CHECK (changed_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'),
  UNIQUE (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id),
  FOREIGN KEY (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id)
    REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (parent_index_projection(grant_canonical) #> '{identity,scope}' IS NOT DISTINCT FROM
    jsonb_build_object('accountId', account_id, 'companyId', company_id, 'sellerEntityId', seller_entity_id)),
  CHECK (parent_index_projection(grant_canonical)->'status' IS NOT DISTINCT FROM '"active"'::jsonb),
  CHECK (parent_index_projection(grant_canonical)->'epoch' IS NOT DISTINCT FROM '1'::jsonb),
  CHECK (COALESCE(jsonb_typeof(parent_index_projection(grant_canonical)->'changedAt') = 'string'
    AND parent_index_projection(grant_canonical)->>'changedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$', FALSE))
);

CREATE TABLE runtime_authority_commands (
  account_id TEXT NOT NULL CHECK (account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  company_id TEXT NOT NULL CHECK (company_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  seller_entity_id TEXT NOT NULL CHECK (seller_entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  initial_import_key TEXT NOT NULL CHECK (initial_import_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  initial_receipt_id TEXT NOT NULL CHECK (initial_receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  reviewer_id TEXT NOT NULL CHECK (reviewer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'),
  binding_digest TEXT NOT NULL CHECK (binding_digest ~ '^[0-9a-f]{64}$'),
  command_canonical TEXT NOT NULL CHECK (command_canonical IS JSON OBJECT),
  command_digest TEXT NOT NULL CHECK (command_digest ~ '^[0-9a-f]{64}$'),
  reviewer_canonical TEXT NOT NULL CHECK (reviewer_canonical IS JSON OBJECT),
  reviewer_digest TEXT NOT NULL CHECK (reviewer_digest ~ '^[0-9a-f]{64}$'),
  result_canonical TEXT NOT NULL CHECK (result_canonical IS JSON OBJECT),
  result_digest TEXT NOT NULL CHECK (result_digest ~ '^[0-9a-f]{64}$'),
  resume_canonical TEXT CHECK (resume_canonical IS JSON OBJECT),
  resume_digest TEXT CHECK (resume_digest ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (account_id, idempotency_key),
  FOREIGN KEY (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id)
    REFERENCES runtime_activation_imports (account_id, company_id, seller_entity_id, idempotency_key, receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id)
    REFERENCES runtime_authority_heads (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (parent_index_projection(command_canonical) #> '{identity,scope}' IS NOT DISTINCT FROM
    jsonb_build_object('accountId', account_id, 'companyId', company_id, 'sellerEntityId', seller_entity_id)),
  CHECK (parent_index_projection(result_canonical) #> '{identity,scope}' IS NOT DISTINCT FROM
    jsonb_build_object('accountId', account_id, 'companyId', company_id, 'sellerEntityId', seller_entity_id)),
  CHECK (parent_index_projection(command_canonical)->'idempotencyKey' IS NOT DISTINCT FROM to_jsonb(idempotency_key)),
  CHECK (parent_index_projection(result_canonical)->'idempotencyKey' IS NOT DISTINCT FROM to_jsonb(idempotency_key)),
  CHECK (parent_index_projection(reviewer_canonical)->'reviewerId' IS NOT DISTINCT FROM to_jsonb(reviewer_id)),
  CHECK (CASE WHEN jsonb_typeof(parent_index_projection(result_canonical)->'beforeEpoch') = 'number'
    AND jsonb_typeof(parent_index_projection(result_canonical) #> '{state,epoch}') = 'number'
    THEN (parent_index_projection(result_canonical)->>'beforeEpoch') ~ '^[1-9][0-9]*$'
      AND (parent_index_projection(result_canonical) #>> '{state,epoch}') ~ '^[1-9][0-9]*$'
      AND (parent_index_projection(result_canonical)->>'beforeEpoch')::numeric BETWEEN 1 AND 9007199254740991
      AND (parent_index_projection(result_canonical) #>> '{state,epoch}')::numeric BETWEEN 1 AND 9007199254740991
    ELSE FALSE END),
  CHECK ((resume_canonical IS NULL) = (resume_digest IS NULL)),
  CHECK ((resume_canonical IS NOT NULL) = (
    parent_index_projection(result_canonical)->'action' IS NOT DISTINCT FROM '"resume"'::jsonb AND
    parent_index_projection(result_canonical)->'beforeStatus' IS NOT DISTINCT FROM '"paused"'::jsonb AND
    parent_index_projection(result_canonical) #> '{state,status}' IS NOT DISTINCT FROM '"active"'::jsonb AND
    parent_index_projection(result_canonical)->'changed' IS NOT DISTINCT FROM 'true'::jsonb
  ))
);

CREATE FUNCTION guard_runtime_authority_head() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Current authority must be retained' USING ERRCODE = '23514';
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.epoch <> 1 OR NEW.status <> 'active'
       OR NEW.changed_at IS DISTINCT FROM parent_index_projection(NEW.grant_canonical)->>'changedAt' THEN
      RAISE EXCEPTION 'Invalid initial authority state' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (NEW.account_id, NEW.company_id, NEW.seller_entity_id, NEW.initial_import_key, NEW.initial_receipt_id,
        NEW.grant_canonical, NEW.grant_digest) IS DISTINCT FROM
       (OLD.account_id, OLD.company_id, OLD.seller_entity_id, OLD.initial_import_key, OLD.initial_receipt_id,
        OLD.grant_canonical, OLD.grant_digest) THEN
      RAISE EXCEPTION 'Initial authority is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = OLD.status THEN
      IF (NEW.epoch, NEW.changed_at) IS DISTINCT FROM (OLD.epoch, OLD.changed_at) THEN
        RAISE EXCEPTION 'Unchanged authority must retain its epoch and time' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.epoch <> OLD.epoch + 1 OR NOT (
      (OLD.status = 'active' AND NEW.status IN ('paused', 'revoked')) OR
      (OLD.status = 'paused' AND NEW.status IN ('active', 'revoked'))
    ) THEN
      RAISE EXCEPTION 'Invalid authority transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER runtime_authority_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON runtime_authority_heads
FOR EACH ROW EXECUTE FUNCTION guard_runtime_authority_head();
CREATE TRIGGER runtime_authority_commands_immutable BEFORE UPDATE OR DELETE ON runtime_authority_commands
FOR EACH ROW EXECUTE FUNCTION reject_parent_history_mutation();

GRANT SELECT, INSERT ON runtime_authority_heads, runtime_authority_commands TO :app_role;
GRANT UPDATE (status, epoch, changed_at) ON runtime_authority_heads TO :app_role;
