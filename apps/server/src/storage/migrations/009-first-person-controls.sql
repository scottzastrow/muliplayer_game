ALTER TABLE accounts RENAME COLUMN control_mode TO previous_control_mode;
ALTER TABLE accounts
ADD COLUMN control_mode TEXT
CHECK (control_mode IN ('keyboard-only', 'keyboard-mouse', 'first-person'));
UPDATE accounts SET control_mode = previous_control_mode;
ALTER TABLE accounts DROP COLUMN previous_control_mode;
