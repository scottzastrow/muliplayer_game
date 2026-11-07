CREATE UNIQUE INDEX one_operator_account
ON accounts(role)
WHERE role = 'operator';
