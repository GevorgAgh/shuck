-- 002_sessions.sql — server-side sessions behind the httpOnly cookie.
-- This is the one table added on top of the ten in the brief: it lets logout
-- really end a session. Only a SHA-256 hash of the cookie token is stored.

CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,        -- sha256(token), hex
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL
) STRICT;
CREATE INDEX idx_sessions_user ON sessions (user_id);
