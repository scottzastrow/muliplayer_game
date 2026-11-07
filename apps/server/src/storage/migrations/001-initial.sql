CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL CHECK (length(username) BETWEEN 3 AND 24),
  normalized_username TEXT NOT NULL UNIQUE CHECK (length(normalized_username) BETWEEN 3 AND 24),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'operator')),
  created_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  token_digest TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX auth_sessions_account_id_idx ON auth_sessions(account_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE theme_revisions (
  theme_id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  module_id TEXT NOT NULL,
  module_version TEXT NOT NULL,
  renderer_id TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  engine_api_major INTEGER NOT NULL CHECK (engine_api_major = 1),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  asset_root TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (theme_id, version)
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY NOT NULL,
  creator_account_id TEXT NOT NULL REFERENCES accounts(id),
  state TEXT NOT NULL CHECK (
    state IN ('waiting', 'running', 'finished', 'abandoned', 'interrupted', 'failed')
  ),
  settings_json TEXT NOT NULL,
  theme_digest TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  seed INTEGER NOT NULL,
  current_level INTEGER NOT NULL DEFAULT 1 CHECK (current_level > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX matches_state_idx ON matches(state);

CREATE TABLE match_participants (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  joined_order INTEGER NOT NULL CHECK (joined_order >= 0),
  final_points INTEGER NOT NULL DEFAULT 0 CHECK (final_points >= 0),
  final_kills INTEGER NOT NULL DEFAULT 0 CHECK (final_kills >= 0),
  final_deaths INTEGER NOT NULL DEFAULT 0 CHECK (final_deaths >= 0),
  final_rank INTEGER CHECK (final_rank IS NULL OR final_rank > 0),
  PRIMARY KEY (match_id, account_id),
  UNIQUE (match_id, joined_order)
);

CREATE TABLE match_results (
  id INTEGER PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('finished', 'abandoned', 'interrupted', 'failed')),
  final_level INTEGER NOT NULL CHECK (final_level > 0),
  standings_json TEXT NOT NULL DEFAULT '[]',
  settings_summary_json TEXT NOT NULL,
  theme_digest TEXT NOT NULL,
  finalized_at TEXT NOT NULL
);
