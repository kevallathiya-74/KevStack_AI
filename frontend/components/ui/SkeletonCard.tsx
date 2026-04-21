type SkeletonCardProps = {
  lines?: number;
  className?: string;
};

export default function SkeletonCard({ lines = 3, className = "" }: SkeletonCardProps) {
  return (
    <div className={`skeleton-card ${className}`.trim()} aria-hidden="true">
      <div className="skeleton-card__title" />
      <div className="skeleton-card__content">
        {Array.from({ length: lines }).map((_, index) => (
          <div className="skeleton-card__line" key={index} />
        ))}
      </div>
    </div>
  );
}
