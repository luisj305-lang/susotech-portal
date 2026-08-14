-- Submitting a delivery remains operational-worker-only. Regeneration keeps the
-- existing office workflow enforced by the underlying delivery RPC.
create or replace function public.confirm_delivered_job_pdf_with_allocations(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text,
  p_allocations jsonb, p_allocation_idempotency_key uuid
)
returns table(previous_storage_path text, delivered_status public.job_status, delivery_id uuid, allocation_version_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  confirmed record;
  existing public.job_deliveries%rowtype;
  previous_path text;
  allocation_id uuid;
begin
  if not public.can_mutate_job(p_job_id, actor)
    or (p_submit and not public.is_operational_worker(actor))
  then
    raise exception 'Job unavailable';
  end if;
  if p_submit and (p_allocation_idempotency_key is null or jsonb_typeof(p_allocations) <> 'array') then
    raise exception 'A valid financial allocation is required for delivery';
  end if;

  select * into existing from public.job_deliveries where storage_path = p_storage_path;
  if existing.id is not null then
    if not p_submit or not existing.submitted or existing.superseded_at is not null
      or existing.job_id <> p_job_id or existing.delivered_by is distinct from actor
    then raise exception 'Delivery idempotency conflict'; end if;
    select d.storage_path into previous_path from public.job_deliveries d where d.id = existing.replaces_delivery_id;
    allocation_id := public.create_delivery_allocation_version_internal(
      existing.id, 0, p_allocations, p_allocation_idempotency_key, 'Initial delivery allocation'
    );
    return query select previous_path, 'enviado_revision'::public.job_status, existing.id, allocation_id;
    return;
  end if;

  select * into confirmed from public.confirm_delivered_job_pdf_complete_before_allocations(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash
  );
  if p_submit then
    allocation_id := public.create_delivery_allocation_version_internal(
      confirmed.delivery_id, 0, p_allocations, p_allocation_idempotency_key,
      'Initial delivery allocation'
    );
  end if;
  return query select confirmed.previous_storage_path, confirmed.delivered_status,
    confirmed.delivery_id, allocation_id;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf_with_allocations(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, uuid) from public;
grant execute on function public.confirm_delivered_job_pdf_with_allocations(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, uuid) to authenticated;
