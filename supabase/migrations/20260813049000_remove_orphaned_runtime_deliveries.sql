-- Remove only the three delivery rows created by the accidental hosted route
-- regression on 2026-08-13. Their fixture jobs, annotations, and Storage objects
-- were already removed by the runtime cleanup, leaving these rows orphaned.
with known_runtime_delivery(id, job_id, storage_path) as (
  values
    (
      '09cc889e-cd19-4fe8-8240-e1e2fd9b36ef'::uuid,
      '18dee92e-0b50-45cd-ae0e-ea7a012e1718'::uuid,
      '18dee92e-0b50-45cd-ae0e-ea7a012e1718/delivered/550bc6e0-26a9-4a95-919f-ded54977590d.pdf'::text
    ),
    (
      '4c7e8ea4-b18a-404f-bdd8-3fe7e2b9cc2d'::uuid,
      '18dee92e-0b50-45cd-ae0e-ea7a012e1718'::uuid,
      '18dee92e-0b50-45cd-ae0e-ea7a012e1718/delivered/a64a0bd5-2195-4398-9359-dbc6642f6c1c.pdf'::text
    ),
    (
      '38a96097-4678-40c2-983e-13ccef621938'::uuid,
      '7a0f5ee2-43a2-47b9-844b-8947ee14db98'::uuid,
      '7a0f5ee2-43a2-47b9-844b-8947ee14db98/delivered/6079659c-6892-4237-a5ce-116b07c96c82.pdf'::text
    )
)
delete from public.job_deliveries delivery
using known_runtime_delivery known
where delivery.id = known.id
  and delivery.job_id = known.job_id
  and delivery.storage_path = known.storage_path
  and delivery.delivery_kind = 'submission'
  and not exists (
    select 1 from public.jobs job where job.id = delivery.job_id
  )
  and not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'project-files'
      and object.name = delivery.storage_path
  );
