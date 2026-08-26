-- Punto 3: agregar teléfono al perfil y exponerlo en list_profiles_for_office.
alter table public.profiles add column if not exists phone text;

drop function if exists public.list_profiles_for_office();
create function public.list_profiles_for_office()
returns table(
  id uuid, email text, full_name text, role public.user_role, is_active boolean,
  price_category_id uuid, price_category_name text, worker_specialty text,
  phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then raise exception 'Office access required'; end if;
  return query
  select p.id, p.email, p.full_name, p.role, p.is_active,
    pc.id, pc.name, p.worker_specialty, p.phone
  from public.profiles p
  left join public.price_categories pc on pc.id = p.price_category_id
  order by p.full_name nulls last, p.email, p.id;
end;
$$;

revoke all on function public.list_profiles_for_office() from public;
grant execute on function public.list_profiles_for_office() to authenticated;
