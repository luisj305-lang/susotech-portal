-- Decorative PDF line (tramo) annotations for the versioned PDF workflow.
-- Lines are pure visual markers: the code quantity in feet already prices the
-- segment, so lines carry no catalog, quantity, allocation, or archive impact.
-- They persist on the draft and render onto the delivered PDF.

alter table public.job_pdf_drafts
  add column if not exists lines jsonb not null default '[]'::jsonb;
alter table public.job_pdf_drafts
  drop constraint if exists job_pdf_drafts_lines_array_check;
alter table public.job_pdf_drafts
  add constraint job_pdf_drafts_lines_array_check
  check (jsonb_typeof(lines) = 'array');

create or replace function public.validate_job_pdf_lines(
  p_job_id uuid,
  p_source_document_ids uuid[],
  p_page_count integer,
  p_lines jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item jsonb;
  point jsonb;
  expected_page integer;
begin
  if jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) > 100
  then raise exception 'Invalid PDF lines'; end if;

  for item in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array['page','sourceDocumentId','sourcePage','points','color'])
      or (select count(*)
        from jsonb_object_keys(item) as line_keys(line_key)
        where line_key not in ('page','sourceDocumentId','sourcePage','points','color')) <> 0
      or jsonb_typeof(item->'page') <> 'number'
      or jsonb_typeof(item->'sourceDocumentId') <> 'string'
      or jsonb_typeof(item->'sourcePage') <> 'number'
      or jsonb_typeof(item->'points') <> 'array'
      or jsonb_typeof(item->'color') <> 'string'
      or jsonb_array_length(item->'points') < 2
      or jsonb_array_length(item->'points') > 50
      or (item->>'sourceDocumentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'sourcePage')::numeric <> trunc((item->>'sourcePage')::numeric)
      or (item->>'page')::integer not between 1 and p_page_count
      or (item->>'color') not in ('#dc2626','#d946ef','#eab308','#000000','#f97316','#2563eb')
    then raise exception 'Invalid PDF line'; end if;

    for point in select value from jsonb_array_elements(item->'points') loop
      if jsonb_typeof(point) <> 'object'
        or not (point ?& array['x','y'])
        or (select count(*)
          from jsonb_object_keys(point) as point_keys(point_key)
          where point_key not in ('x','y')) <> 0
        or jsonb_typeof(point->'x') <> 'number'
        or jsonb_typeof(point->'y') <> 'number'
        or (point->>'x')::numeric not between 0 and 1
        or (point->>'y')::numeric not between 0 and 1
      then raise exception 'Invalid PDF line point'; end if;
    end loop;

    if not ((item->>'sourceDocumentId')::uuid = any(coalesce(p_source_document_ids, '{}'::uuid[])))
    then raise exception 'Invalid PDF line document lineage'; end if;

    select coalesce(sum(previous.page_count), 0)::integer + (item->>'sourcePage')::integer
    into expected_page
    from public.job_documents selected
    left join public.job_documents previous
      on previous.job_id = selected.job_id
      and previous.status = 'active' and previous.deleted_at is null
      and previous.position < selected.position
    where selected.id = (item->>'sourceDocumentId')::uuid
      and selected.job_id = p_job_id
      and selected.status = 'active' and selected.deleted_at is null
      and selected.page_count is not null
      and (item->>'sourcePage')::integer between 1 and selected.page_count
    group by selected.id;
    if expected_page is null or expected_page <> (item->>'page')::integer
    then raise exception 'Invalid PDF line page lineage'; end if;
  end loop;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid PDF line';
end;
$$;

create or replace function public.initialize_job_pdf_draft_v4(
  p_job_id uuid,
  p_source_document_ids uuid[],
  p_page_count integer
)
returns table(
  version integer,
  source_page_count integer,
  placements jsonb,
  text_notes jsonb,
  lines jsonb,
  source_document_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid())
  then raise exception 'Job unavailable'; end if;
  perform public.initialize_job_pdf_draft_v3(
    p_job_id, p_source_document_ids, p_page_count
  );
  return query
  select d.version, d.source_page_count, d.placements, d.text_notes, d.lines,
    d.source_document_ids
  from public.job_pdf_drafts d where d.job_id = p_job_id;
end;
$$;

create or replace function public.save_job_pdf_draft_v4(
  p_job_id uuid,
  p_expected_version integer,
  p_placements jsonb,
  p_text_notes jsonb,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.job_pdf_drafts%rowtype;
  result_version integer;
begin
  if not public.can_mutate_job(p_job_id, auth.uid())
  then raise exception 'Job unavailable'; end if;
  select * into draft from public.job_pdf_drafts
  where job_id = p_job_id for update;
  if draft.job_id is null or draft.version <> p_expected_version
  then raise exception 'Draft version conflict'; end if;
  perform public.validate_job_pdf_lines(
    p_job_id, draft.source_document_ids, draft.source_page_count, p_lines
  );
  result_version := public.save_job_pdf_draft_v3(
    p_job_id, p_expected_version, p_placements, p_text_notes
  );
  update public.job_pdf_drafts
  set lines = p_lines
  where job_id = p_job_id and version = result_version;
  if not found then raise exception 'Draft version conflict'; end if;
  return result_version;
end;
$$;

revoke all on function public.validate_job_pdf_lines(uuid, uuid[], integer, jsonb) from public;
revoke all on function public.initialize_job_pdf_draft_v4(uuid, uuid[], integer) from public;
revoke all on function public.save_job_pdf_draft_v4(uuid, integer, jsonb, jsonb, jsonb) from public;
grant execute on function public.validate_job_pdf_lines(uuid, uuid[], integer, jsonb) to authenticated;
grant execute on function public.initialize_job_pdf_draft_v4(uuid, uuid[], integer) to authenticated;
grant execute on function public.save_job_pdf_draft_v4(uuid, integer, jsonb, jsonb, jsonb) to authenticated;
