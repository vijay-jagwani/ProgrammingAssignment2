// Small theme-aware SVG charts following the dataviz reference palette:
// thin marks, hairline grid, legend + direct labels, tooltips via <title>.

export interface Series {
  name: string;
  values: (number | null)[];
  color: string; // css var, e.g. 'var(--series-1)'
  dashed?: boolean;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

export function LineChart({
  labels, series, height = 180, valueFmt = (v: number) => v.toLocaleString(),
}: {
  labels: string[];
  series: Series[];
  height?: number;
  valueFmt?: (v: number) => string;
}) {
  const W = 560;
  const H = height;
  const padL = 44;
  const padR = 70; // room for direct labels
  const padT = 10;
  const padB = 22;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const maxV = Math.max(1, ...all);
  const ticks = niceTicks(maxV);
  const top = ticks[ticks.length - 1];
  const x = (i: number) =>
    padL + (labels.length <= 1 ? 0 : (i * (W - padL - padR)) / (labels.length - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {t >= 1000 ? `${t / 1000}k` : t}
            </text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--axis)" strokeWidth="1" />
        {labels.map((l, i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ink-3)">
            {l}
          </text>
        ))}
        {series.map((s) => {
          const pts = s.values
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(' ');
          let lastIdx = -1;
          s.values.forEach((v, i) => { if (v != null) lastIdx = i; });
          return (
            <g key={s.name}>
              <polyline
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map((v, i) =>
                v == null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={s.color} stroke="var(--surface-1)" strokeWidth="2">
                    <title>{`${s.name} — ${labels[i]}: ${valueFmt(v)}`}</title>
                  </circle>
                ),
              )}
              {lastIdx >= 0 && (
                <text
                  x={x(lastIdx) + 8}
                  y={y(s.values[lastIdx]!) + 4}
                  fontSize="11"
                  fill="var(--ink-2)"
                >
                  {s.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (
            <span className="key" key={s.name}>
              <span
                className="swatch"
                style={{
                  background: s.dashed
                    ? `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)`
                    : s.color,
                }}
              />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal single-hue breakdown bars with value labels in ink. */
export function BarBreakdown({
  items, valueFmt = (v: number) => v.toLocaleString(),
}: {
  items: { label: string; value: number }[];
  valueFmt?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <table className="data" style={{ fontSize: 13 }}>
      <tbody>
        {items.map((it) => (
          <tr key={it.label}>
            <td style={{ width: '32%', color: 'var(--ink-2)' }}>{it.label}</td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div
                  title={`${it.label}: ${valueFmt(it.value)}`}
                  style={{
                    height: 10,
                    borderRadius: 4,
                    width: `${(Math.abs(it.value) / max) * 100}%`,
                    minWidth: 2,
                    background: 'var(--series-1)',
                  }}
                />
                <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {valueFmt(it.value)}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
