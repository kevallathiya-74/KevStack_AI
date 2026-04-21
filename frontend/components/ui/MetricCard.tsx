type Props = {
  label: string;
  value: string | number;
  loading?: boolean;
};

export function MetricCard({ label, value, loading = false }: Props) {
  if (loading) {
    return (
      <article className="metric-card metric-card--loading" aria-hidden="true">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__value-skeleton" />
      </article>
    );
  }

  return (
    <article className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </article>
  );
}
