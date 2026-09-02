"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { optimizeTechnicianRoute } from "@/lib/jobs/technician-routing-actions";
import type { TechnicianRouteJob } from "@/lib/jobs/technician-routing-queries";

type GeolocationState = "idle" | "requesting" | "unsupported" | "denied" | "timeout" | "unavailable";

type RouteResult = {
  orderedJobs: Array<{ id: string; label: string; address: string; lat: number; lng: number }>;
  skipped: Array<{ id: string; label: string }>;
  distanceMeters: number;
  duration: string;
};

type LatLng = { lat: number; lng: number };

function durationLabel(value: string) {
  const seconds = Number.parseFloat(value.replace(/s$/u, ""));
  if (!Number.isFinite(seconds)) return value;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

function geolocationMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Permiso de ubicación denegado. Habilita la ubicación en tu navegador para calcular la ruta.";
  }
  if (error.code === error.TIMEOUT) {
    return "La solicitud de ubicación tardó demasiado. Inténtalo de nuevo.";
  }
  return "No se pudo obtener tu ubicación actual. Inténtalo de nuevo.";
}

function mapsDirectionsUrl(origin: LatLng, destination: LatLng, waypoints: LatLng[] = []) {
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
  });
  if (waypoints.length) {
    params.set("waypoints", waypoints.map((waypoint) => `${waypoint.lat},${waypoint.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function TechnicianRoute({ jobs }: { jobs: TechnicianRouteJob[] }) {
  const [geoState, setGeoState] = useState<GeolocationState>("idle");
  const [geoError, setGeoError] = useState("");
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [pending, startTransition] = useTransition();

  const requestLocation = () => {
    setGeoState("requesting");
    setGeoError("");
    setMessage("");
    setResult(null);
    setOrigin(null);

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("unsupported");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = { lat: position.coords.latitude, lng: position.coords.longitude };
        setOrigin(current);
        setGeoState("idle");
        startTransition(async () => {
          const response = await optimizeTechnicianRoute({
            jobIds: jobs.map((job) => job.id),
            origin: { latitude: current.lat, longitude: current.lng },
          });
          setMessage(response.success ? "Ruta optimizada." : response.message);
          if (response.success) {
            setResult({
              orderedJobs: response.orderedJobs,
              skipped: response.skipped,
              distanceMeters: response.distanceMeters,
              duration: response.duration,
            });
          }
        });
      },
      (error) => {
        setGeoState(
          error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable",
        );
        setGeoError(geolocationMessage(error));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  const legs: Array<{ origin: LatLng; destination: LatLng; label: string }> = [];
  if (result && origin) {
    result.orderedJobs.forEach((job, index) => {
      const from = index === 0 ? origin : { lat: result.orderedJobs[index - 1].lat, lng: result.orderedJobs[index - 1].lng };
      legs.push({ origin: from, destination: { lat: job.lat, lng: job.lng }, label: job.label });
    });
    if (result.orderedJobs.length) {
      const last = result.orderedJobs[result.orderedJobs.length - 1];
      legs.push({ origin: { lat: last.lat, lng: last.lng }, destination: origin, label: "Tu ubicación" });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
        <h2 className="text-lg font-semibold text-ink">Tu ubicación actual</h2>
        <p className="mt-1 text-sm text-ink-soft">El recorrido empieza y termina en tu posición GPS actual.</p>
        <Button type="button" className="mt-4 w-full" disabled={pending || jobs.length < 1} onClick={requestLocation}>
          {pending ? "Calculando…" : "Usar mi ubicación"}
        </Button>

        {geoState === "unsupported" && <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-soft">Tu navegador no soporta la geolocalización.</p>}
        {geoState === "denied" && <p role="status" aria-live="polite" className="mt-3 text-sm text-red-700">{geoError}</p>}
        {geoState === "timeout" && <p role="status" aria-live="polite" className="mt-3 text-sm text-amber-700">{geoError}</p>}
        {geoState === "unavailable" && <p role="status" aria-live="polite" className="mt-3 text-sm text-amber-700">{geoError}</p>}

        <div className="mt-6 border-t border-line pt-4">
          <p className="font-semibold text-ink">{jobs.length} trabajos pendientes</p>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-soft">{message}</p>
        </div>
      </section>

      <div className="grid gap-5">
        {result && (
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold text-ink">Recorrido optimizado</h2>
            <p className="mt-1 text-sm text-ink-soft">{(result.distanceMeters / 1609.344).toFixed(1)} mi · {durationLabel(result.duration)} · ida y vuelta</p>
            <ol className="mt-4 grid gap-2">
              {result.orderedJobs.map((job, index) => (
                <li key={job.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-900 text-sm font-bold text-white">{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/trabajos/${job.id}`} className="font-semibold text-accent-600 underline">{job.label}</Link>
                    <span className="block text-sm text-ink-soft">{job.address}</span>
                    {legs[index] && (
                      <a href={mapsDirectionsUrl(legs[index].origin, legs[index].destination)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-accent-600 underline">Cómo llegar</a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {legs.length > result.orderedJobs.length && (
              <a href={mapsDirectionsUrl(legs[legs.length - 1].origin, legs[legs.length - 1].destination)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-accent-600 underline">Regresar a tu ubicación</a>
            )}
            <p className="mt-4 text-xs text-ink-muted">Este resultado no se guarda. Vuelve a calcular si cambian los trabajos o tu ubicación.</p>
          </section>
        )}

        {result && result.skipped.length > 0 && (
          <section className="rounded-2xl border border-line bg-white p-5 shadow-card">
            <h2 className="text-lg font-semibold text-ink">Trabajos sin ubicar</h2>
            <p className="mt-1 text-sm text-ink-soft">No se pudieron resolver sus direcciones y se excluyeron del recorrido.</p>
            <ul className="mt-3 grid gap-2">
              {result.skipped.map((job) => (
                <li key={job.id} className="flex gap-3 rounded-xl border border-line p-3">
                  <Link href={`/trabajos/${job.id}`} className="font-semibold text-accent-600 underline">{job.label}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!result && jobs.length === 0 && (
          <section className="rounded-2xl border border-dashed border-line p-10 text-center">
            <h2 className="font-semibold text-ink">No tienes trabajos pendientes</h2>
            <p className="mt-2 text-sm text-ink-muted">La ruta estará disponible cuando tengas trabajos asignados.</p>
          </section>
        )}
      </div>
    </div>
  );
}
