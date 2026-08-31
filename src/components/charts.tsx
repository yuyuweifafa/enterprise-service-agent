import { cn } from '@/lib/format';

/**
 * 手写 SVG 图表。不引图表库的原因：Demo 只需要 4 种图形，
 * 自己画能完全控制无障碍属性与配色，且零依赖、零打包体积。
 *
 * 网格线与环形轨道的颜色走 CSS 变量（--chart-grid / --chart-track），
 * 与 globals.css 的配色入口保持一致。
 */

export interface SeriesPoint {
  label: string;
  value: number;
}

export function LineTrend({
  series,
  height = 160,
  color = '#2d54d6',
  fillOpacity = 0.12,
  valueFormatter = (v: number) => String(v),
  ariaLabel,
}: {
  series: SeriesPoint[];
  height?: number;
  color?: string;
  fillOpacity?: number;
  valueFormatter?: (v: number) => string;
  ariaLabel: string;
}) {
  if (series.length === 0) return null;
  const w = 100;
  const h = 100;
  const max = Math.max(...series.map((p) => p.value), 1);
  const min = Math.min(...series.map((p) => p.value), 0);
  const span = max - min || 1;
  const step = series.length > 1 ? w / (series.length - 1) : w;

  const points = series.map((p, i) => {
    const x = i * step;
    const y = h - ((p.value - min) / span) * h;
    return { x, y, ...p };
  });

  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2={w}
            y1={h * g}
            y2={h * g}
            stroke="var(--chart-grid)"
            strokeWidth="0.4"
          />
        ))}
        <polygon points={area} fill={color} opacity={fillOpacity} />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        {points.map((p) => (
          <circle key={p.label} cx={p.x} cy={p.y} r="1.2" fill={color} />
        ))}
      </svg>
      <figcaption className="mt-2 flex justify-between text-[11px] text-ink-faint">
        <span>
          {series[0].label} · {valueFormatter(series[0].value)}
        </span>
        <span>
          {series[series.length - 1].label} · {valueFormatter(series[series.length - 1].value)}
        </span>
      </figcaption>
    </figure>
  );
}

export function StackedBars({
  series,
  ariaLabel,
  height = 160,
}: {
  series: Array<{ label: string; primary: number; secondary: number }>;
  ariaLabel: string;
  height?: number;
}) {
  const max = Math.max(...series.map((s) => s.primary + s.secondary), 1);
  return (
    <figure className="w-full">
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={ariaLabel}>
        {series.map((s) => {
          const total = s.primary + s.secondary;
          return (
            <div
              key={s.label}
              className="group flex h-full flex-1 flex-col justify-end gap-0.5"
              title={`${s.label}：自动解决 ${s.primary}，转人工 ${s.secondary}`}
            >
              <div
                className="rounded-t bg-risk-high/85"
                style={{ height: `${(s.secondary / max) * 100}%` }}
              />
              <div className="rounded-b bg-brand/85" style={{ height: `${(s.primary / max) * 100}%` }} />
              <span className="sr-only">{`${s.label}：共 ${total}`}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2 flex items-center gap-4 text-[11px] text-ink-faint">
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded bg-brand/85" /> 自动解决
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded bg-risk-high/85" /> 转人工
        </span>
        <span className="ml-auto">
          {series[0]?.label} → {series[series.length - 1]?.label}
        </span>
      </figcaption>
    </figure>
  );
}

export function BarList({
  items,
  ariaLabel,
}: {
  items: Array<{ label: string; value: number; share: number; hint?: string; color?: string }>;
  ariaLabel: string;
}) {
  return (
    <ul className="space-y-3" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="text-ink-soft">{it.label}</span>
            <span className="tabular-nums text-ink-muted">
              {it.value}
              {it.hint ? <span className="ml-2 text-xs text-ink-faint">{it.hint}</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, it.share * 100)}%`,
                background: it.color ?? '#2d54d6',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Donut({
  segments,
  centerLabel,
  centerValue,
  ariaLabel,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel: string;
  centerValue: string;
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90" role="img" aria-label={ariaLabel}>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--chart-track)" strokeWidth="14" />
        {segments.map((s) => {
          const length = (s.value / total) * circumference;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="14"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return el;
        })}
      </svg>
      <div className="min-w-0 flex-1">
        <div className="mb-3">
          <div className="label">{centerLabel}</div>
          <div className="text-xl font-semibold text-ink tabular-nums">{centerValue}</div>
        </div>
        <ul className="space-y-1.5 text-sm">
          {segments.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ink-soft">
                <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular-nums text-ink-muted">
                {s.value} · {((s.value / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function TargetBar({
  label,
  value,
  target,
  formatter,
  higherIsBetter = true,
}: {
  label: string;
  value: number;
  target: number;
  formatter: (v: number) => string;
  higherIsBetter?: boolean;
}) {
  const reached = higherIsBetter ? value >= target : value <= target;
  const scale = Math.max(value, target) * 1.15 || 1;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-ink-soft">{label}</span>
        <span className={cn('tabular-nums', reached ? 'text-emerald-600' : 'text-amber-600')}>
          {formatter(value)}
          <span className="ml-2 text-xs text-ink-faint">目标 {formatter(target)}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-full rounded-full', reached ? 'bg-emerald-500' : 'bg-amber-500')}
          style={{ width: `${Math.min(100, (value / scale) * 100)}%` }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-full w-0.5 bg-ink-faint"
          style={{ left: `${Math.min(100, (target / scale) * 100)}%` }}
        />
      </div>
    </div>
  );
}
