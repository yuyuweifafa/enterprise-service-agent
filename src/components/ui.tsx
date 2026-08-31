import type { ReactNode } from 'react';
import type { ApprovalStatus, Domain, RiskLevel, TicketStatus } from '@/lib/types';
import {
  APPROVAL_STATUS_CLASS,
  APPROVAL_STATUS_LABEL,
  DOMAIN_CLASS,
  DOMAIN_LABEL,
  RISK_CLASS,
  RISK_SHORT,
  TICKET_STATUS_CLASS,
  TICKET_STATUS_LABEL,
  cn,
} from '@/lib/format';

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('chip border-line bg-surface-2 text-ink-muted', className)}>{children}</span>;
}

export function DomainBadge({ domain }: { domain: Domain }) {
  return <span className={cn('chip', DOMAIN_CLASS[domain])}>{DOMAIN_LABEL[domain]}</span>;
}

export function RiskBadge({ level, withLabel = true }: { level: RiskLevel; withLabel?: boolean }) {
  return (
    <span className={cn('chip', RISK_CLASS[level])}>
      <span aria-hidden className="text-[9px]">
        ●
      </span>
      {withLabel ? `${RISK_SHORT[level]}风险` : RISK_SHORT[level]}
    </span>
  );
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={cn('chip', TICKET_STATUS_CLASS[status])}>{TICKET_STATUS_LABEL[status]}</span>;
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  return <span className={cn('chip', APPROVAL_STATUS_CLASS[status])}>{APPROVAL_STATUS_LABEL[status]}</span>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  footer,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
  footer?: ReactNode;
}) {
  const toneClass = {
    default: 'text-ink',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }[tone];
  return (
    <div className="card-pad">
      <div className="label">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tabular-nums', toneClass)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-ink-faint">{hint}</div> : null}
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  actions,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('card overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-2/50 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-faint">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line bg-canvas py-10 text-center">
      <p className="text-sm text-ink-muted">{title}</p>
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label = '加载中' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-ink-muted">
      <span
        aria-hidden
        className="h-3 w-3 animate-spin rounded-full border-2 border-line border-t-brand"
      />
      {label}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

export function KeyValue({ items }: { items: Array<{ k: string; v: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.k} className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
          <dt className="text-xs text-ink-faint">{it.k}</dt>
          <dd className="text-right text-sm text-ink-soft">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
