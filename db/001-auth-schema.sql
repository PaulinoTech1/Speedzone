-- SEcure_Auth (Neon project shy-sunset-14721124)
-- Authoritative schema for every server-side authentication record.
--
-- This database serves exactly one human being: the administrator named by
-- ADMIN_ID. It stores the FIDO2/WebAuthn credentials that authenticate that one
-- person, and nothing else. Every statement below is idempotent, so re-running
-- `npm run migrate:auth-db` is always safe.
--
-- The application never issues DDL: a missing table fails closed as a
-- configuration error instead of being created from a request path.

-- The complete administrator record. Exactly one row can ever exist, and the
-- `revision` column is the compare-and-swap key that serialises concurrent
-- mutations across every serverless instance.
CREATE TABLE IF NOT EXISTS auth_state (
  id          smallint    NOT NULL,
  revision    bigint      NOT NULL,
  state       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_state_pkey PRIMARY KEY (id)
);

-- One-time markers that make a WebAuthn ceremony, step-up assertion, recovery
-- code, or bootstrap token unreplayable. The primary key is the single-use
-- guarantee: a second INSERT for the same digest cannot succeed.
CREATE TABLE IF NOT EXISTS auth_consume_markers (
  namespace   text        NOT NULL,
  digest      text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_consume_markers_pkey PRIMARY KEY (namespace, digest)
);

-- Supports the bounded sweep of already-expired markers.
CREATE INDEX IF NOT EXISTS auth_consume_markers_expires_at_idx
  ON auth_consume_markers (expires_at);

-- Constraints are dropped and re-added so this file converges an existing table
-- onto the current rules, not only a freshly created one. CHECK expressions use
-- CASE throughout: Postgres does not guarantee short-circuit evaluation of AND,
-- so a type guard must sequence its own dependent expression.

-- Only one administrator can exist, because only one row can exist.
ALTER TABLE auth_state DROP CONSTRAINT IF EXISTS auth_state_singleton;
ALTER TABLE auth_state ADD CONSTRAINT auth_state_singleton CHECK (id = 1);

-- The compare-and-swap column must agree with the record it guards.
ALTER TABLE auth_state DROP CONSTRAINT IF EXISTS auth_state_revision_matches;
ALTER TABLE auth_state ADD CONSTRAINT auth_state_revision_matches CHECK (
  CASE
    WHEN revision < 0 THEN false
    WHEN state ->> 'revision' ~ '^[0-9]+$' THEN revision = (state ->> 'revision')::bigint
    ELSE false
  END
);

ALTER TABLE auth_state DROP CONSTRAINT IF EXISTS auth_state_schema_version;
ALTER TABLE auth_state ADD CONSTRAINT auth_state_schema_version
  CHECK (state ->> 'schemaVersion' = '2');

-- The single-administrator invariant, enforced by the database itself rather
-- than only by application validation. An ACTIVE record must name exactly one
-- administrator and hold at least one passkey and one recovery code; a record
-- that has not been enrolled yet must hold neither. Direct SQL access cannot
-- produce an activated account with no credential, or with none named.
ALTER TABLE auth_state DROP CONSTRAINT IF EXISTS auth_state_single_administrator;
ALTER TABLE auth_state ADD CONSTRAINT auth_state_single_administrator CHECK (
  CASE
    WHEN jsonb_typeof(state -> 'passkeys') <> 'array' THEN false
    WHEN jsonb_typeof(state -> 'recoveryCodeHashes') <> 'array' THEN false
    WHEN jsonb_typeof(state -> 'revokedSessionHashes') <> 'array' THEN false
    WHEN jsonb_array_length(state -> 'passkeys') > 20 THEN false
    WHEN jsonb_array_length(state -> 'recoveryCodeHashes') > 10 THEN false
    WHEN state ->> 'state' IN ('ACTIVE', 'RECOVERY') THEN
      coalesce(state ->> 'administratorUserId', '') <> ''
      AND jsonb_array_length(state -> 'passkeys') > 0
      AND jsonb_array_length(state -> 'recoveryCodeHashes') > 0
    WHEN state ->> 'state' = 'BOOTSTRAP_READY' THEN
      jsonb_array_length(state -> 'passkeys') = 0
      AND jsonb_array_length(state -> 'recoveryCodeHashes') = 0
    WHEN state ->> 'state' = 'UNCONFIGURED' THEN
      coalesce(state ->> 'administratorUserId', '') = ''
      AND jsonb_array_length(state -> 'passkeys') = 0
      AND jsonb_array_length(state -> 'recoveryCodeHashes') = 0
    ELSE false
  END
);

ALTER TABLE auth_consume_markers DROP CONSTRAINT IF EXISTS auth_consume_markers_namespace;
ALTER TABLE auth_consume_markers ADD CONSTRAINT auth_consume_markers_namespace
  CHECK (namespace IN ('challenge', 'recovery', 'bootstrap', 'stepup'));

ALTER TABLE auth_consume_markers DROP CONSTRAINT IF EXISTS auth_consume_markers_digest;
ALTER TABLE auth_consume_markers ADD CONSTRAINT auth_consume_markers_digest
  CHECK (digest ~ '^[0-9a-f]{64}$');
