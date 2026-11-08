ALTER TABLE accounts
ADD COLUMN control_mode TEXT
CHECK (control_mode IN ('keyboard-only', 'keyboard-mouse'));
