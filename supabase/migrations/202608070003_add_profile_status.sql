alter table public.profiles
add column is_active boolean not null default true;

create index profiles_role_active_idx
on public.profiles (role, is_active);

create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user_id
      and role = 'admin'
      and is_active
  );
$$;
