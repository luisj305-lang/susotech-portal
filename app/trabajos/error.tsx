"use client";

export default function JobsError({ reset }: { error: Error; reset: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-white p-6 text-center"><div><h1 className="text-2xl font-bold">No pudimos cargar los trabajos</h1><p className="mt-2 text-black">El intento no modificó tus datos. Puedes volver a probar.</p><button type="button" onClick={reset} className="mt-5 rounded-lg bg-black px-5 py-3 font-semibold text-white">Reintentar</button></div></main>;
}
