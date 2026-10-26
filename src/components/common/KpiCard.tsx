import React from 'react';
import { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: string;
  unit?: string;
  subtext: string;
  icon: LucideIcon;
  trend?: {
    label: string;
    positive?: boolean;
    neutral?: boolean;
  };
  highlight?: 'default' | 'alert' | 'warning' | 'success';
  onClick?: () => void;
  actionText?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  unit,
  subtext,
  icon: Icon,
  trend,
  highlight = 'default',
  onClick,
  actionText,
}) => {
  let borderClass = 'border-slate-200 hover:border-slate-300 border-t-2 border-t-[#14283F]';
  let iconBg = 'bg-[#F4F6F9] text-[#14283F] border border-slate-200/80';

  if (highlight === 'alert') {
    borderClass = 'border-rose-200 bg-rose-50/25 hover:border-rose-300 border-t-2 border-t-rose-600';
    iconBg = 'bg-rose-100 text-rose-700 border border-rose-200';
  } else if (highlight === 'warning') {
    borderClass = 'border-amber-200 bg-amber-50/20 hover:border-amber-300 border-t-2 border-t-[#F28C28]';
    iconBg = 'bg-amber-100 text-amber-800 border border-amber-200';
  } else if (highlight === 'success') {
    borderClass = 'border-emerald-200 bg-emerald-50/20 hover:border-emerald-300 border-t-2 border-t-emerald-600';
    iconBg = 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  }

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`bg-white rounded-lg border p-4 shadow-2xs transition-all duration-150 text-left ${borderClass} ${
        onClick
          ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#F28C28] focus-visible:outline-none'
          : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider leading-snug">
          {title}
        </span>
        <div className={`p-2 rounded-md ${iconBg} shrink-0`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-2xl font-bold text-[#14283F] font-mono tabular-nums tracking-tight">
          {value}
        </span>
        {unit && <span className="text-xs font-semibold text-slate-500">{unit}</span>}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
        <span className="truncate">{subtext}</span>
        {trend && (
          <span
            className={`font-semibold ml-2 shrink-0 px-1.5 py-0.5 rounded text-[11px] ${
              trend.neutral
                ? 'bg-slate-100 text-slate-700'
                : trend.positive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-rose-50 text-rose-700'
            }`}
          >
            {trend.label}
          </span>
        )}
      </div>

      {actionText && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs text-[#234765] group-hover:text-[#14283F] font-semibold">
          <span>{actionText}</span>
          <span className="text-[#F28C28] font-bold" aria-hidden="true">
            →
          </span>
        </div>
      )}
    </div>
  );
};
