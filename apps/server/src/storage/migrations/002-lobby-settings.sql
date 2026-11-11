ALTER TABLE matches ADD COLUMN settings_revision INTEGER NOT NULL DEFAULT 0
  CHECK (settings_revision >= 0);
ALTER TABLE matches ADD COLUMN session_name TEXT NOT NULL DEFAULT 'Session'
  CHECK (length(session_name) BETWEEN 1 AND 64);

INSERT OR IGNORE INTO theme_revisions
  (theme_id, version, name, module_id, module_version, renderer_id, renderer_version,
   engine_api_major, digest, asset_root, enabled, created_at)
VALUES
  ('default', '1.0.0', 'Default', 'default', '1.0.0', 'default', '1.0.0',
   1, 'd89837b8b8c914986e5c01cf67766811bce504e9250ef2ce8cf862effb747473',
   'builtin:default@1.0.0', 1, '2026-01-01T00:00:00.000Z');
