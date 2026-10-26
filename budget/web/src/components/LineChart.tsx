import { formatEur } from '@budget/shared';

export interface ChartSeries {
  name: string;
  color: string;
  values: (number | null)[];
  bold?: boolean;
  dashed?: boolean;
}

const W = 340;
const H = 170;
const PAD = { left: 52, right: 10, top: 10, bottom: 22 };

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function shortMonth(month: string): string {
  const [year = '', m = '1'] = month.split('-');
  return `${SHORT_MONTHS[Number(m) - 1] ?? ''} ${year.slice(2)}`;
}

/** Dependency-free SVG line chart; values are cents, x is one point per label (month). */
export function LineChart({ labels, series }: { labels: string[]; series: ChartSeries[] }): JSX.Element {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const rawMax = Math.max(0, ...all);
  const rawMin = Math.min(0, ...all);
  const span = rawMax - rawMin || 1;
  const max = rawMax + span * 0.05;
  const min = rawMin;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number): number => PAD.left + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number): number => PAD.top + innerH - ((v - min) / (max - min)) * innerH;
  const ticks = [min, min + (max - min) / 2, max].map((t) => Math.round(t / 100) * 100);
  const labelIdx = labels.length <= 3 ? labels.map((_, i) => i) : [0, Math.floor((labels.length - 1) / 2), labels.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Évolution de l'épargne">
      {ticks.map((t) => (
        <g key={t}>
          <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end">
            {formatEur(t, { compact: true })}
          </text>
        </g>
      ))}
      {labelIdx.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}>
          {shortMonth(labels[i] as string)}
        </text>
      ))}
      {series.map((s) => {
        const points = s.values
          .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
          .filter((p): p is string => p !== null);
        const lastIndex = s.values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
        const lastValue = lastIndex >= 0 ? s.values[lastIndex] : null;
        return (
          <g key={s.name}>
            {points.length > 1 ? (
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={s.bold ? 2.6 : 1.8}
                strokeLinejoin="round"
                strokeLinecap="round"
                {...(s.dashed ? { strokeDasharray: '4 3' } : {})}
              />
            ) : null}
            {lastValue !== null && lastValue !== undefined ? <circle cx={x(lastIndex)} cy={y(lastValue)} r={3} fill={s.color} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ series }: { series: Pick<ChartSeries, 'name' | 'color'>[] }): JSX.Element {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.name}>
          <i style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}
