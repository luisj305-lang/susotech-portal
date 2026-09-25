export async function requestDeliveredPdfGeneration(jobId: string, input: Record<string, unknown>) {
  const send = (body: Record<string, unknown>) => fetch(`/api/trabajos/${jobId}/pdf-entregado`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let response = await send(input);
  let result = await response.json();
  if (response.status === 409 && result.requiresReplacementConfirmation === true
    && typeof result.expectedPath === "string") {
    if (!window.confirm(result.message)) return { ok: false, message: "Se conservó el PDF entregado actual." };
    response = await send({ ...input, expectedPath: result.expectedPath, confirmReplacement: true });
    result = await response.json();
  }
  return { ok: response.ok, message: result.message as string | undefined };
}
