import { useState, type ReactNode } from 'react';
import { formatMoney, isoToBr } from '@compras/shared';

// Small, dependency-free SVG charts for the narrow side panel.
// Series color validated against the panel surface (lightness band, chroma floor, contrast >= 3:1).
const SERIES = '#2563EB';
const GRID = '#E2E8F0';
const AXIS_TEXT = '#5B6478';
const W = 360; // viewBox width; the SVG scales to the panel width

const compactFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
/** "R$ 12,5 mil" for large values, "R$ 598,50" below a thousand. */
const compact = { format: (v: number) => (Math.abs(v) >= 1000 ? compactFmt.format(v) : formatMoney(v, 'BRL')) };

function monthLabel(month: string, withYear = false) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const name = new Date(y, m - 1, 1).toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
  return withYear ? `${name}/${y}` : name;
}

/** Rounds the axis maximum up to a clean number (1, 2, 2.5, 5 × 10^n). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((s) => s * p >= v) ?? 10) * p;
}

function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  // x is in viewBox units; position as a percentage so it tracks the scaled SVG.
  const pct = Math.min(Math.max((x / W) * 100, 18), 82);
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        // Just below the caption, inside the chart: never over the content above.
        top: 20,
        left: `${pct}%`,
        transform: 'translateX(-50%)',
        background: '#172033',
        color: '#fff',
        fontSize: 12,
        lineHeight: 1.4,
        padding: '6px 8px',
        borderRadius: 6,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Purchases per month: columns, one series
// ---------------------------------------------------------------------------

export function MonthlyBars({ data }: { data: { month: string; total: number; orders: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 132;
  const pad = { top: 18, right: 6, bottom: 20, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.total)));
  const band = plotW / data.length;
  const barW = Math.min(24, band - 2); // 2px surface gap between neighbours
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const peak = data.reduce((best, d, i) => (d.total > (data[best]?.total ?? 0) ? i : best), 0);

  return (
    <figure style={{ margin: 0, position: 'relative' }}>
      <figcaption className="small muted" style={{ marginBottom: 4 }}>Compras por mês · últimos 12 meses</figcaption>
      {hover != null && data[hover] && (
        <Tooltip x={pad.left + band * hover + band / 2}>
          <strong>{monthLabel(data[hover]!.month, true)}</strong>
          <br />
          {formatMoney(data[hover]!.total, 'BRL')} · {data[hover]!.orders} pedido(s)
        </Tooltip>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Compras por mês nos últimos 12 meses" onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>{t ? compact.format(t) : '0'}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.left + band * i + band / 2;
          const top = y(d.total);
          const h = pad.top + plotH - top;
          const r = Math.min(4, h, barW / 2);
          const x0 = cx - barW / 2;
          const base = pad.top + plotH;
          return (
            <g key={d.month}>
              {d.total > 0 && (
                // 4px rounded data end, square at the baseline.
                <path
                  d={`M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${base} Z`}
                  fill={SERIES}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              )}
              {(data.length - 1 - i) % 2 === 0 && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={10} fill={AXIS_TEXT}>{monthLabel(d.month)}</text>
              )}
              {i === peak && d.total > 0 && (
                <text x={cx > W - 40 ? cx + barW / 2 : cx} y={top - 5} textAnchor={cx > W - 40 ? 'end' : 'middle'} fontSize={10} fill="#172033">{compact.format(d.total)}</text>
              )}
              {/* Hit target: the whole band, larger than the bar. */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${monthLabel(d.month, true)}: ${formatMoney(d.total, 'BRL')}, ${d.orders} pedido(s)`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Unit price paid over time: line + markers, one product at a time
// ---------------------------------------------------------------------------

type PricePoint = { date: string; unit_price: number; quantity: number; order: string | null };

export function PriceHistory({ series }: { series: { description: string; points: PricePoint[] }[] }) {
  const usable = series.filter((s) => s.points.length > 0);
  const [selected, setSelected] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const current = usable[Math.min(selected, usable.length - 1)];
  if (!current) return null;
  const pts = current.points;

  const H = 120;
  const pad = { top: 16, right: 64, bottom: 20, left: 60 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const times = pts.map((p) => new Date(`${p.date}T12:00:00Z`).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const prices = pts.map((p) => p.unit_price);
  // Prices: a zoomed scale with margin (not from zero), labelled so the range is explicit.
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || hi * 0.1 || 1;
  const yMin = lo - span * 0.25;
  const yMax = hi + span * 0.25;
  const x = (t: number) => pad.left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]!)},${y(p.unit_price)}`).join(' ');
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const change = first.unit_price ? ((last.unit_price - first.unit_price) / first.unit_price) * 100 : 0;

  return (
    <figure style={{ margin: 0, position: 'relative' }}>
      <figcaption className="small muted" style={{ marginBottom: 4 }}>
        Preço unitário pago{pts.length > 1 ? ` · ${change > 0 ? '+' : ''}${change.toFixed(1).replace('.', ',')}% desde ${isoToBr(first.date)}` : ''}
      </figcaption>
      {usable.length > 1 && (
        <div className="row wrap" style={{ gap: 4, marginBottom: 6 }} role="group" aria-label="Produto">
          {usable.map((s, i) => (
            <button
              key={s.description}
              type="button"
              className="chip"
              aria-pressed={i === selected}
              style={{ height: 26, fontSize: 12, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={() => {
                setSelected(i);
                setHover(null);
              }}
            >
              {s.description}
            </button>
          ))}
        </div>
      )}
      {pts.length === 1 ? (
        <span className="small muted">Uma compra nos últimos 12 meses: {formatMoney(last.unit_price, 'BRL')} em {isoToBr(last.date)}.</span>
      ) : (
        <>
          {hover != null && pts[hover] && (
            <Tooltip x={x(times[hover]!)}>
              <strong>{isoToBr(pts[hover]!.date)}</strong>
              {pts[hover]!.order ? ` · pedido ${pts[hover]!.order}` : ''}
              <br />
              {formatMoney(pts[hover]!.unit_price, 'BRL')} × {pts[hover]!.quantity.toLocaleString('pt-BR')}
            </Tooltip>
          )}
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Preço unitário pago por ${current.description}`} onMouseLeave={() => setHover(null)}>
            {[lo, hi].map((t, i) => (
              <g key={i}>
                <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>{compact.format(t)}</text>
              </g>
            ))}
            <text x={pad.left} y={H - 6} fontSize={10} fill={AXIS_TEXT}>{isoToBr(first.date)}</text>
            <text x={W - pad.right} y={H - 6} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>{isoToBr(last.date)}</text>
            <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <g key={i}>
                {/* 2px surface ring keeps markers legible on the line. */}
                <circle cx={x(times[i]!)} cy={y(p.unit_price)} r={hover === i ? 6 : 4} fill={SERIES} stroke="#fff" strokeWidth={2} />
                <circle
                  cx={x(times[i]!)}
                  cy={y(p.unit_price)}
                  r={14}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${isoToBr(p.date)}: ${formatMoney(p.unit_price, 'BRL')}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            ))}
            {/* End label: the latest price. */}
            <text x={x(times[times.length - 1]!) + 8} y={y(last.unit_price) + 4} fontSize={11} fill="#172033">{compact.format(last.unit_price)}</text>
          </svg>
        </>
      )}
    </figure>
  );
}
