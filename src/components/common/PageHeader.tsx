import React from 'react';

interface PageHeaderProps {
  category?: string;
  title: string;
  description: string;
  badge?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryActions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  category,
  title,
  description,
  badge,
  primaryAction,
  secondaryActions,
}) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 border-t-4 border-t-[#14283F] shadow-2xs p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div className="space-y-1 max-w-3xl">
        {category && (
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#234765]">
            <span>{category}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold tracking-tight text-[#14283F]">
            {title}
          </h1>
          {badge}
        </div>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{description}</p>
      </div>

      {(secondaryActions || primaryAction) && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </div>
  );
};
