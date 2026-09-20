import React from 'react';

/** Small, unopinionated primitives shared across every tab. */

export function Card({ children, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur-sm ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

const TONES = {
  pink: 'bg-brand-pink/10 text-brand-pink ring-brand-pink/20',
  teal: 'bg-brand-teal/10 text-brand-teal ring-brand-teal/20',
  green: 'bg-brand-green/10 text-brand-green-dark ring-brand-green/25',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Badge({ tone = 'slate', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        TONES[tone] || TONES.slate
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone = 'slate', icon = null }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === 'green'
            ? 'text-brand-green-dark'
            : tone === 'pink'
            ? 'text-brand-pink'
            : tone === 'teal'
            ? 'text-brand-teal'
            : 'text-slate-900'
        }`}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export function SectionTitle({ children, action = null }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, icon = '·' }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg shadow-sm">
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {children ? <p className="mt-1 text-xs text-slate-500">{children}</p> : null}
    </div>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base',
  };
  const variants = {
    primary: 'bg-brand-pink text-white hover:bg-brand-pink-dark focus-visible:ring-brand-pink',
    teal: 'bg-brand-teal text-white hover:bg-brand-teal-dark focus-visible:ring-brand-teal',
    green: 'bg-brand-green text-white hover:bg-brand-green-dark focus-visible:ring-brand-green',
    ghost: 'bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Circular score meter used for driver and route safety scores. */
export function ScoreRing({ score, size = 56, label = null }) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const colour = clamped >= 75 ? '#16a34a' : clamped >= 55 ? '#d97706' : '#e11d48';

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth="6" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-slate-800">{Math.round(clamped)}</span>
        {label ? <span className="text-[9px] uppercase text-slate-400">{label}</span> : null}
      </div>
    </div>
  );
}

/** Horizontal bar for a named 0–100 component of a composite score. */
export function MeterBar({ label, value, hint, tone = 'teal' }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  const bg =
    tone === 'green' ? 'bg-brand-green' : tone === 'pink' ? 'bg-brand-pink' : 'bg-brand-teal';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="tabular-nums font-semibold text-slate-800">{Math.round(clamped)}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${bg} transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ className = '' }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
  );
}
