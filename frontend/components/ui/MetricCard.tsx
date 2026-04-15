type Props = {
  label: string;
  value: string | number;
};

export function MetricCard({ label, value }: Props) {
  return (
    <article className="metric-card">
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
    </article>
  );
}
