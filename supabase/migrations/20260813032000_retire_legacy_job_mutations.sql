-- Contract phase applied only after the v2 portal is live. These legacy RPCs
-- cannot carry complete document, annotation, quantity and audit snapshots.
revoke execute on function public.prepare_job_document(uuid, text, text, bigint) from authenticated;
revoke execute on function public.confirm_job_document(uuid) from authenticated;
revoke execute on function public.initialize_job_pdf_draft(uuid, integer) from authenticated;
revoke execute on function public.save_job_pdf_draft(uuid, integer, jsonb) from authenticated;
revoke execute on function public.confirm_delivered_job_pdf(uuid, text, uuid[], boolean) from authenticated;
revoke execute on function public.confirm_delivered_job_pdf_versioned(uuid, text, uuid[], boolean, integer) from authenticated;
revoke execute on function public.set_job_archived(uuid, boolean, text) from authenticated;
