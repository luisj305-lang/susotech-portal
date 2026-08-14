"use client";

export default function CrewsError({ retry }: { error: Error; retry: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-white p-6 text-center"><div><h1 className="text-2xl font-bold">No pudimos cargar los equipos</h1><p className="mt-2 text-black">No se modificaron los datos. Puedes volver a intentar.</p><button type="button" onClick={() => retry()} className="mt-5 rounded-lg bg-black px-5 py-3 font-semibold text-white">Reintentar</button></div></main>;
}
