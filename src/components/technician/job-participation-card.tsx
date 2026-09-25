function formatPercentage(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export function JobParticipationCard({ informationalBasisPoints }: { informationalBasisPoints: number }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 shadow-card">
      <h2 className="text-xl font-bold text-ink">Tu participación</h2>
      <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 text-ink">
        <strong>{formatPercentage(informationalBasisPoints)}</strong> · Participación registrada en esta entrega.
      </p>
      <p className="mt-3 text-sm text-ink-soft">
        La compensación se determina por las jornadas y la nómina. Este porcentaje es informativo y no es una asignación financiera del trabajo.
      </p>
    </section>
  );
}
