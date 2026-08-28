const key = Buffer.alloc(32, 7).toString("base64url");

process.env.ADMIN_ID = "administrator";
process.env.ADMIN_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$Wk3qEdNJbYtIkXeZ7mzAZzzlFKEp5O6whzDXUu52GtE";
process.env.ADMIN_BOOTSTRAP_TOKEN_HASH =
  "a5dc7e4d521860daf367fdf53cf4b603f17ea47d8ad144425c120dfe682c0556";
process.env.AUTH_COOKIE_SECRET = Buffer.alloc(32, 11).toString("base64url");
process.env.AUTH_ENCRYPTION_KEY = key;
process.env.AUTH_SIGNING_KEY = Buffer.alloc(32, 8).toString("base64url");
process.env.AUTH_HASH_KEY = Buffer.alloc(32, 9).toString("base64url");
process.env.RECOVERY_CODE_PEPPER = Buffer.alloc(32, 10).toString("base64url");
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_RP_NAME = "SpeedZone Motorsports Test";
process.env.WEBAUTHN_EXPECTED_ORIGIN = "http://localhost:4173";
process.env.WEBAUTHN_ALLOWED_ORIGINS = "http://localhost:4173";
process.env.ALLOW_INSECURE_WEBAUTHN_TEST_ORIGIN = "true";
delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
delete process.env.AUTH_DATABASE_URL;
delete process.env.DATABASE_URL;
delete process.env.AUTH_GLOBAL_CONFIG;
delete process.env.SANITY_PROJECT_ID;
delete process.env.SANITY_DATASET;
delete process.env.SANITY_API_TOKEN;
