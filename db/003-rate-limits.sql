-- Deployment-wide fixed-window counters; no raw IPs or user agents are stored.
CREATE TABLE IF NOT EXISTS security_rate_buckets (
  bucket_key text PRIMARY KEY CHECK (bucket_key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS security_rate_buckets_expiry_idx ON security_rate_buckets (expires_at);
REVOKE ALL ON security_rate_buckets FROM PUBLIC;
