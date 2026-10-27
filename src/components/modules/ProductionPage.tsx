import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Factory, Flame, Gauge, MoreHorizontal, Plus, Timer, Wrench, Zap } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type {
  FurnaceBatchLog,
  MachineMaintenanceTicket,
  OrderJourney,
  PowerConsumptionLog,
  PpcScheduleEntry,
  ShopMachineLog,
} from '../../types/mis';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlays';
import { cn, formatDate, formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const WRITERS = ['super_admin', 'ceo', 'stores'];
const FURNACE_WRITERS = ['super_admin', 'ceo', 'stores', 'quality'];
const SHIFTS: ShopMachineLog['shift'][] = ['Shift A (06:00-14:00)', 'Shift B (14:00-22:00)', 'Shift C (22:00-06:00)'];
const SHIFT_MINUTES = 480;
const FUEL_UNIT: Record<FurnaceBatchLog['fuelType'], FurnaceBatchLog['fuelUnit']> = {
  'PNG (Natural Gas)': 'SCM',
  'LDO (Light Diesel Oil)': 'Liters',
  'Electric Induction': 'kWh',
};
const TICKET_STATUS: Record<MachineMaintenanceTicket['status'], { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  in_repair: { tone: 'danger', label: 'In repair' },
  awaiting_spares: { tone: 'warning', label: 'Awaiting spares' },
  resolved: { tone: 'success', label: 'Resolved' },
};

type Kind = 'shift' | 'furnace' | 'maintenance' | 'power';
type WriteRes = { success: boolean; error?: string; warning?: string };

const digits = (v: string) => v.replace(/[^0-9]/g, '');
const decimal = (v: string) => v.replace(/[^0-9.]/g, '');
const machineId = (name: string) => `MCH-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;

function notify(res: WriteRes, ok: string, detail?: string) {
  if (!res.success) toast.error('Not saved', { description: res.error || 'Please try again.' });
  else if (res.warning) toast.warning(ok, { description: res.warning });
  else toast.success(ok, { description: detail });
  return res.success;
}

export function ProductionPage() {
  const { currentUser, salesOrders, machineLogs, furnaceLogs, maintenanceTickets, powerLogs, ppcSchedules, alertThresholds, updateMaintenanceTicketStatus } = useRtdb();
  const active = currentUser.accountStatus === 'active';
  const canWrite = active && WRITERS.includes(currentUser.role);
  const canFurnace = active && FURNACE_WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('shifts');
  const [dialog, setDialog] = useState<Kind | null>(null);

  const openOrders = useMemo(() => salesOrders.filter((o) => o.status !== 'completed'), [salesOrders]);
  const today = todayIso();
  const month = today.slice(0, 7);
  const todays = machineLogs.filter((m) => m.date === today);
  const monthLogs = machineLogs.filter((m) => m.date?.startsWith(month));
  const monthOk = monthLogs.reduce((s, m) => s + m.okPcs, 0);
  const monthRej = monthLogs.reduce((s, m) => s + m.rejectedPcs + m.reworkPcs, 0);
  const openTickets = maintenanceTickets.filter((t) => t.status !== 'resolved');
  const machineNames = useMemo(
    () => Array.from(new Set([...machineLogs.map((m) => m.machineName), ...maintenanceTickets.map((t) => t.machineName)].filter(Boolean))).sort(),
    [machineLogs, maintenanceTickets]
  );
  const furnaceNames = useMemo(() => Array.from(new Set(furnaceLogs.map((f) => f.furnaceName).filter(Boolean))).sort(), [furnaceLogs]);

  const setTicket = async (t: MachineMaintenanceTicket, status: MachineMaintenanceTicket['status']) => {
    notify(await updateMaintenanceTicketStatus(t, status), `${t.machineName}: ${TICKET_STATUS[status].label.toLowerCase()}`);
  };

  const shiftCols: Column<ShopMachineLog>[] = [
    {
      id: 'when',
      header: 'Date / shift',
      sortValue: (m) => `${m.date} ${m.shift}`,
      cell: (m) => (
        <div className="whitespace-nowrap">
          <p>{formatDate(m.date)}</p>
          <p className="text-xs text-muted-foreground">{m.shift.split(' ')[0]} {m.shift.split(' ')[1]}</p>
        </div>
      ),
    },
    {
      id: 'machine',
      header: 'Machine',
      sortValue: (m) => m.machineName,
      cell: (m) => (
        <div className="max-w-56">
          <p className="truncate">{m.machineName}</p>
          <p className="truncate text-xs text-muted-foreground">{m.operatorName || '—'}</p>
        </div>
      ),
    },
    { id: 'job', header: 'Job', hideBelow: 'md', cell: (m) => <span className="whitespace-nowrap font-mono text-xs">{m.jobNumber || '—'}</span> },
    { id: 'ok', header: 'OK', align: 'right', sortValue: (m) => m.okPcs, cell: (m) => <span className="font-mono">{formatNumber(m.okPcs)}</span> },
    {
      id: 'rej',
      header: 'Rej / rework',
      align: 'right',
      hideBelow: 'sm',
      cell: (m) => (
        <span className={cn('font-mono', m.rejectedPcs + m.reworkPcs > 0 && 'text-destructive')}>
          {formatNumber(m.rejectedPcs)} / {formatNumber(m.reworkPcs)}
        </span>
      ),
    },
    { id: 'down', header: 'Downtime', align: 'right', hideBelow: 'lg', sortValue: (m) => m.downtimeMinutes, cell: (m) => <span className="font-mono">{formatNumber(m.downtimeMinutes)} min</span> },
  ];

  const furnaceCols: Column<FurnaceBatchLog>[] = [
    { id: 'when', header: 'Date', sortValue: (f) => f.date, cell: (f) => <span className="whitespace-nowrap">{formatDate(f.date)}</span> },
    {
      id: 'furnace',
      header: 'Furnace / charge',
      cell: (f) => (
        <div className="max-w-56">
          <p className="truncate">{f.furnaceName}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{[f.batchNumber, f.jobNumber, f.heatNumber && `Heat ${f.heatNumber}`].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'mt', header: 'Charge', align: 'right', hideBelow: 'sm', cell: (f) => <span className="whitespace-nowrap font-mono">{formatNumber(f.chargeWeightMt, 2)} MT</span> },
    {
      id: 'temp',
      header: 'Peak / target °C',
      align: 'right',
      cell: (f) => (
        <span className={cn('whitespace-nowrap font-mono', f.status === 'temp_deviation' && 'font-semibold text-destructive')}>
          {formatNumber(f.peakRecordedTempC)} / {formatNumber(f.targetTempC)}
        </span>
      ),
    },
    { id: 'fuel', header: 'Fuel per MT', align: 'right', hideBelow: 'lg', cell: (f) => <span className="whitespace-nowrap font-mono">{formatNumber(f.specificFuelPerMt, 1)} {f.fuelUnit}</span> },
    { id: 'st', header: 'Status', hideBelow: 'md', cell: (f) => <Badge tone={f.status === 'temp_deviation' ? 'danger' : 'success'}>{f.status === 'temp_deviation' ? 'Temp deviation' : 'Within spec'}</Badge> },
  ];

  const ticketCols: Column<MachineMaintenanceTicket>[] = [
    { id: 'when', header: 'Date', sortValue: (t) => t.ticketDate, cell: (t) => <span className="whitespace-nowrap">{formatDate(t.ticketDate)}</span> },
    {
      id: 'machine',
      header: 'Machine / issue',
      cell: (t) => (
        <div className="max-w-72">
          <p className="font-medium">{t.machineName}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{t.issueDescription}</p>
        </div>
      ),
    },
    { id: 'type', header: 'Type', hideBelow: 'md', cell: (t) => t.maintenanceType },
    { id: 'down', header: 'Downtime', align: 'right', hideBelow: 'sm', sortValue: (t) => t.downtimeMinutes, cell: (t) => <span className="whitespace-nowrap font-mono">{formatNumber(t.downtimeMinutes)} min</span> },
    { id: 'cost', header: 'Cost', align: 'right', hideBelow: 'lg', cell: (t) => <span className="font-mono">{t.maintenanceCostInr ? formatINR(t.maintenanceCostInr) : '—'}</span> },
    { id: 'st', header: 'Status', cell: (t) => <Badge tone={TICKET_STATUS[t.status]?.tone}>{TICKET_STATUS[t.status]?.label || t.status}</Badge> },
    ...(canWrite
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (t: MachineMaintenanceTicket) =>
              t.status === 'resolved' ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Update ticket for ${t.machineName}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {t.status !== 'awaiting_spares' && <DropdownMenuItem onSelect={() => setTicket(t, 'awaiting_spares')}>Awaiting spares</DropdownMenuItem>}
                    {t.status !== 'in_repair' && <DropdownMenuItem onSelect={() => setTicket(t, 'in_repair')}>In repair</DropdownMenuItem>}
                    <DropdownMenuItem onSelect={() => setTicket(t, 'resolved')}>Mark resolved</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
          },
        ]
      : []),
  ];

  const powerCols: Column<PowerConsumptionLog>[] = [
    { id: 'when', header: 'Date', sortValue: (p) => p.date, cell: (p) => <span className="whitespace-nowrap">{formatDate(p.date)}</span> },
    { id: 'kwh', header: 'kWh', align: 'right', sortValue: (p) => p.totalKwh, cell: (p) => <span className="font-mono">{formatNumber(p.totalKwh)}</span> },
    { id: 'mt', header: 'Output', align: 'right', hideBelow: 'sm', cell: (p) => <span className="whitespace-nowrap font-mono">{formatNumber(p.forgedOutputMt, 2)} MT</span> },
    {
      id: 'sec',
      header: 'kWh per MT',
      align: 'right',
      sortValue: (p) => p.specificEnergyKwhPerMt,
      cell: (p) => {
        const over = p.targetKwhPerMt && p.specificEnergyKwhPerMt > p.targetKwhPerMt;
        return (
          <div className="whitespace-nowrap text-right font-mono">
            <span className={over ? 'font-semibold text-destructive' : ''}>{formatNumber(p.specificEnergyKwhPerMt, 1)}</span>
            {p.targetKwhPerMt ? <p className="text-xs text-muted-foreground">target {formatNumber(p.targetKwhPerMt)}</p> : null}
          </div>
        );
      },
    },
    { id: 'pf', header: 'PF', align: 'right', hideBelow: 'md', cell: (p) => <span className="font-mono">{p.powerFactor ? p.powerFactor.toFixed(3) : '—'}</span> },
    { id: 'cost', header: 'Cost', align: 'right', hideBelow: 'lg', cell: (p) => <span className="font-mono">{p.electricityCostInr ? formatINR(p.electricityCostInr) : '—'}</span> },
  ];

  const ppcCols: Column<PpcScheduleEntry>[] = [
    {
      id: 'job',
      header: 'Job',
      sortValue: (s) => s.plannedStartDate,
      cell: (s) => (
        <div className="max-w-60">
          <p className="font-mono text-xs font-semibold">{s.jobNumber}</p>
          <p className="truncate text-xs text-muted-foreground">{s.customerName}</p>
        </div>
      ),
    },
    { id: 'machine', header: 'Machine', hideBelow: 'md', cell: (s) => s.assignedMachineName || s.machineName || '—' },
    {
      id: 'dates',
      header: 'Planned',
      hideBelow: 'sm',
      cell: (s) => (
        <span className="whitespace-nowrap">
          {formatDate(s.plannedStartDate)} → {formatDate(s.plannedEndDate)}
        </span>
      ),
    },
    {
      id: 'qty',
      header: 'Forged / planned',
      align: 'right',
      cell: (s) => (
        <span className="whitespace-nowrap font-mono">
          {formatNumber(s.actualForgedPcs)} / {formatNumber(s.plannedQtyPcs)}
        </span>
      ),
    },
    { id: 'saw', header: 'Billet cutting', hideBelow: 'lg', cell: (s) => <Badge tone={s.billetCuttingStatus === 'billets_released' ? 'success' : 'warning'}>{s.billetCuttingStatus.replace(/_/g, ' ')}</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Production"
        description="Shift output by machine, furnace charges, breakdowns and power. OK pieces logged against a job count as produced for that order."
        actions={
          (canWrite || canFurnace) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <Plus /> Log
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canWrite && (
                  <DropdownMenuItem onSelect={() => setDialog('shift')}>
                    <Factory /> Shift output
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setDialog('furnace')}>
                  <Flame /> Furnace charge
                </DropdownMenuItem>
                {canWrite && (
                  <>
                    <DropdownMenuItem onSelect={() => setDialog('maintenance')}>
                      <Wrench /> Breakdown / maintenance
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog('power')}>
                      <Zap /> Daily power reading
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="OK today" icon={Factory} value={formatNumber(todays.reduce((s, m) => s + m.okPcs, 0))} unit="pcs" hint={`${todays.length} shift entries`} onClick={() => setTab('shifts')} />
        <StatTile
          label="Rejection this month"
          icon={Gauge}
          tone={monthOk + monthRej > 0 && monthRej / (monthOk + monthRej) > 0.02 ? 'warning' : 'neutral'}
          value={monthOk + monthRej > 0 ? formatNumber((monthRej / (monthOk + monthRej)) * 100, 1) : '—'}
          unit={monthOk + monthRej > 0 ? '%' : undefined}
          hint={`${formatNumber(monthRej)} rejected + rework`}
          onClick={() => setTab('shifts')}
        />
        <StatTile label="Downtime today" icon={Timer} value={formatNumber(todays.reduce((s, m) => s + m.downtimeMinutes, 0))} unit="min" hint="All machines" onClick={() => setTab('shifts')} />
        <StatTile label="Open breakdowns" icon={Wrench} tone={openTickets.length ? 'danger' : 'neutral'} value={openTickets.length} hint="Not yet resolved" onClick={() => setTab('maintenance')} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="shifts">Shift output</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="furnace">Furnace</TabsTrigger>
          <TabsTrigger value="maintenance">
            Maintenance
            {openTickets.length > 0 && <span className="rounded-full bg-danger-soft px-1.5 text-[11px] tabular-nums text-destructive">{openTickets.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="power">Power</TabsTrigger>
        </TabsList>
        <TabsContent value="shifts" className="mt-4">
          <DataTable rows={machineLogs} columns={shiftCols} rowKey={(m) => m.id} searchText={(m) => `${m.machineName} ${m.operatorName} ${m.jobNumber}`} searchPlaceholder="Search machine, operator or job" initialSort={{ id: 'when', desc: true }} emptyTitle="No shift output logged" />
        </TabsContent>
        <TabsContent value="plan" className="mt-4">
          <DataTable rows={ppcSchedules} columns={ppcCols} rowKey={(s) => s.id} searchText={(s) => `${s.jobNumber} ${s.customerName} ${s.machineName}`} searchPlaceholder="Search job, customer or machine" initialSort={{ id: 'job' }} emptyTitle="No jobs scheduled" />
        </TabsContent>
        <TabsContent value="furnace" className="mt-4">
          <DataTable rows={furnaceLogs} columns={furnaceCols} rowKey={(f) => f.id} searchText={(f) => `${f.furnaceName} ${f.batchNumber} ${f.jobNumber} ${f.heatNumber}`} searchPlaceholder="Search furnace, charge, job or heat" initialSort={{ id: 'when', desc: true }} emptyTitle="No furnace charges logged" />
        </TabsContent>
        <TabsContent value="maintenance" className="mt-4">
          <DataTable rows={maintenanceTickets} columns={ticketCols} rowKey={(t) => t.id} searchText={(t) => `${t.machineName} ${t.issueDescription} ${t.technicianName}`} searchPlaceholder="Search machine, issue or technician" initialSort={{ id: 'when', desc: true }} emptyTitle="No maintenance tickets" />
        </TabsContent>
        <TabsContent value="power" className="mt-4">
          <DataTable rows={powerLogs} columns={powerCols} rowKey={(p) => p.id} initialSort={{ id: 'when', desc: true }} emptyTitle="No power readings logged" />
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog && (
          <DialogContent className="sm:max-w-xl">
            {dialog === 'shift' && <ShiftForm orders={openOrders} machines={machineNames} onDone={() => setDialog(null)} />}
            {dialog === 'furnace' && <FurnaceForm orders={openOrders} furnaces={furnaceNames} maxTemp={alertThresholds?.furnaceTemp} onDone={() => setDialog(null)} />}
            {dialog === 'maintenance' && <MaintenanceForm machines={machineNames} onDone={() => setDialog(null)} />}
            {dialog === 'power' && <PowerForm onDone={() => setDialog(null)} />}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Shell({ title, description, error, saving, onCancel, onSubmit, children }: {
  title: string;
  description: string;
  error: string;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Free text with suggestions from names already used, so the list grows with the plant. */
function NameInput({ id, list, value, onChange }: { id: string; list: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <Input id={id} list={`${id}-list`} maxLength={120} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={`${id}-list`}>
        {list.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}

function JobSelect({ id, orders, value, onChange, optional }: { id: string; orders: OrderJourney[]; value: string; onChange: (v: string) => void; optional?: boolean }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{optional ? 'No job' : 'Choose a job'}</option>
      {orders.map((o) => (
        <option key={o.id} value={o.jobNumber}>
          {o.jobNumber} · {o.customerName}
        </option>
      ))}
    </Select>
  );
}

function ShiftForm({ orders, machines, onDone }: { orders: OrderJourney[]; machines: string[]; onDone: () => void }) {
  const { createMachineLogRecord } = useRtdb();
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState<ShopMachineLog['shift']>(SHIFTS[0]);
  const [machine, setMachine] = useState('');
  const [operator, setOperator] = useState('');
  const [job, setJob] = useState('');
  const [input, setInput] = useState('');
  const [ok, setOk] = useState('');
  const [rej, setRej] = useState('');
  const [rework, setRework] = useState('');
  const [down, setDown] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const order = orders.find((o) => o.jobNumber === job);
    const [i, o, r, w, d] = [input, ok, rej, rework, down].map((v) => Number(v || 0));
    if (!machine.trim()) return setError('Enter the machine.');
    if (!order) return setError('Choose the job this output belongs to.');
    if (!(i > 0)) return setError('Enter the billets put in.');
    if (o + r + w > i) return setError(`OK + rejected + rework (${o + r + w}) is more than billets in (${i}).`);
    if (o + r + w === 0) return setError('Enter the OK, rejected or rework pieces.');
    if (d > SHIFT_MINUTES) return setError(`Downtime cannot exceed the ${SHIFT_MINUTES}-minute shift.`);
    setError('');
    setSaving(true);
    const res = await createMachineLogRecord({
      id: newRecordId('MLOG'),
      date,
      shift,
      machineId: machineId(machine.trim()),
      machineName: machine.trim(),
      operatorName: operator.trim(),
      jobNumber: order.jobNumber,
      productName: order.lineItems?.[0]?.productName || '',
      inputBilletsPcs: i,
      forgedOutputPcs: o + r + w,
      okPcs: o,
      rejectedPcs: r,
      reworkPcs: w,
      downtimeMinutes: d,
      // Availability: share of the 8-hour shift the machine was not down.
      capacityUtilizationPercent: Number((((SHIFT_MINUTES - d) / SHIFT_MINUTES) * 100).toFixed(1)),
    });
    setSaving(false);
    if (notify(res, 'Shift output saved', `${o} OK pieces added to ${order.jobNumber}`)) onDone();
  };

  return (
    <Shell title="Log shift output" description="OK pieces are added to the job's produced quantity." error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="sf-date">
          <Input id="sf-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Shift" htmlFor="sf-shift">
          <Select id="sf-shift" value={shift} onChange={(e) => setShift(e.target.value as ShopMachineLog['shift'])}>
            {SHIFTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Machine" htmlFor="sf-machine">
          <NameInput id="sf-machine" list={machines} value={machine} onChange={setMachine} />
        </Field>
        <Field label="Operator" htmlFor="sf-op">
          <Input id="sf-op" maxLength={80} value={operator} onChange={(e) => setOperator(e.target.value)} />
        </Field>
      </div>
      <Field label="Job" htmlFor="sf-job">
        <JobSelect id="sf-job" orders={orders} value={job} onChange={setJob} />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Field label="Billets in" htmlFor="sf-in">
          <Input id="sf-in" inputMode="numeric" value={input} onChange={(e) => setInput(digits(e.target.value))} />
        </Field>
        <Field label="OK" htmlFor="sf-ok">
          <Input id="sf-ok" inputMode="numeric" value={ok} onChange={(e) => setOk(digits(e.target.value))} />
        </Field>
        <Field label="Rejected" htmlFor="sf-rej">
          <Input id="sf-rej" inputMode="numeric" value={rej} onChange={(e) => setRej(digits(e.target.value))} />
        </Field>
        <Field label="Rework" htmlFor="sf-rw">
          <Input id="sf-rw" inputMode="numeric" value={rework} onChange={(e) => setRework(digits(e.target.value))} />
        </Field>
        <Field label="Down (min)" htmlFor="sf-down">
          <Input id="sf-down" inputMode="numeric" value={down} onChange={(e) => setDown(digits(e.target.value))} />
        </Field>
      </div>
    </Shell>
  );
}

function FurnaceForm({ orders, furnaces, maxTemp, onDone }: { orders: OrderJourney[]; furnaces: string[]; maxTemp?: number; onDone: () => void }) {
  const { createFurnaceLogRecord } = useRtdb();
  const [furnace, setFurnace] = useState('');
  const [fuel, setFuel] = useState<FurnaceBatchLog['fuelType']>('PNG (Natural Gas)');
  const [charge, setCharge] = useState('');
  const [job, setJob] = useState('');
  const [heat, setHeat] = useState('');
  const [mt, setMt] = useState('');
  const [target, setTarget] = useState('');
  const [peak, setPeak] = useState('');
  const [soak, setSoak] = useState('');
  const [fuelQty, setFuelQty] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const order = orders.find((o) => o.jobNumber === job);
    const [w, t, p, s, f] = [mt, target, peak, soak, fuelQty].map(Number);
    if (!furnace.trim()) return setError('Enter the furnace.');
    if (!charge.trim()) return setError('Enter the charge number.');
    if (!(w > 0)) return setError('Enter the charge weight in MT.');
    if (!(t > 0 && p > 0)) return setError('Enter the target and peak temperatures.');
    if (!(f > 0)) return setError('Enter the fuel consumed.');
    setError('');
    setSaving(true);
    const deviation = maxTemp ? p > maxTemp : false;
    const res = await createFurnaceLogRecord({
      id: newRecordId('FURN'),
      batchNumber: charge.trim(),
      date: todayIso(),
      shift: '',
      furnaceId: machineId(furnace.trim()).replace('MCH-', 'FUR-'),
      furnaceName: furnace.trim(),
      fuelType: fuel,
      jobNumber: order?.jobNumber || '',
      heatNumber: heat.trim(),
      chargeWeightMt: w,
      targetTempC: t,
      peakRecordedTempC: p,
      soakingTimeMinutes: Number(soak || 0),
      fuelConsumedQty: f,
      fuelUnit: FUEL_UNIT[fuel],
      specificFuelPerMt: Number((f / w).toFixed(1)),
      status: deviation ? 'temp_deviation' : 'within_spec',
    });
    setSaving(false);
    if (notify(res, deviation ? `Saved — peak ${p}°C is above the ${maxTemp}°C limit` : 'Furnace charge saved', charge.trim())) onDone();
  };

  return (
    <Shell title="Log furnace charge" description={maxTemp ? `Peaks above ${maxTemp}°C are flagged as a temperature deviation.` : 'Record one charge.'} error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Furnace" htmlFor="fu-name">
          <NameInput id="fu-name" list={furnaces} value={furnace} onChange={setFurnace} />
        </Field>
        <Field label="Fuel" htmlFor="fu-fuel">
          <Select id="fu-fuel" value={fuel} onChange={(e) => setFuel(e.target.value as FurnaceBatchLog['fuelType'])}>
            {Object.keys(FUEL_UNIT).map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
        </Field>
        <Field label="Charge number" htmlFor="fu-charge">
          <Input id="fu-charge" className="font-mono" maxLength={40} value={charge} onChange={(e) => setCharge(e.target.value)} />
        </Field>
        <Field label="Job (optional)" htmlFor="fu-job">
          <JobSelect id="fu-job" orders={orders} value={job} onChange={setJob} optional />
        </Field>
        <Field label="Heat number" htmlFor="fu-heat">
          <Input id="fu-heat" className="font-mono" maxLength={40} value={heat} onChange={(e) => setHeat(e.target.value)} />
        </Field>
        <Field label="Charge weight (MT)" htmlFor="fu-mt">
          <Input id="fu-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(decimal(e.target.value))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Target °C" htmlFor="fu-t">
          <Input id="fu-t" inputMode="numeric" value={target} onChange={(e) => setTarget(digits(e.target.value))} />
        </Field>
        <Field label="Peak °C" htmlFor="fu-p">
          <Input id="fu-p" inputMode="numeric" value={peak} onChange={(e) => setPeak(digits(e.target.value))} />
        </Field>
        <Field label="Soak (min)" htmlFor="fu-s">
          <Input id="fu-s" inputMode="numeric" value={soak} onChange={(e) => setSoak(digits(e.target.value))} />
        </Field>
        <Field label={`Fuel (${FUEL_UNIT[fuel]})`} htmlFor="fu-f">
          <Input id="fu-f" inputMode="decimal" value={fuelQty} onChange={(e) => setFuelQty(decimal(e.target.value))} />
        </Field>
      </div>
    </Shell>
  );
}

function MaintenanceForm({ machines, onDone }: { machines: string[]; onDone: () => void }) {
  const { createMaintenanceTicketRecord } = useRtdb();
  const [machine, setMachine] = useState('');
  const [type, setType] = useState<MachineMaintenanceTicket['maintenanceType']>('Breakdown');
  const [issue, setIssue] = useState('');
  const [cause, setCause] = useState('');
  const [parts, setParts] = useState('');
  const [tech, setTech] = useState('');
  const [down, setDown] = useState('');
  const [cost, setCost] = useState('');
  const [status, setStatus] = useState<MachineMaintenanceTicket['status']>('in_repair');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!machine.trim()) return setError('Enter the machine.');
    if (issue.trim().length < 3) return setError('Describe the problem or the work done.');
    setError('');
    setSaving(true);
    const res = await createMaintenanceTicketRecord({
      id: newRecordId('MNT'),
      ticketDate: todayIso(),
      machineId: machineId(machine.trim()),
      machineName: machine.trim(),
      maintenanceType: type,
      issueDescription: issue.trim(),
      rootCause: cause.trim(),
      replacementParts: parts.trim(),
      downtimeMinutes: Number(down || 0),
      maintenanceCostInr: Number(cost || 0),
      technicianName: tech.trim(),
      status,
    });
    setSaving(false);
    if (notify(res, 'Maintenance ticket saved', machine.trim())) onDone();
  };

  return (
    <Shell title="Breakdown / maintenance" description="Log a breakdown or planned work. Update the status from the list as it progresses." error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Machine" htmlFor="mt-machine">
          <NameInput id="mt-machine" list={machines} value={machine} onChange={setMachine} />
        </Field>
        <Field label="Type" htmlFor="mt-type">
          <Select id="mt-type" value={type} onChange={(e) => setType(e.target.value as MachineMaintenanceTicket['maintenanceType'])}>
            <option>Breakdown</option>
            <option>Preventive (PM)</option>
            <option>Die Changeover</option>
            <option>Calibration</option>
          </Select>
        </Field>
      </div>
      <Field label="Problem / work done" htmlFor="mt-issue">
        <Textarea id="mt-issue" rows={2} maxLength={500} value={issue} onChange={(e) => setIssue(e.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Root cause (if known)" htmlFor="mt-cause">
          <Input id="mt-cause" maxLength={200} value={cause} onChange={(e) => setCause(e.target.value)} />
        </Field>
        <Field label="Parts replaced" htmlFor="mt-parts">
          <Input id="mt-parts" maxLength={200} value={parts} onChange={(e) => setParts(e.target.value)} />
        </Field>
        <Field label="Technician" htmlFor="mt-tech">
          <Input id="mt-tech" maxLength={80} value={tech} onChange={(e) => setTech(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="mt-status">
          <Select id="mt-status" value={status} onChange={(e) => setStatus(e.target.value as MachineMaintenanceTicket['status'])}>
            <option value="in_repair">In repair</option>
            <option value="awaiting_spares">Awaiting spares</option>
            <option value="resolved">Resolved</option>
          </Select>
        </Field>
        <Field label="Downtime (min)" htmlFor="mt-down">
          <Input id="mt-down" inputMode="numeric" value={down} onChange={(e) => setDown(digits(e.target.value))} />
        </Field>
        <Field label="Cost (₹)" htmlFor="mt-cost">
          <Input id="mt-cost" inputMode="numeric" value={cost} onChange={(e) => setCost(digits(e.target.value))} />
        </Field>
      </div>
    </Shell>
  );
}

function PowerForm({ onDone }: { onDone: () => void }) {
  const { createPowerLogRecord } = useRtdb();
  const [date, setDate] = useState(todayIso());
  const [kwh, setKwh] = useState('');
  const [kvah, setKvah] = useState('');
  const [kva, setKva] = useState('');
  const [mt, setMt] = useState('');
  const [tariff, setTariff] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const [e, v, peak, out, rate, tgt] = [kwh, kvah, kva, mt, tariff, target].map((x) => (x ? Number(x) : undefined));
    if (!(e && e > 0)) return setError('Enter the kWh reading.');
    if (!(out && out > 0)) return setError('Enter the forged output in MT for the day.');
    if (v !== undefined && v < e) return setError('kVAh cannot be lower than kWh.');
    setError('');
    setSaving(true);
    const res = await createPowerLogRecord({
      id: `PWR-${date.replace(/-/g, '')}`,
      date,
      totalKwh: e,
      totalKvah: v,
      powerFactor: v ? Number((e / v).toFixed(3)) : undefined,
      peakDemandKva: peak,
      forgedOutputMt: out,
      specificEnergyKwhPerMt: Number((e / out).toFixed(1)),
      targetKwhPerMt: tgt,
      electricityCostInr: rate ? Math.round(e * rate) : undefined,
    });
    setSaving(false);
    if (notify(res, 'Power reading saved', `${formatNumber(e / out, 1)} kWh per MT`)) onDone();
  };

  return (
    <Shell title="Daily power reading" description="Only kWh and output are required; power factor is worked out from kVAh when you enter it." error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="pw-date">
          <Input id="pw-date" type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="kWh" htmlFor="pw-kwh">
          <Input id="pw-kwh" inputMode="decimal" value={kwh} onChange={(e) => setKwh(decimal(e.target.value))} />
        </Field>
        <Field label="Forged output (MT)" htmlFor="pw-mt">
          <Input id="pw-mt" inputMode="decimal" value={mt} onChange={(e) => setMt(decimal(e.target.value))} />
        </Field>
        <Field label="kVAh" htmlFor="pw-kvah">
          <Input id="pw-kvah" inputMode="decimal" value={kvah} onChange={(e) => setKvah(decimal(e.target.value))} />
        </Field>
        <Field label="Peak demand (kVA)" htmlFor="pw-kva">
          <Input id="pw-kva" inputMode="decimal" value={kva} onChange={(e) => setKva(decimal(e.target.value))} />
        </Field>
        <Field label="Tariff (₹/kWh)" htmlFor="pw-rate">
          <Input id="pw-rate" inputMode="decimal" value={tariff} onChange={(e) => setTariff(decimal(e.target.value))} />
        </Field>
      </div>
      <Field label="Target kWh per MT (optional)" htmlFor="pw-tgt">
        <Input id="pw-tgt" inputMode="decimal" value={target} onChange={(e) => setTarget(decimal(e.target.value))} />
      </Field>
    </Shell>
  );
}
