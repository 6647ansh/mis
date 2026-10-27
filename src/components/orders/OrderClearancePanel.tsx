import React, { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { OrderJourney } from '../../types/mis';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';

type Kind = 'quality' | 'finance';

const COPY: Record<Kind, { label: string; roles: string[]; giveHint: string }> = {
  quality: { label: 'Quality clearance', roles: ['quality', 'ceo', 'super_admin'], giveHint: 'Inspection and MTC are complete for this order.' },
  finance: { label: 'Finance clearance', roles: ['finance', 'ceo', 'super_admin'], giveHint: 'Payment terms or credit allow this order to ship.' },
};

/** Both clearances are required before Dispatch can create a consignment (Montex rule). */
export function OrderClearancePanel({ order }: { order: OrderJourney }) {
  const { currentUser, usersList, setOrderClearance } = useRtdb();
  const [busy, setBusy] = useState<Kind | null>(null);

  const nameOf = (uid?: string | null) => {
    if (!uid) return '';
    if (uid === currentUser.uid) return 'you';
    const u = usersList.find((x) => x.uid === uid || x.id === uid);
    return u?.displayName || u?.name || 'an approver';
  };

  const toggle = async (kind: Kind, give: boolean) => {
    setBusy(kind);
    const res = await setOrderClearance(order.id, kind, give);
    setBusy(null);
    if (res.success) {
      toast.success(`${COPY[kind].label} ${give ? 'given' : 'withdrawn'}`, { description: order.jobNumber });
    } else {
      toast.error(`${COPY[kind].label} not saved`, { description: res.error || 'Please try again.' });
    }
  };

  const ready = Boolean(order.qualityClearedBy && order.financeClearedBy);

  return (
    <section aria-label="Dispatch clearances" className="rounded-xl border border-border">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-bronze-600" aria-hidden="true" />
          <h3 className="text-sm font-semibold">Dispatch clearances</h3>
        </div>
        <span className={`text-xs font-semibold ${ready ? 'text-success' : 'text-muted-foreground'}`}>
          {ready ? 'Ready to dispatch' : 'Dispatch blocked'}
        </span>
      </header>
      <ul className="divide-y divide-border">
        {(['quality', 'finance'] as Kind[]).map((kind) => {
          const by = kind === 'quality' ? order.qualityClearedBy : order.financeClearedBy;
          const at = kind === 'quality' ? order.qualityClearedAt : order.financeClearedAt;
          const mayChange = COPY[kind].roles.includes(currentUser.role);
          return (
            <li key={kind} className="flex items-center gap-3 px-4 py-3">
              {by ? (
                <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{COPY[kind].label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {by ? `Given by ${nameOf(by)} on ${formatDate(at)}` : mayChange ? COPY[kind].giveHint : 'Not given yet'}
                </p>
              </div>
              {mayChange &&
                (by ? (
                  <Button size="sm" variant="ghost" loading={busy === kind} onClick={() => toggle(kind, false)}>
                    Withdraw
                  </Button>
                ) : (
                  <Button size="sm" variant="bronze" loading={busy === kind} onClick={() => toggle(kind, true)}>
                    Give clearance
                  </Button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
