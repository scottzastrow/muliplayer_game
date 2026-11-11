INSERT OR IGNORE INTO theme_revisions
  (theme_id, version, name, module_id, module_version, renderer_id, renderer_version,
   engine_api_major, digest, asset_root, enabled, created_at)
VALUES
  ('fixture', '1.0.0', 'Fleeing Squares', 'fixture', '1.0.0', 'fixture', '1.0.0',
   1, '38f936869be07257e46dfe6e273c36add4d5b6d9eca502612d622920c8b6f89c',
   'builtin:fixture@1.0.0', 1, '2026-01-01T00:00:00.000Z');
