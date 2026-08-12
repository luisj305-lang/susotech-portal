create table public.job_pdf_drafts (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  source_page_count integer not null check (source_page_count between 1 and 50),
  placements jsonb not null default '[]'::jsonb check (jsonb_typeof(placements) = 'array'),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.job_pdf_drafts enable row level security;
create policy "Authorized users view PDF drafts" on public.job_pdf_drafts
for select to authenticated using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_pdf_drafts from authenticated;
grant select on public.job_pdf_drafts to authenticated;

create table public.job_pdf_delivery_versions (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  draft_version integer not null check (draft_version >= 0),
  delivered_path text not null,
  confirmed_at timestamptz not null default now()
);
alter table public.job_pdf_delivery_versions enable row level security;
create policy "Authorized users view PDF delivery versions" on public.job_pdf_delivery_versions
for select to authenticated using (public.can_access_job(job_id));
revoke insert, update, delete on public.job_pdf_delivery_versions from authenticated;
grant select on public.job_pdf_delivery_versions to authenticated;

create or replace function public.initialize_job_pdf_draft(p_job_id uuid, p_page_count integer)
returns table(version integer, source_page_count integer, placements jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if not public.is_technician(actor) or not public.can_access_job(p_job_id, actor) then raise exception 'Job unavailable'; end if;
  if p_page_count not between 1 and 50 then raise exception 'Invalid page count'; end if;
  insert into public.job_pdf_drafts(job_id, source_page_count, updated_by)
  values(p_job_id,p_page_count,actor)
  on conflict(job_id) do update set source_page_count=excluded.source_page_count
    where job_pdf_drafts.version=0 and job_pdf_drafts.placements='[]'::jsonb;
  return query select d.version,d.source_page_count,d.placements from public.job_pdf_drafts d where d.job_id=p_job_id;
end $$;

create or replace function public.save_job_pdf_draft(p_job_id uuid,p_expected_version integer,p_placements jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); draft public.job_pdf_drafts%rowtype; item jsonb; a jsonb; result_version integer;
begin
  if not public.is_technician(actor) or not public.can_access_job(p_job_id,actor) then raise exception 'Job unavailable'; end if;
  if not exists(select 1 from public.jobs where id=p_job_id and main_status='en_progreso' and archived_at is null) then raise exception 'Job is not editable'; end if;
  select * into draft from public.job_pdf_drafts where job_id=p_job_id for update;
  if draft.job_id is null then raise exception 'Draft unavailable'; end if;
  if draft.version<>p_expected_version then raise exception 'Draft version conflict'; end if;
  if jsonb_typeof(p_placements)<>'array' or jsonb_array_length(p_placements)>500 then raise exception 'Invalid placements'; end if;
  for item in select value from jsonb_array_elements(p_placements) loop
    if jsonb_typeof(item)<>'object' or not (item ?& array['id','catalogId','page','x','y','width','height'])
      or jsonb_typeof(item->'page')<>'number' or jsonb_typeof(item->'x')<>'number' or jsonb_typeof(item->'y')<>'number'
      or jsonb_typeof(item->'width')<>'number' or jsonb_typeof(item->'height')<>'number'
      or (item->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'catalogId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (item->>'page')::numeric <> trunc((item->>'page')::numeric)
      or (item->>'page')::integer not between 1 and draft.source_page_count
      or (item->>'x')::numeric < 0 or (item->>'y')::numeric < 0
      or (item->>'width')::numeric not between 0.04 and 0.35 or (item->>'height')::numeric not between 0.025 and 0.20
      or (item->>'x')::numeric+(item->>'width')::numeric>1
      or (item->>'y')::numeric+(item->>'height')::numeric>1
      or not exists(select 1 from public.production_code_catalog c where c.id=(item->>'catalogId')::uuid and c.is_active)
    then raise exception 'Invalid placement'; end if;
    for a in select value from jsonb_array_elements(p_placements) where value->>'id' < item->>'id' and (value->>'page')::integer=(item->>'page')::integer loop
      if (item->>'x')::numeric < (a->>'x')::numeric+(a->>'width')::numeric
        and (item->>'x')::numeric+(item->>'width')::numeric > (a->>'x')::numeric
        and (item->>'y')::numeric < (a->>'y')::numeric+(a->>'height')::numeric
        and (item->>'y')::numeric+(item->>'height')::numeric > (a->>'y')::numeric
      then raise exception 'Placements overlap'; end if;
    end loop;
  end loop;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(p_placements)) then
    raise exception 'Duplicate placement id';
  end if;
  update public.job_pdf_drafts set placements=p_placements,version=version+1,updated_by=actor,updated_at=now()
  where job_id=p_job_id returning version into result_version;
  return result_version;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid placement';
end $$;

create or replace function public.confirm_delivered_job_pdf_versioned(
  p_job_id uuid,p_storage_path text,p_source_photo_ids uuid[],p_submit boolean,p_expected_draft_version integer
)
returns table(previous_storage_path text,delivered_status public.job_status)
language plpgsql security definer set search_path = '' as $$
declare draft public.job_pdf_drafts%rowtype; previous_path text; result_status public.job_status;
begin
  select * into draft from public.job_pdf_drafts where job_id=p_job_id for update;
  if draft.job_id is null or draft.version<>p_expected_draft_version then raise exception 'Draft version conflict'; end if;
  select c.previous_storage_path,c.delivered_status into previous_path,result_status
  from public.confirm_delivered_job_pdf(p_job_id,p_storage_path,p_source_photo_ids,p_submit) c;
  insert into public.job_pdf_delivery_versions(job_id,draft_version,delivered_path)
  values(p_job_id,draft.version,p_storage_path)
  on conflict(job_id) do update set draft_version=excluded.draft_version,delivered_path=excluded.delivered_path,confirmed_at=now();
  return query select previous_path,result_status;
end $$;

revoke all on function public.initialize_job_pdf_draft(uuid,integer) from public;
revoke all on function public.save_job_pdf_draft(uuid,integer,jsonb) from public;
revoke all on function public.confirm_delivered_job_pdf_versioned(uuid,text,uuid[],boolean,integer) from public;
grant execute on function public.initialize_job_pdf_draft(uuid,integer) to authenticated;
grant execute on function public.save_job_pdf_draft(uuid,integer,jsonb) to authenticated;
grant execute on function public.confirm_delivered_job_pdf_versioned(uuid,text,uuid[],boolean,integer) to authenticated;
