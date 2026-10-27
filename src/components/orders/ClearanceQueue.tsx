import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { OrderJourney } from '../../types/mis';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Callout, EmptyState } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Tooltip } from '@/components/ui/overlays';
import { formatDate, formatINR, formatNumber } from '@/lib/utils';

type Kind = 'quality' | 'finance';

/**
 * Pieces counted beyond what was produced (passed + rejected - produced). Blueprint: such
 * a lot is held until the mismatch is explained; quantities are never corrected silently.
 */
export function qualityDiscrepancy(order: OrderJourney): number {
  return (order.lineItems || []).reduce((sum, li) => {
    const excess = (li.inspectedOkQty || 0) + (li.rejectedQty || 0) - (li.producedQty || 0);
    return sum + (excess > 0 ? excess : 0);
  }, 0);
}

const QUALITY_STAGES = ['quality_pending', 'quality_cleared', 'clearance_pending', 'clearance_approved', 'ready_for_dispatch', 'partially_dispatched'];

/**
 * Open orders waiting for this department's dispatch clearance. Quality sees orders that
 * have reached inspection; Finance sees orders Quality has already cleared.
 */
export function ClearanceQueue({ kind }: { kind: Kind }) {
  const { currentUser, salesOrders, outstandingAgeing, setOrderClearance } = useRtdb();
  const [busy, setBusy] = useState<string | null>(null);
  const mayGive = (kind === 'quality' ? ['quality', 'ceo', 'super_admin'] : ['finance', 'ceo', 'super_admin']).includes(currentUser.role);

  const rows = useMemo(() => {
    const open = salesOrders.filter((o) => o.status !== 'completed');
    return kind === 'quality'
      ? open.filter((o) => !o.qualityClearedBy && QUALITY_STAGES.includes(o.status))
      : open.filter((o) => o.qualityClearedBy && !o.financeClearedBy);
  }, [salesOrders, kind]);

  const give = async (o: OrderJourney) => {
    setBusy(o.id);
    const res = await setOrderClearance(o.id, kind, true);
    setBusy(null);
    if (res.success) toast.success(`${kind === 'quality' ? 'Quality' : 'Finance'} clearance given`, { description: `${o.jobNumber} · ${o.customerName}` });
    else toast.error('Clearance not saved', { description: res.error || 'Please try again.' });
  };

  const columns: Column<OrderJourney>[] = [
    { id: 'job', header: 'Job', sortValue: (o) => o.jobNumber, cell: (o) => <span className="whitespace-nowrap font-mono text-xs font-semibold">{o.jobNumber}</span> },
    { id: 'customer', header: 'Customer', sortValue: (o) => o.customerName, cell: (o) => <span className="line-clamp-2 min-w-32">{o.customerName}</span> },
    kind === 'quality'
      ? {
          id: 'qc',
          header: 'Passed / produced',
          align: 'right',
          cell: (o) => {
            const li = o.lineItems?.[0];
            const excess = qualityDiscrepancy(o);
            return li ? (
              <div className="whitespace-nowrap text-right">
                <span className="font-mono">
                  {formatNumber(li.inspectedOkQty)} / {formatNumber(li.producedQty)}
                  {li.rejectedQty > 0 && <span className="ml-1 text-xs text-muted-foreground">+{formatNumber(li.rejectedQty)} rej.</span>}
                </span>
                {excess > 0 && (
                  <Badge tone="danger" className="ml-2">
                    {formatNumber(excess)} pcs over produced
                  </Badge>
                )}
              </div>
            ) : (
              '—'
            );
          },
        }
      : {
          id: 'credit',
          header: 'Customer outstanding',
          align: 'right',
          cell: (o) => {
            const a = outstandingAgeing.find((r) => r.customerId === o.customerId || r.customerName === o.customerName);
            if (!a) return <span className="text-muted-foreground">No dues</span>;
            const overdue = (a.bucket61to90 || 0) + (a.bucket90Plus || 0);
            return (
              <div className="whitespace-nowrap text-right">
                <p className="font-mono">{formatINR(a.totalOutstanding, { compact: true })}</p>
                {overdue > 0 && <p className="text-xs text-destructive">{formatINR(overdue, { compact: true })} over 60 days</p>}
                {(a.creditExceeded || a.creditLimitExceeded) && <Badge tone="danger" className="mt-1">Credit limit exceeded</Badge>}
              </div>
            );
          },
        },
    { id: 'due', header: 'Delivery', hideBelow: 'md', sortValue: (o) => o.targetDeliveryDate || '', cell: (o) => <span className="whitespace-nowrap">{formatDate(o.targetDeliveryDate)}</span> },
    ...(mayGive
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (o: OrderJourney) => {
              const excess = kind === 'quality' ? qualityDiscrepancy(o) : 0;
              const button = (
                <Button size="sm" variant="bronze" loading={busy === o.id} disabled={excess > 0} onClick={() => give(o)}>
                  <CheckCircle2 /> Clear
                </Button>
              );
              return excess > 0 ? (
                <Tooltip content={`Passed + rejected is ${formatNumber(excess)} pieces more than produced. Recount or re-inspect, correct the record, then clear.`}>
                  <span tabIndex={0}>{button}</span>
                </Tooltip>
              ) : (
                button
              );
            },
          },
        ]
      : []),
  ];

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-bronze-600" aria-hidden="true" />
            {kind === 'quality' ? 'Quality clearance queue' : 'Finance clearance queue'}
          </CardTitle>
          <CardDescription>
            {kind === 'quality'
              ? 'Orders at or past inspection that need quality clearance before they can ship.'
              : 'Quality-cleared orders waiting for finance clearance. Check dues before clearing.'}
          </CardDescription>
        </div>
        {rows.length > 0 && <Badge tone="warning">{rows.length} waiting</Badge>}
      </CardHeader>
      <CardContent className="p-0">
        {kind === 'quality' && rows.some((o) => qualityDiscrepancy(o) > 0) && (
          <div className="px-5 pb-4">
            <Callout
              tone="danger"
              title="Quantity mismatch on some lots"
              why="Passed plus rejected pieces add up to more than were produced. These lots stay on hold and cannot be cleared."
              next="Recount or re-inspect the lot, correct the produced, passed or rejected figure, then clear it."
            />
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing waiting" description="Every eligible order already has this clearance." />
        ) : (
          <DataTable className="rounded-none border-0 border-t shadow-none" rows={rows} columns={columns} rowKey={(o) => o.id} initialSort={{ id: 'due' }} pageSize={8} />
        )}
      </CardContent>
    </Card>
  );
}
