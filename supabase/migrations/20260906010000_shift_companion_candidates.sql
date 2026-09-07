-- Rank shift-start companion candidates by how often the current technician has
-- recorded each one, so the start-shift form can surface the two most-used
-- companions while still offering the full directory behind an extra toggle.
-- Companions are personal history (recorded_by), never a global popularity vote.

create or replace function public.list_shift_companion_candidates()
returns table(id uuid, label text, usage_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_worker(auth.uid()) then
    raise exception 'Operational worker required';
  end if;
  return query
  select p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    coalesce(u.usage_count, 0) as usage_count
  from public.profiles p
  left join lateral (
    select count(*) as usage_count
    from public.technician_shift_companions c
    where c.technician_id = p.id
      and c.recorded_by = auth.uid()
  ) u on true
  where p.role = 'tecnico' and p.is_active
    and p.worker_specialty in ('tecnico', 'splicer', 'liner', 'ayudante')
    and p.id <> auth.uid()
  order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.id;
end;
$$;

comment on function public.list_shift_companion_candidates() is
  'Active technician companions for the start-shift form, with each candidate''s usage count scoped to the current technician.';

revoke all on function public.list_shift_companion_candidates() from public;
grant execute on function public.list_shift_companion_candidates() to authenticated;
