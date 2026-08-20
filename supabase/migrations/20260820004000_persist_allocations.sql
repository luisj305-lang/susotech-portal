-- Punto 1: persistir la distribución de porcentajes del borrador para que no se pierda
-- cuando el técnico sale a cargar evidencia.
alter table public.job_pdf_drafts
  add column if not exists allocations jsonb not null default '[]'::jsonb
  check (jsonb_typeof(allocations) = 'array');

create or replace function public.save_job_pdf_allocations(
  p_job_id uuid,
  p_allocations jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
begin
  if not public.is_technician(actor) or not public.can_access_job(p_job_id, actor) then
    raise exception 'Job unavailable';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) > 100 then
    raise exception 'Invalid allocations';
  end if;
  for item in select value from jsonb_array_elements(p_allocations) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['participantId', 'percentage'])
      or (item->>'participantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'percentage') <> 'string'
      or (item->>'percentage')::numeric < 0
      or (item->>'percentage')::numeric > 100
    then raise exception 'Invalid allocation';
    end if;
  end loop;
  update public.job_pdf_drafts
  set allocations = p_allocations, updated_by = actor, updated_at = now()
  where job_id = p_job_id;
  if not found then raise exception 'Draft unavailable'; end if;
end;
$$;

revoke all on function public.save_job_pdf_allocations(uuid, jsonb) from public;
grant execute on function public.save_job_pdf_allocations(uuid, jsonb) to authenticated;
