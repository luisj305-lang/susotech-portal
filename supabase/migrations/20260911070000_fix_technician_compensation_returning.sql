-- Fix the applied compensation RPC's ambiguous RETURNING identifiers.
-- RETURNS TABLE creates PL/pgSQL output variables named technician_id, mode,
-- and hourly_rate_cents, so the INSERT output must qualify the table columns.

create or replace function public.set_technician_compensation(
  p_technician_id uuid,
  p_mode text,
  p_hourly_rate_cents bigint
)
returns table(
  technician_id uuid,
  mode text,
  hourly_rate_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  v_rate bigint := null;
begin
  if not public.is_admin(actor) then
    raise exception 'Admin access required';
  end if;

  if p_mode not in ('percentage', 'hourly') then
    raise exception 'Invalid compensation mode';
  end if;

  if p_mode = 'hourly' and coalesce(p_hourly_rate_cents, 0) <= 0 then
    raise exception 'Hourly rate required';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_technician_id and p.role = 'tecnico' and p.is_active
  ) then
    raise exception 'Active technician required';
  end if;

  v_rate := case when p_mode = 'hourly' then p_hourly_rate_cents else null end;

  return query
  insert into public.technician_compensation_settings as settings (
    technician_id, mode, hourly_rate_cents, changed_by, changed_at
  ) values (
    p_technician_id, p_mode, v_rate, actor, now()
  )
  on conflict (technician_id)
  do update set
    mode = excluded.mode,
    hourly_rate_cents = excluded.hourly_rate_cents,
    changed_by = excluded.changed_by,
    changed_at = excluded.changed_at
  returning
    settings.technician_id,
    settings.mode,
    settings.hourly_rate_cents;
end;
$$;

comment on function public.set_technician_compensation(uuid, text, bigint) is
  'Configures a technician''s pay mode (percentage or hourly) and hourly rate. Percentage mode stores a null rate. Admin only.';
