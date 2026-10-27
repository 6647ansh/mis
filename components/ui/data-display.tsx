import * as React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Info, Inbox, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Page title row: what this screen is for, plus its main actions. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 flex flex-wrap items-center gap-2">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A single KPI. `onClick` makes the whole tile a link to its module. */
export function StatTile({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = 'neutral',
  onClick,
  restricted,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'bronze';
  onClick?: () => void;
  /** Shown instead of the value when the viewer's role may not see it. */
  restricted?: boolean;
}) {
  const toneRing = {
    neutral: 'text-slate-600 bg-muted',
    success: 'text-success bg-success-soft',
    warning: 'text-warning bg-warning-soft',
    danger: 'text-destructive bg-danger-soft',
    bronze: 'text-bronze-700 bg-bronze-50',
  }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-card',
        onClick &&
          'cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-slate-300 hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', toneRing)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {restricted ? '—' : value}
        </span>
        {unit && !restricted && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
      </div>
      {(hint || restricted) && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{restricted ? 'Not visible for your role' : hint}</span>
          {onClick && <ArrowRight className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />}
        </div>
      )}
    </Comp>
  );
}

/**
 * Actionable alert: what happened, why it matters, what to do next, where to fix it.
 */
export function Callout({
  tone = 'info',
  title,
  why,
  next,
  action,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title: React.ReactNode;
  why?: React.ReactNode;
  next?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: { box: 'border-blue-200 bg-info-soft', icon: Info, iconClass: 'text-info' },
    success: { box: 'border-emerald-200 bg-success-soft', icon: CheckCircle2, iconClass: 'text-success' },
    warning: { box: 'border-amber-200 bg-warning-soft', icon: AlertTriangle, iconClass: 'text-warning' },
    danger: { box: 'border-red-200 bg-danger-soft', icon: XCircle, iconClass: 'text-destructive' },
  }[tone];
  const Icon = styles.icon;
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', styles.box, className)}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', styles.iconClass)} aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        {why && <p className="text-slate-700">{why}</p>}
        {next && <p className="text-slate-700"><span className="font-medium">Next: </span>{next}</p>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="mt-1 text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} aria-hidden="true" />;
}
