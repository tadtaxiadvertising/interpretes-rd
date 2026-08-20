-- Ensure the owner account cannot be downgraded by self-healing auth syncs.
-- This repairs existing rows; application code also protects future logins/syncs.
UPDATE public.user_profiles
SET role = 'admin', interpreter_id = NULL
WHERE lower(trim(email)) = 'interpretersfree@gmail.com';

UPDATE public.rbac_users
SET role = 'ADMIN', "updatedAt" = now()
WHERE lower(trim(email)) = 'interpretersfree@gmail.com';
