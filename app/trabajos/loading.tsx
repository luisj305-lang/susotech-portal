export default function LoadingJobs() {
  return <main className="min-h-screen bg-white p-8" aria-busy="true"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-9 w-48 rounded bg-neutral-200" /><div className="mt-8 grid gap-4 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-40 rounded-2xl bg-neutral-200" />)}</div></div></main>;
}
