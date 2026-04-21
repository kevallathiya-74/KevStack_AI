type EmptyStateProps = {
  title?: string;
  message: string;
};

export default function EmptyState({
  title = "Nothing to show yet",
  message,
}: EmptyStateProps) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__message">{message}</p>
    </div>
  );
}
