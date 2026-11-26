export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="prompt-meta">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
