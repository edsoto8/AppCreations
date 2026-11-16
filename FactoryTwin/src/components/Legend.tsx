export const STATE_COLORS: Record<string, string> = {
  running: '#22c55e',
  idle: '#eab308',
  starved: '#eab308',
  blocked: '#f97316',
  failed: '#ef4444',
  maintenance: '#3b82f6',
  unstaffed: '#a855f7',
  closed: '#64748b',
};

export function Legend() {
  return (
    <div className="legend">
      {['running', 'starved', 'blocked', 'failed', 'maintenance', 'unstaffed', 'closed'].map((s) => (
        <span key={s}>
          <i style={{ background: STATE_COLORS[s] }} /> {s}
        </span>
      ))}
    </div>
  );
}
