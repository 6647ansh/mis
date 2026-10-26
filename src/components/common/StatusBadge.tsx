import React from 'react';

interface StatusBadgeProps {
  status: string;
  label?: string;
  type?: 'order' | 'material' | 'quality' | 'clearance' | 'dispatch' | 'invoice' | 'severity';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, type = 'order' }) => {
  const displayLabel = label || status.replace(/_/g, ' ');

  // Return clean, unboxed or crisp bordered badge with semantic indicator
  let colorClass = 'text-slate-700 bg-slate-100 border-slate-200';
  let indicatorColor = 'bg-slate-400';

  const s = status.toLowerCase();

  if (
    s.includes('cleared') ||
    s.includes('approved') ||
    s.includes('completed') ||
    s.includes('adequate') ||
    s.includes('synced') ||
    s.includes('low')
  ) {
    colorClass = 'text-emerald-800 bg-emerald-50 border-emerald-200';
    indicatorColor = 'bg-emerald-600';
  } else if (
    s.includes('pending') ||
    s.includes('partial') ||
    s.includes('warning') ||
    s.includes('in_progress') ||
    s.includes('medium') ||
    s.includes('job_assigned')
  ) {
    colorClass = 'text-amber-800 bg-amber-50 border-amber-200';
    indicatorColor = 'bg-amber-500';
  } else if (
    s.includes('shortage') ||
    s.includes('rejected') ||
    s.includes('critical') ||
    s.includes('high') ||
    s.includes('overdue') ||
    s.includes('on_hold')
  ) {
    colorClass = 'text-rose-800 bg-rose-50 border-rose-200';
    indicatorColor = 'bg-rose-600';
  } else if (s.includes('verified') || s.includes('allocated') || s.includes('ready')) {
    colorClass = 'text-blue-800 bg-blue-50 border-blue-200';
    indicatorColor = 'bg-blue-600';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border ${colorClass} whitespace-nowrap shrink-0`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${indicatorColor} shrink-0`} aria-hidden="true" />
      <span className="capitalize">{displayLabel}</span>
    </span>
  );
};
