-- Corrective resumable, metadata-only PDF import. Apply after 20260810_jobs_bulk_import.sql.

alter table public.job_imports add column if not exists source_file_size bigint;
update public.job_imports set source_file_size = 0 where source_file_size is null;
alter table public.job_imports alter column source_file_size set not null;
alter table public.job_imports add constraint job_imports_source_file_size_check check (source_file_size >= 0);
drop index if exists public.job_imports_hash_idx;
create unique index job_imports_hash_size_idx on public.job_imports (source_file_hash, source_file_size);

create table public.job_import_batches (
  id uuid primary key default gen_random_uuid(), created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.job_import_items (
  item_id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.job_import_batches(id) on delete cascade,
  proposed_job_id uuid not null unique default gen_random_uuid(), source_file_name text not null,
  source_file_hash text not null check (source_file_hash ~ '^[a-f0-9]{64}$'), source_file_size bigint not null check (source_file_size > 0),
  source_mime_type text not null check (source_mime_type = 'application/pdf'), declared_pdf_header text not null check (declared_pdf_header = '%PDF-'),
  storage_path text not null unique, fields jsonb not null, item_status text not null default 'prepared' check (item_status in ('prepared','imported','duplicate','error')),
  confirmed_job_id uuid references public.jobs(id), error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (batch_id, source_file_hash, source_file_size)
);
alter table public.job_import_batches enable row level security;
alter table public.job_import_items enable row level security;
create policy "Office reads own import batches" on public.job_import_batches for select to authenticated using (created_by = auth.uid() and public.is_office_staff());
create policy "Office reads own import items" on public.job_import_items for select to authenticated using (public.is_office_staff() and exists (select 1 from public.job_import_batches b where b.id = batch_id and b.created_by = auth.uid()));
revoke insert, update, delete on public.job_import_batches, public.job_import_items from authenticated;
grant select on public.job_import_batches, public.job_import_items to authenticated;

create or replace function public.prepare_job_import_item(p_batch_id uuid, p_source_file_name text, p_stored_file_name text,
  p_source_file_hash text, p_source_file_size bigint, p_source_mime_type text, p_declared_pdf_header text, p_fields jsonb)
returns table(batch_id uuid, item_id uuid, proposed_job_id uuid, storage_path text, item_status text, confirmed_job_id uuid)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); chosen_batch uuid := p_batch_id; found public.job_import_items%rowtype; proposed uuid := gen_random_uuid();
begin
  if not public.is_office_staff(actor) or char_length(btrim(p_source_file_name)) not between 1 and 255
    or char_length(p_stored_file_name) not between 5 and 200 or p_stored_file_name !~* '\.pdf$'
    or position('/' in p_stored_file_name)>0 or position(chr(92) in p_stored_file_name)>0
    or p_source_file_hash !~ '^[a-f0-9]{64}$' or p_source_file_size <= 0 or p_source_file_size > 26214400
    or p_source_mime_type <> 'application/pdf' or p_declared_pdf_header <> '%PDF-' or nullif(btrim(p_fields->>'title'),'') is null then
    raise exception 'Invalid import metadata';
  end if;
  if chosen_batch is null then insert into public.job_import_batches(created_by) values(actor) returning id into chosen_batch;
  elsif not exists(select 1 from public.job_import_batches b where b.id=chosen_batch and b.created_by=actor) then raise exception 'Batch unavailable'; end if;
  perform 1 from public.job_import_batches b where b.id=chosen_batch for update;
  select * into found from public.job_import_items i where i.batch_id=chosen_batch and i.source_file_hash=p_source_file_hash and i.source_file_size=p_source_file_size;
  if found.item_id is null then
    if (select count(*) from public.job_import_items i where i.batch_id=chosen_batch) >= 100 then raise exception 'Batch limit exceeded'; end if;
    begin
      insert into public.job_import_items(batch_id,proposed_job_id,source_file_name,source_file_hash,source_file_size,source_mime_type,declared_pdf_header,storage_path,fields)
      values(chosen_batch,proposed,left(btrim(p_source_file_name),255),p_source_file_hash,p_source_file_size,p_source_mime_type,p_declared_pdf_header,proposed::text||'/'||p_stored_file_name,p_fields)
      returning * into found;
    exception when unique_violation then select * into found from public.job_import_items i where i.batch_id=chosen_batch and i.source_file_hash=p_source_file_hash and i.source_file_size=p_source_file_size; end;
  end if;
  return query select found.batch_id,found.item_id,found.proposed_job_id,found.storage_path,found.item_status,found.confirmed_job_id;
end $$;

create or replace function public.confirm_job_import_item(p_item_id uuid)
returns table(result_status text, confirmed_job_id uuid)
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); item public.job_import_items%rowtype; result_state text := 'imported'; result_job uuid; clean_order text;
begin
  if not public.is_office_staff(actor) then raise exception 'Only active office staff can import jobs'; end if;
  select i.* into item from public.job_import_items i join public.job_import_batches b on b.id=i.batch_id where i.item_id=p_item_id and b.created_by=actor for update of i;
  if item.item_id is null then raise exception 'Item unavailable'; end if;
  if item.confirmed_job_id is not null then return query select item.item_status,item.confirmed_job_id; return; end if;
  if not exists(select 1 from storage.objects where bucket_id='project-files' and name=item.storage_path
    and lower(coalesce(metadata->>'mimetype',''))=item.source_mime_type and (metadata->>'size')::bigint=item.source_file_size) then raise exception 'Storage object invalid'; end if;
  clean_order := nullif(btrim(item.fields->>'orderIdentifier'),'');
  if clean_order is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('job-order:'||lower(clean_order),0)); end if;
  select ji.job_id into result_job from public.job_imports ji where (ji.source_file_hash=item.source_file_hash and ji.source_file_size in (0,item.source_file_size))
    or (clean_order is not null and lower(btrim(ji.order_identifier))=lower(clean_order)) order by ji.imported_at limit 1;
  if result_job is null and clean_order is not null then select j.id into result_job from public.jobs j where lower(btrim(j.prism_number))=lower(clean_order) order by j.created_at limit 1; end if;
  if result_job is not null then result_state := 'duplicate'; else
    begin
      insert into public.jobs(id,title,prism_number,address,location,customer_name,request_date,job_type,description,category,main_status,project_pdf_url)
      values(item.proposed_job_id,left(btrim(item.fields->>'title'),200),nullif(btrim(item.fields->>'prismNumber'),''),nullif(btrim(item.fields->>'address'),''),
        nullif(btrim(item.fields->>'location'),''),nullif(btrim(item.fields->>'customerName'),''),nullif(item.fields->>'requestDate','')::date,
        nullif(btrim(item.fields->>'jobType'),''),nullif(btrim(item.fields->>'description'),''),'categoria_1','asignado',item.storage_path);
      insert into public.job_imports(job_id,source_file_name,source_file_hash,source_file_size,order_identifier,imported_by)
      values(item.proposed_job_id,item.source_file_name,item.source_file_hash,item.source_file_size,clean_order,actor);
      result_job := item.proposed_job_id;
    exception when unique_violation then
      select ji.job_id into result_job from public.job_imports ji where (ji.source_file_hash=item.source_file_hash and ji.source_file_size in (0,item.source_file_size))
        or (clean_order is not null and lower(btrim(ji.order_identifier))=lower(clean_order)) order by ji.imported_at limit 1;
      if result_job is null then raise; end if; result_state := 'duplicate';
    end;
  end if;
  update public.job_import_items set item_status=result_state,confirmed_job_id=result_job,updated_at=now() where item_id=p_item_id;
  return query select result_state,result_job;
end $$;

revoke all on function public.prepare_job_import_item(uuid,text,text,text,bigint,text,text,jsonb), public.confirm_job_import_item(uuid) from public;
revoke execute on function public.confirm_job_import(uuid,text,text,text,text,text,text,text,text,date,text,text,text,public.assignee_type,uuid) from authenticated;
grant execute on function public.prepare_job_import_item(uuid,text,text,text,bigint,text,text,jsonb), public.confirm_job_import_item(uuid) to authenticated;
