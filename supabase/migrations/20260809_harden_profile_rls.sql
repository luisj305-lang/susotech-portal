-- Harden RLS policies for public.profiles
-- Drop existing policies to replace them with stricter versions.

drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can update profiles" on public.profiles;

-- Active users can read their own profile.
create policy "Active users can view own profile"
on public.profiles for select
to authenticated
using (auth.uid() = id and is_active);

-- Admins can read any profile, including inactive ones.
create policy "Admins can view all profiles"
on public.profiles for select
to authenticated
using (public.is_admin());

-- Only admins can update profiles.
create policy "Admins can update profiles"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Only admins can delete profiles.
create policy "Admins can delete profiles"
on public.profiles for delete
to authenticated
using (public.is_admin());

-- Only admins can insert profiles directly.
-- Trigger on_auth_user_created still works because it runs with security definer.
create policy "Admins can insert profiles"
on public.profiles for insert
to authenticated
with check (public.is_admin());
