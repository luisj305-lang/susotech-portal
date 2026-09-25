-- Add the read-only 'auditor' office role. Kept as its own migration so the
-- enum value is committed before any access rule references it.
alter type public.user_role add value if not exists 'auditor';
