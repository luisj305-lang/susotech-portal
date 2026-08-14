-- Additive text-note primitives for the versioned PDF workflow. Existing v2
-- RPCs, code placements and production snapshots remain unchanged.

alter table public.job_pdf_drafts
  add column if not exists text_notes jsonb not null default '[]'::jsonb;
alter table public.job_pdf_drafts
  drop constraint if exists job_pdf_drafts_text_notes_array_check;
alter table public.job_pdf_drafts
  add constraint job_pdf_drafts_text_notes_array_check
  check (jsonb_typeof(text_notes) = 'array');

alter table public.job_deliveries
  add column if not exists text_note_snapshot jsonb not null default '[]'::jsonb;
alter table public.job_deliveries
  drop constraint if exists job_deliveries_text_note_snapshot_array_check;
alter table public.job_deliveries
  add constraint job_deliveries_text_note_snapshot_array_check
  check (jsonb_typeof(text_note_snapshot) = 'array');
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_deliveries_id_job_unique'
      and conrelid = 'public.job_deliveries'::regclass
  ) then
    alter table public.job_deliveries
      add constraint job_deliveries_id_job_unique unique (id, job_id);
  end if;
end $$;

create table if not exists public.job_pdf_text_annotations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.job_deliveries(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  draft_version integer not null check (draft_version >= 0),
  source_document_id uuid not null,
  page integer not null check (page between 1 and 500),
  source_page integer not null check (source_page between 1 and 500),
  text text not null,
  box_x numeric(10,9) not null,
  box_y numeric(10,9) not null,
  box_width numeric(10,9) not null,
  box_height numeric(10,9) not null,
  font_size_ratio numeric(10,9) not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint job_pdf_text_annotations_delivery_job_fk
    foreign key (delivery_id, job_id)
    references public.job_deliveries(id, job_id),
  constraint job_pdf_text_annotations_source_document_fk
    foreign key (job_id, source_document_id)
    references public.job_documents(job_id, id),
  constraint job_pdf_text_annotations_text_check check (
    text = btrim(text, E' \n')
    and char_length(text) between 1 and 2000
    and octet_length(text) <= 8000
    and 1 + char_length(text) - char_length(replace(text, E'\n', '')) <= 20
    and regexp_replace(text, E'\n', '', 'g') !~ '[[:cntrl:]]'
  ),
  constraint job_pdf_text_annotations_geometry_check check (
    box_x between 0 and 1 and box_y between 0 and 1
    and box_width between 0.08 and 0.80
    and box_height between 0.04 and 0.60
    and box_x + box_width <= 1 and box_y + box_height <= 1
    and font_size_ratio between 0.012 and 0.05
  )
);

create index if not exists job_pdf_text_annotations_job_delivery_idx
  on public.job_pdf_text_annotations(job_id, delivery_id, page, id);
alter table public.job_pdf_text_annotations enable row level security;
drop policy if exists "Authorized users view PDF text annotations"
  on public.job_pdf_text_annotations;
create policy "Authorized users view PDF text annotations"
on public.job_pdf_text_annotations for select to authenticated
using (public.can_view_job(job_id));
revoke insert, update, delete on public.job_pdf_text_annotations from authenticated;
grant select on public.job_pdf_text_annotations to authenticated;

create or replace function public.validate_job_pdf_text_notes(
  p_job_id uuid,
  p_source_document_ids uuid[],
  p_page_count integer,
  p_text_notes jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item jsonb;
  expected_page integer;
  note_text text;
begin
  if jsonb_typeof(p_text_notes) <> 'array'
    or jsonb_array_length(p_text_notes) > 100
  then raise exception 'Invalid PDF text notes'; end if;

  for item in select value from jsonb_array_elements(p_text_notes) loop
    if jsonb_typeof(item) <> 'object'
      or not (item ?& array[
        'page','sourceDocumentId','sourcePage','text','x','y',
        'width','height','fontSizeRatio'
      ])
      or (select count(*) from jsonb_object_keys(item)) <> 9
      or jsonb_typeof(item->'page') <> 'number'
      or jsonb_typeof(item->'sourceDocumentId') <> 'string'
      or jsonb_typeof(item->'sourcePage') <> 'number'
      or jsonb_typeof(item->'text') <> 'string'
      or jsonb_typeof(item->'x') <> 'number'
      or jsonb_typeof(item->'y') <> 'number'
      or jsonb_typeof(item->'width') <> 'number'
      or jsonb_typeof(item->'height') <> 'number'
      or jsonb_typeof(item->'fontSizeRatio') <> 'number'
      or (item->>'sourceDocumentId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'sourcePage')::numeric <> trunc((item->>'sourcePage')::numeric)
      or (item->>'page')::integer not between 1 and p_page_count
      or (item->>'x')::numeric not between 0 and 1
      or (item->>'y')::numeric not between 0 and 1
      or (item->>'width')::numeric not between 0.08 and 0.80
      or (item->>'height')::numeric not between 0.04 and 0.60
      or (item->>'fontSizeRatio')::numeric not between 0.012 and 0.05
      or (item->>'x')::numeric + (item->>'width')::numeric > 1
      or (item->>'y')::numeric + (item->>'height')::numeric > 1
    then raise exception 'Invalid PDF text note'; end if;

    note_text := item->>'text';
    if note_text <> btrim(note_text, E' \n')
      or char_length(note_text) not between 1 and 2000
      or octet_length(note_text) > 8000
      or 1 + char_length(note_text) - char_length(replace(note_text, E'\n', '')) > 20
      or regexp_replace(note_text, E'\n', '', 'g') ~ '[[:cntrl:]]'
    then raise exception 'Invalid PDF text note text'; end if;

    if not ((item->>'sourceDocumentId')::uuid = any(coalesce(p_source_document_ids, '{}'::uuid[])))
    then raise exception 'Invalid PDF text note document lineage'; end if;

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
    then raise exception 'Invalid PDF text note page lineage'; end if;
  end loop;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid PDF text note';
end;
$$;

create or replace function public.initialize_job_pdf_draft_v3(
  p_job_id uuid,
  p_source_document_ids uuid[],
  p_page_count integer
)
returns table(
  version integer,
  source_page_count integer,
  placements jsonb,
  text_notes jsonb,
  source_document_ids uuid[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_mutate_job(p_job_id, auth.uid())
  then raise exception 'Job unavailable'; end if;
  perform public.initialize_job_pdf_draft_v2(
    p_job_id, p_source_document_ids, p_page_count
  );
  return query
  select d.version, d.source_page_count, d.placements, d.text_notes,
    d.source_document_ids
  from public.job_pdf_drafts d where d.job_id = p_job_id;
end;
$$;

create or replace function public.save_job_pdf_draft_v3(
  p_job_id uuid,
  p_expected_version integer,
  p_placements jsonb,
  p_text_notes jsonb
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
  perform public.validate_job_pdf_text_notes(
    p_job_id, draft.source_document_ids, draft.source_page_count, p_text_notes
  );
  result_version := public.save_job_pdf_draft_v2(
    p_job_id, p_expected_version, p_placements
  );
  update public.job_pdf_drafts
  set text_notes = p_text_notes
  where job_id = p_job_id and version = result_version;
  if not found then raise exception 'Draft version conflict'; end if;
  return result_version;
end;
$$;

create or replace function public.confirm_delivered_job_pdf_complete_v3(
  p_job_id uuid,
  p_storage_path text,
  p_source_photo_ids uuid[],
  p_source_document_ids uuid[],
  p_submit boolean,
  p_expected_draft_version integer,
  p_snapshot_hash text,
  p_text_note_snapshot jsonb
)
returns table(
  previous_storage_path text,
  delivered_status public.job_status,
  delivery_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.job_pdf_drafts%rowtype;
  confirmed record;
  item jsonb;
begin
  if not public.can_mutate_job(p_job_id, auth.uid())
  then raise exception 'Job unavailable'; end if;
  select * into draft from public.job_pdf_drafts
  where job_id = p_job_id for update;
  if draft.job_id is null or draft.version <> p_expected_draft_version
  then raise exception 'Draft version conflict'; end if;
  perform public.validate_job_pdf_text_notes(
    p_job_id, draft.source_document_ids, draft.source_page_count,
    p_text_note_snapshot
  );
  if draft.text_notes is distinct from p_text_note_snapshot
  then raise exception 'Text note snapshot changed'; end if;

  select * into confirmed
  from public.confirm_delivered_job_pdf_complete(
    p_job_id, p_storage_path, p_source_photo_ids, p_source_document_ids,
    p_submit, p_expected_draft_version, p_snapshot_hash
  );

  update public.job_deliveries
  set text_note_snapshot = p_text_note_snapshot
  where id = confirmed.delivery_id and job_id = p_job_id;
  if not found then raise exception 'Delivery unavailable'; end if;

  for item in select value from jsonb_array_elements(p_text_note_snapshot) loop
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
    confirmed.delivered_status, confirmed.delivery_id;
end;
$$;

revoke all on function public.validate_job_pdf_text_notes(uuid, uuid[], integer, jsonb) from public;
revoke all on function public.initialize_job_pdf_draft_v3(uuid, uuid[], integer) from public;
revoke all on function public.save_job_pdf_draft_v3(uuid, integer, jsonb, jsonb) from public;
revoke all on function public.confirm_delivered_job_pdf_complete_v3(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb) from public;
grant execute on function public.initialize_job_pdf_draft_v3(uuid, uuid[], integer) to authenticated;
grant execute on function public.save_job_pdf_draft_v3(uuid, integer, jsonb, jsonb) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_complete_v3(uuid, text, uuid[], uuid[], boolean, integer, text, jsonb) to authenticated;
