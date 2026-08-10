import { createElement } from "react";

export function UploadFeedback({ message, pendingFile }: { message: string; pendingFile?: string }) {
  const context = message && pendingFile ? ` Archivo pendiente: ${pendingFile}. Puedes reintentar sin seleccionarlo de nuevo.` : "";
  return createElement("p", { role: "status", "aria-live": "polite" }, `${message}${context}`);
}
