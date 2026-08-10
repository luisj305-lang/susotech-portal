-- Directorio mínimo de técnicos para gestión de equipos por personal de oficina.

create or replace function public.list_active_technicians_for_office()
returns table (id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_office_staff(auth.uid()) then
    raise exception 'Only active office staff can list technicians' using errcode = '42501';
  end if;
  return query select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email) as label
  from public.profiles p
  where p.role = 'tecnico'
    and p.is_active
  order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.id;
end;
$$;

revoke all on function public.list_active_technicians_for_office() from public;
grant execute on function public.list_active_technicians_for_office() to authenticated;
