-- Least-privilege grants for the SEcure_Auth runtime role.
--
-- Create the role itself in the Neon console so its password never lands in a
-- file or a shell history, then apply these grants with:
--   npm run migrate:auth-db -- --grant-role speedzone_auth_app
--
-- The runtime role may read and write the two authentication tables and nothing
-- else. It holds no CREATE right, so a leaked AUTH_DATABASE_URL cannot reshape
-- the schema, drop the constraints that enforce a single administrator, or add
-- a table of its own. Keep a separate, more privileged role for migrations.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON auth_state FROM PUBLIC;
REVOKE ALL ON auth_consume_markers FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO :app_role;
REVOKE CREATE ON SCHEMA public FROM :app_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_state TO :app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_consume_markers TO :app_role;
