import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldAlert,
  ArrowRight,
  X,
} from 'lucide-react';

export type AlertSeverity = 'critical' | 'error' | 'warning' | 'info' | 'success';

/**
 * Converts technical or zero-indexed system strings into concise, plain-English messages
 * suitable for shop-floor operators, sales staff, and executives.
 */
export function formatHumanReadableMessage(rawMessage: string): string {
  if (!rawMessage) return '';
  let formatted = rawMessage;

  // Replace zero-indexed or raw line item identifiers (e.g., "Line item 0", "Line item ITEM-01")
  formatted = formatted.replace(/Line item 0\b/gi, 'Item #1');
  formatted = formatted.replace(/Line item (\d+)/gi, (_, idx) => `Item #${Number(idx) + 1}`);
  formatted = formatted.replace(/Line item (ITEM-0?)(\d+)/gi, 'Item #$2');
  formatted = formatted.replace(/Line item (LI-\d+)/gi, 'Order Line Item ($1)');

  // Replace camelCase field names with plain English terms
  formatted = formatted
    .replace(/\binspectedOkQty\b/g, 'QC Passed Qty')
    .replace(/\brejectedQty\b/g, 'Rejected Qty')
    .replace(/\bproducedQty\b/g, 'Forged Output Qty')
    .replace(/\bdispatchedQty\b/g, 'Dispatched Qty')
    .replace(/\borderedQty\b/g, 'Ordered Qty')
    .replace(/\bpendingQty\b/g, 'Pending Balance')
    .replace(/\btotalShippedQty\b/g, 'Total Shipped Qty')
    .replace(/\bbalanceQty\b/g, 'Balance Qty')
    .replace(/\bavailableStockMt\b/g, 'Free Available Stock')
    .replace(/\bcurrentStockMt\b/g, 'Physical Stock')
    .replace(/\breservedStockMt\b/g, 'Reserved Job Stock')
    .replace(/\bminimumStockMt\b/g, 'Minimum Safety Stock')
    .replace(/\breorderLevelMt\b/g, 'Reorder Level')
    .replace(/\bpassedQty\b/g, 'Passed Qty')
    .replace(/\binspectedQty\b/g, 'Inspected Qty')
    .replace(/!==/g, 'does not match');

  return formatted;
}

export interface AlertBannerProps {
  severity: AlertSeverity;
  title: string;
  message: string;
  reference?: string;
  actionLabel?: string;
  onAction?: () => void;
  suggestedAction?: string;
  actionText?: string;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: (e: React.MouseEvent) => void;
  compact?: boolean;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  severity,
  title,
  message,
  reference,
  actionLabel,
  onAction,
  suggestedAction,
  actionText,
  actions,
  onDismiss,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
}) => {
  const cleanMessage = formatHumanReadableMessage(message);
  const resolvedSuggestedAction = suggestedAction || actionText;

  const styles = {
    critical: {
      container: 'bg-rose-50/90 border-rose-200 text-rose-950',
      badge: 'bg-rose-100 text-rose-800 border-rose-300',
      badgeLabel: 'Critical',
      iconColor: 'text-rose-600',
      refBadge: 'bg-white/90 text-rose-900 border-rose-200',
      primaryBtn: 'bg-rose-700 hover:bg-rose-800 text-white',
      Icon: ShieldAlert,
    },
    error: {
      container: 'bg-rose-50/90 border-rose-200 text-rose-950',
      badge: 'bg-rose-100 text-rose-800 border-rose-300',
      badgeLabel: 'Action Required',
      iconColor: 'text-rose-600',
      refBadge: 'bg-white/90 text-rose-900 border-rose-200',
      primaryBtn: 'bg-rose-700 hover:bg-rose-800 text-white',
      Icon: ShieldAlert,
    },
    warning: {
      container: 'bg-amber-50/90 border-amber-200 text-amber-950',
      badge: 'bg-amber-100 text-amber-900 border-amber-300',
      badgeLabel: 'Warning',
      iconColor: 'text-amber-600',
      refBadge: 'bg-white/90 text-amber-900 border-amber-200',
      primaryBtn: 'bg-[#14283F] hover:bg-[#234765] text-white',
      Icon: AlertTriangle,
    },
    info: {
      container: 'bg-blue-50/90 border-blue-200 text-slate-900',
      badge: 'bg-blue-100 text-blue-800 border-blue-300',
      badgeLabel: 'Information',
      iconColor: 'text-blue-600',
      refBadge: 'bg-white/90 text-blue-900 border-blue-200',
      primaryBtn: 'bg-[#14283F] hover:bg-[#234765] text-white',
      Icon: Info,
    },
    success: {
      container: 'bg-emerald-50/90 border-emerald-200 text-emerald-950',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      badgeLabel: 'Completed',
      iconColor: 'text-emerald-600',
      refBadge: 'bg-white/90 text-emerald-900 border-emerald-200',
      primaryBtn: 'bg-emerald-700 hover:bg-emerald-800 text-white',
      Icon: CheckCircle2,
    },
  }[severity];

  const IconComponent = styles.Icon;

  return (
    <div
      className={`rounded-lg border ${styles.container} ${
        compact ? 'p-3' : 'p-4'
      } transition-all shadow-2xs`}
      role="status"
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <IconComponent className={`w-4 h-4 ${styles.iconColor} shrink-0 mt-0.5`} />
          <div className="space-y-1.5 flex-1 min-w-0">
            {/* 1. Title & Severity Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${styles.badge}`}
              >
                {styles.badgeLabel}
              </span>
              <h4 className="text-xs font-bold text-slate-900 leading-snug">
                {formatHumanReadableMessage(title)}
              </h4>
            </div>

            {/* 2. Plain-English Message */}
            <p className="text-xs text-slate-700 leading-relaxed">{cleanMessage}</p>

            {/* 3. Reference & Suggested Action */}
            {(reference || resolvedSuggestedAction) && (
              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                {reference && (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono font-medium ${styles.refBadge}`}
                  >
                    <span>Ref:</span>
                    <strong>{reference}</strong>
                  </span>
                )}
                {resolvedSuggestedAction && (
                  <span className="text-slate-600 font-medium">
                    Next Step: <strong className="text-slate-800">{resolvedSuggestedAction}</strong>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 4. Action Buttons / Dismiss */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
          {actions}
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="px-2.5 py-1.5 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-md transition-colors cursor-pointer"
            >
              {secondaryActionLabel}
            </button>
          )}
          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 cursor-pointer ${styles.primaryBtn}`}
            >
              <span>{actionLabel}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors cursor-pointer"
              aria-label="Dismiss message"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
