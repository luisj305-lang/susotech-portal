-- Punto 12: flecha para señalar en las notas de texto del PDF.
-- Acepta arrowTipX/arrowTipY opcionales en las notas (retrocompatible con notas sin flecha).
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
      or (select count(*) from jsonb_object_keys(item) where value not in (
        'page','sourceDocumentId','sourcePage','text','x','y',
        'width','height','fontSizeRatio','arrowTipX','arrowTipY'
      )) <> 0
      or jsonb_typeof(item->'page') <> 'number'
      or jsonb_typeof(item->'sourceDocumentId') <> 'string'
      or jsonb_typeof(item->'sourcePage') <> 'number'
      or jsonb_typeof(item->'text') <> 'string'
      or jsonb_typeof(item->'x') <> 'number'
      or jsonb_typeof(item->'y') <> 'number'
      or jsonb_typeof(item->'width') <> 'number'
      or jsonb_typeof(item->'height') <> 'number'
      or jsonb_typeof(item->'fontSizeRatio') <> 'number'
      or (item ? 'arrowTipX' and (jsonb_typeof(item->'arrowTipX') <> 'number' or (item->>'arrowTipX')::numeric not between 0 and 1))
      or (item ? 'arrowTipY' and (jsonb_typeof(item->'arrowTipY') <> 'number' or (item->>'arrowTipY')::numeric not between 0 and 1))
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
