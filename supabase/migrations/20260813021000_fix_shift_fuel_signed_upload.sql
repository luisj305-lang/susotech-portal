-- Signed upload URL creation does not yet have object metadata available for
-- an INSERT policy. Enforce file limits at the private bucket boundary, then
-- keep the policy focused on technician identity and the immutable path shape.

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'technician-shift-fuel';

drop policy if exists "Technicians upload own shift fuel photos"
on storage.objects;
create policy "Technicians upload own shift fuel photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'technician-shift-fuel'
  and public.is_technician()
  and (storage.foldername(name))[1] = auth.uid()::text
  and name ~ (
    '^' || auth.uid()::text
    || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
  )
);
