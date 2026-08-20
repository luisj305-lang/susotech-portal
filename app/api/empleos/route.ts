import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Datos inválidos." }, { status: 400 });
  }

  const fullName = String(body.full_name ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const email = String(body.email ?? "").trim();
  const position = String(body.position ?? "").trim();
  const experience = String(body.experience ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (!fullName || fullName.length > 200) {
    return NextResponse.json({ success: false, message: "Ingresá tu nombre." }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json({ success: false, message: "Ingresá un teléfono o un correo para poder contactarte." }, { status: 400 });
  }
  if (phone.length > 30 || email.length > 200 || position.length > 200 || experience.length > 4000 || message.length > 4000) {
    return NextResponse.json({ success: false, message: "Algunos datos son demasiado largos." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("job_applications").insert({
    full_name: fullName,
    phone: phone || null,
    email: email || null,
    position: position || null,
    experience: experience || null,
    message: message || null,
  });

  if (error) {
    return NextResponse.json({ success: false, message: "No se pudo guardar la solicitud. Reintentá." }, { status: 500 });
  }
  return NextResponse.json({ success: true, message: "¡Gracias! Recibimos tu información y te contactaremos." });
}
