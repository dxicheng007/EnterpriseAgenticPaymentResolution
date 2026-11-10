CREATE INDEX runtime_activation_imports_source_account_idx
  ON runtime_activation_imports USING btree (capture_source_ref, account_id);
