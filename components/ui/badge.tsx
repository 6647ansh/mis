import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 [&_svg]:size-3',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-slate-700',
        success: 'border-emerald-200 bg-success-soft text-success',
        warning: 'border-amber-200 bg-warning-soft text-warning',
        danger: 'border-red-200 bg-danger-soft text-destructive',
        info: 'border-blue-200 bg-info-soft text-info',
        bronze: 'border-bronze-200 bg-bronze-50 text-bronze-700',
        navy: 'border-slate-900 bg-primary text-primary-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Shows a small status dot before the label. */
  dot?: boolean;
}

function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
