import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const PRIVACY_VERSION = "recruitment-v1";
export const RESUME_BUCKET = "recruitment-resumes";
const positions = ["Ayudante", "Técnico de fibra óptica", "Técnico de cableado", "Conductor", "Otro"];
const licenses = ["Licencia regular", "CDL clase A", "CDL clase B", "CDL clase C", "Otra"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PublicApplicationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function receiptHash(token: unknown) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new PublicApplicationError("La solicitud no es válida.");
  return createHash("sha256").update(token).digest("hex");
}

export function validUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }

export function receiptMatches(token: unknown, stored: string) {
  const actual = Buffer.from(receiptHash(token), "hex");
  return /^[a-f0-9]{64}$/.test(stored) && timingSafeEqual(actual, Buffer.from(stored, "hex"));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PublicApplicationError("La solicitud no es válida.");
  return value as Record<string, unknown>;
}

export function parsePublicApplication(value: unknown, now = new Date()) {
  const body = record(value);
  const input = record(body.application);
  if (!validUuid(body.submissionKey)) throw new PublicApplicationError("La solicitud no es válida.");
  const tokenHash = receiptHash(body.receiptToken);
  if (body.website !== "") throw new PublicApplicationError("No se pudo procesar la solicitud.");
  if (body.privacyConsent !== true || body.privacyVersion !== PRIVACY_VERSION) throw new PublicApplicationError("Acepta el aviso de privacidad para continuar.");
  const text = (key: string, max: number, required = true) => {
    const value = input[key];
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) || (required && !value.trim())) {
      throw new PublicApplicationError("Revisa los campos del formulario.");
    }
    return value.trim();
  };
  const yesNo = (key: string) => {
    if (input[key] !== "yes" && input[key] !== "no") throw new PublicApplicationError("Responde las preguntas de disponibilidad y licencia.");
    return input[key] === "yes";
  };
  const email = text("email", 254).toLowerCase();
  const phone = text("phone", 30);
  const postalCode = text("postalCode", 10);
  const position = text("position", 100);
  const startDate = text("startDate", 10);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PublicApplicationError("Ingresa un correo electrónico válido.");
  if (!/^[+\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 15) throw new PublicApplicationError("Ingresa un teléfono válido.");
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) throw new PublicApplicationError("Ingresa un código postal válido.");
  if (!positions.includes(position)) throw new PublicApplicationError("Selecciona un puesto válido.");
  // A one-day UTC tolerance accommodates an applicant's local calendar near midnight.
  const earliest = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(Date.parse(startDate)) || new Date(startDate).toISOString().slice(0, 10) !== startDate || startDate < earliest) throw new PublicApplicationError("Selecciona una fecha de inicio válida.");
  const hasLicense = yesNo("hasLicense");
  const licenseType = text("licenseType", 100, false);
  if (hasLicense && !licenses.includes(licenseType)) throw new PublicApplicationError("Selecciona el tipo de licencia.");
  let resume: { name: string; size: number } | null = null;
  if (body.resume != null) {
    const file = record(body.resume);
    if (typeof file.name !== "string" || file.name.length > 255 || !/\.pdf$/i.test(file.name) || /[\u0000-\u001f\/\\]/u.test(file.name) || file.type !== "application/pdf" || !Number.isInteger(file.size) || Number(file.size) <= 0 || Number(file.size) > MAX_RESUME_BYTES) throw new PublicApplicationError("Adjunta un PDF válido de hasta 10 MB.");
    resume = { name: file.name, size: Number(file.size) };
  }
  return {
    submissionKey: body.submissionKey,
    tokenHash,
    resume,
    application: {
      full_name: text("fullName", 120), phone, email, city: text("city", 100), state: text("state", 100), postal_code: postalCode,
      position, start_date: startDate, can_travel: yesNo("travel"), available_weekends: yesNo("weekends"),
      experience_details: text("experience", 2000), has_license: hasLicense, license_type: hasLicense ? licenseType : null,
      certifications: text("certifications", 1000, false), additional_comments: text("comments", 2000, false),
      privacy_consent: true, privacy_version: PRIVACY_VERSION, privacy_accepted_at: now.toISOString(),
    },
  };
}

export function allowedRecruitmentOrigin(origin: string | null, production: boolean) {
  if (origin === "https://susotech.org" || origin === "https://www.susotech.org") return true;
  if (!production && origin) {
    try { const url = new URL(origin); return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname); } catch { return false; }
  }
  return false;
}
