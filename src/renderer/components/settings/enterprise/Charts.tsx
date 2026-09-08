/**
 * Charts.tsx — lightweight, dependency-free SVG charts for the org monitoring dashboard.
 * Tokenized (enterprise.css), so they inherit the active theme.
 */

import React, { FC, ReactNode } from 'react';
import './enterprise.css';

// ── Stat card ────────────────────────────────────────────────────────────────

export const StatCard: FC<{
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}> = ({ label, value, sub, icon }) => (
  <div className="ent-stat">
    <p className="ent-stat__label">
      {icon && <span className="ent-stat__icon">{icon}</span>}
      {label}
    </p>
    <div className="ent-stat__value">{value}</div>
    {sub != null && <div className="ent-stat__sub">{sub}</div>}
  </div>
);

// ── Bar chart (events / day over a window) ───────────────────────────────────

const DAY_MS = 86_400_000;

export const BarChart: FC<{
  data: { dayStartMs: number; count: number }[];
  windowDays: number;
}> = ({ data, windowDays }) => {
  // Densify: fill every day in the window (the API only returns days with events).
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const start = today - (windowDays - 1) * DAY_MS;
  const byDay = new Map(data.map((d) => [Math.floor(d.dayStartMs / DAY_MS) * DAY_MS, d.count]));
  const series = Array.from({ length: windowDays }, (_, i) => {
    const ms = start + i * DAY_MS;
    return { ms, count: byDay.get(ms) ?? 0 };
  });
  const max = Math.max(1, ...series.map((s) => s.count));

  const W = 640;
  const H = 150;
  const padB = 18;
  const top = 8;
  const bw = W / windowDays;

  const tickFmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <svg className="ent-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Events per day">
      {/* baseline */}
      <line className="ent-chart-grid" x1="0" y1={H - padB} x2={W} y2={H - padB} />
      {series.map((s, i) => {
        const h = (s.count / max) * (H - padB - top);
        const x = i * bw;
        const y = H - padB - h;
        return (
          <rect
            key={s.ms}
            className="ent-chart-bar"
            x={x + bw * 0.18}
            y={y}
            width={bw * 0.64}
            height={Math.max(0, h)}
            rx="1.5"
          >
            <title>
              {tickFmt(s.ms)} · {s.count}
            </title>
          </rect>
        );
      })}
      {/* first / mid / last date ticks */}
      {[0, Math.floor(windowDays / 2), windowDays - 1].map((i) => (
        <text
          key={i}
          className="ent-chart-axis"
          x={i * bw + bw / 2}
          y={H - 5}
          textAnchor={i === 0 ? 'start' : i === windowDays - 1 ? 'end' : 'middle'}
        >
          {tickFmt(series[i].ms)}
        </text>
      ))}
    </svg>
  );
};

// ── Horizontal bar list (by type, role distribution) ─────────────────────────

export const BarList: FC<{ items: { label: string; count: number }[] }> = ({ items }) => {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="ent-barlist">
      {items.map((it, i) => (
        <div className="ent-barlist__row" key={`${it.label}-${i}`}>
          <span className="ent-barlist__label" title={it.label}>
            {it.label}
          </span>
          <span className="ent-barlist__count">{it.count.toLocaleString()}</span>
          <div className="ent-barlist__track">
            <div className="ent-barlist__fill" style={{ width: `${(it.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
};
