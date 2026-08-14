-- Qualify columns that collide with RETURNS TABLE output-variable names.

create or replace function public.confirm_delivered_job_pdf_with_allocations_v3(
  p_job_id uuid, p_storage_path text, p_source_photo_ids uuid[],
  p_source_document_ids uuid[], p_submit boolean,
  p_expected_draft_version integer, p_snapshot_hash text,
  p_text_note_snapshot jsonb, p_allocations jsonb,
  p_allocation_idempotency_key uuid
)
returns table(previous_storage_path text, delivered_status public.job_status,
  delivery_id uuid, allocation_version_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare
  draft public.job_pdf_drafts%rowtype;
  confirmed record;
  item jsonb;
  stored_snapshot jsonb;
  annotation_count integer;
  expected_annotation_count integer := jsonb_array_length(p_text_note_snapshot);
begin
  if not public.can_mutate_job(p_job_id, auth.uid())
    or (p_submit and not public.is_operational_worker(auth.uid()))
  then raise exception 'Job unavailable'; end if;

  select d.* into draft from public.job_pdf_drafts d
  where d.job_id = p_job_id for update;
  if draft.job_id is null or draft.version <> p_expected_draft_version
  then raise exception 'Draft version conflict'; end if;
  perform public.validate_job_pdf_text_notes(
    p_job_id, draft.source_document_ids, draft.source_page_count,
    p_text_note_snapshot
  );
  if draft.text_notes is distinct from p_text_note_snapshot
  then raise exception 'Text note snapshot changed'; end if;

  select result.* into confirmed
  from public.confirm_delivered_job_pdf_with_allocations(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash,
    p_allocations, p_allocation_idempotency_key
  ) result;

  select deliveries.text_note_snapshot into stored_snapshot
  from public.job_deliveries deliveries
  where deliveries.id = confirmed.delivery_id
    and deliveries.job_id = p_job_id
  for update;
  if not found then raise exception 'Delivery unavailable'; end if;
  if stored_snapshot <> '[]'::jsonb
    and stored_snapshot is distinct from p_text_note_snapshot
  then raise exception 'Delivered text note snapshot is immutable'; end if;
  if stored_snapshot = '[]'::jsonb then
    update public.job_deliveries deliveries
    set text_note_snapshot = p_text_note_snapshot
    where deliveries.id = confirmed.delivery_id
      and deliveries.job_id = p_job_id;
  end if;

  select count(*)::integer into annotation_count
  from public.job_pdf_text_annotations annotations
  where annotations.delivery_id = confirmed.delivery_id;
  if annotation_count > 0 then
    if annotation_count <> expected_annotation_count
    then raise exception 'Delivered text note annotations are inconsistent'; end if;
    return query select confirmed.previous_storage_path,
      confirmed.delivered_status, confirmed.delivery_id,
      confirmed.allocation_version_id;
    return;
  end if;

  for item in select notes.value
    from jsonb_array_elements(p_text_note_snapshot) notes(value)
  loop
    insert into public.job_pdf_text_annotations(
      delivery_id, job_id, draft_version, source_document_id, page,
      source_page, text, box_x, box_y, box_width, box_height,
      font_size_ratio, created_by
    ) values (
      confirmed.delivery_id, p_job_id, p_expected_draft_version,
      (item->>'sourceDocumentId')::uuid, (item->>'page')::integer,
      (item->>'sourcePage')::integer, item->>'text',
      (item->>'x')::numeric, (item->>'y')::numeric,
      (item->>'width')::numeric, (item->>'height')::numeric,
      (item->>'fontSizeRatio')::numeric, auth.uid()
    );
  end loop;

  return query select confirmed.previous_storage_path,
    confirmed.delivered_status, confirmed.delivery_id,
    confirmed.allocation_version_id;
end;
$$;

revoke all on function public.confirm_delivered_job_pdf_with_allocations_v3(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, jsonb, uuid) from public;
grant execute on function public.confirm_delivered_job_pdf_with_allocations_v3(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb, jsonb, uuid) to authenticated;
