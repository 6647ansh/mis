import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Download, FileText, Layers, Plus } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { RawMaterialStock, StockMovement } from '../../types/mis';
import type { MontexPdfDocumentPayload } from '../../services/documentExportService';
import { DocumentPreviewModal } from '../common/DocumentPreviewModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { cn, formatDate, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const WRITERS = ['super_admin', 'ceo', 'stores'];
const STATUS: Record<string, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  adequate: { tone: 'success', label: 'Healthy' },
  warning: { tone: 'warning', label: 'Low' },
  critical: { tone: 'danger', label: 'Critical' },
};
const MOVE_TYPES: { value: StockMovement['movementType']; label: string; sign: 1 | -1 | 0 }[] = [
  { value: 'Receipt (GRN)', label: 'Receipt (GRN)', sign: 1 },
  { value: 'Production Issue', label: 'Issue to production', sign: -1 },
  { value: 'Scrap Return', label: 'Scrap / return to stock', sign: 1 },
  { value: 'Adjustment', label: 'Stock adjustment', sign: 0 },
];

/** Free stock (on hand minus reserved) against the item's own minimum and reorder levels. */
function level(m: RawMaterialStock) {
  if (!m.reorderLevelMt && !m.minimumStockMt) return m.status || 'adequate';
  if (m.minimumStockMt && m.availableStockMt <= m.minimumStockMt) return 'critical';
  if (m.availableStockMt <= 0) return 'critical';
  if (m.reorderLevelMt && m.availableStockMt <= m.reorderLevelMt) return 'warning';
  return 'adequate';
}

function StockBar({ m }: { m: RawMaterialStock }) {
  const max = Math.max(m.availableStockMt, m.reorderLevelMt * 1.5, 1);
  const lvl = level(m);
  return (
    <div className="relative h-2 w-full min-w-24 rounded-full bg-muted" aria-hidden="true">
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full', lvl === 'critical' ? 'bg-destructive' : lvl === 'warning' ? 'bg-warning' : 'bg-slate-600')}
        style={{ width: `${Math.min(100, (m.availableStockMt / max) * 100)}%` }}
      />
      {m.reorderLevelMt > 0 && <span className="absolute -inset-y-0.5 w-0.5 bg-foreground/60" style={{ left: `${(m.reorderLevelMt / max) * 100}%` }} title="Reorder level" />}
    </div>
  );
}

export function InventoryPage() {
  const { currentUser, activeRbacGroup, rawMaterials, stockMovements, purchaseOrders } = useRtdb();
  const canWrite = currentUser.accountStatus === 'active' && WRITERS.includes(currentUser.role);
  const [tab, setTab] = useState('stock');
  const [moving, setMoving] = useState<RawMaterialStock | 'new' | null>(null);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<MontexPdfDocumentPayload | null>(null);

  const totals = useMemo(
    () => ({
      onHand: rawMaterials.reduce((s, m) => s + m.currentStockMt, 0),
      reserved: rawMaterials.reduce((s, m) => s + m.reservedStockMt, 0),
      low: rawMaterials.filter((m) => level(m) !== 'adequate'),
      incoming: purchaseOrders.filter((p) => p.status !== 'completed').reduce((s, p) => s + (p.pendingMt || 0), 0),
    }),
    [rawMaterials, purchaseOrders]
  );

  const pdf = async (mov: StockMovement) => {
    const svc = await import('../../services/documentExportService');
    const check = svc.verifyExportPermission(currentUser, activeRbacGroup, ['Admin', 'Management', 'Production', 'Finance']);
    if (!check.allowed) return toast.error('Export not allowed', { description: check.error });
    setPreview(svc.buildStockMovementGrnPdfPayload(
        mov,
        rawMaterials.find((m) => m.code === mov.materialCode),
        purchaseOrders.find((p) => p.poNumber === mov.referenceDoc || p.id === mov.referenceDoc),
        currentUser,
        activeRbacGroup
      ));
  };

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const res = svc.exportMontexExcelWorkbook(
      `Montex_Inventory_${todayIso()}.xlsx`,
      [
        {
          sheetName: 'Stock',
          reportTitle: 'MONTEX MIS — RAW MATERIAL STOCK',
          reportSubtitle: `${formatNumber(totals.onHand, 2)} MT on hand`,
          headers: ['Code', 'Material', 'Grade', 'Size', 'On hand MT', 'Reserved MT', 'Free MT', 'Reorder MT', 'Minimum MT', 'Bay', 'Supplier', 'Status'],
          rows: rawMaterials.map((m) => [m.code, m.name, m.grade, m.dimensionsMm, m.currentStockMt, m.reservedStockMt, m.availableStockMt, m.reorderLevelMt, m.minimumStockMt, m.locationBay, m.supplier, STATUS[level(m)].label]),
        },
        {
          sheetName: 'Movements',
          reportTitle: 'MONTEX MIS — STOCK LEDGER',
          reportSubtitle: `${stockMovements.length} entries`,
          headers: ['When', 'Material', 'Grade', 'Type', 'Heat', 'Qty MT', 'Balance MT', 'Reference', 'By'],
          rows: stockMovements.map((v) => [v.timestamp, v.materialCode, v.materialGrade, v.movementType, v.heatNumber, v.quantityMt, v.balanceAfterMt, v.referenceDoc, v.performedBy]),
        },
      ],
      currentUser.email
    );
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const stockCols: Column<RawMaterialStock>[] = [
    {
      id: 'mat',
      header: 'Material',
      sortValue: (m) => m.grade,
      cell: (m) => (
        <div className="max-w-64">
          <p className="truncate font-medium">{m.grade}</p>
          <p className="truncate text-xs text-muted-foreground">{[m.code, m.dimensionsMm, m.locationBay && `Bay ${m.locationBay.replace(/^Bay\s*/i, '')}`].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'stock',
      header: 'On hand',
      align: 'right',
      sortValue: (m) => m.currentStockMt,
      cell: (m) => (
        <div className="whitespace-nowrap text-right">
          <p className="font-mono font-semibold">{formatNumber(m.currentStockMt, 2)} MT</p>
          {m.reservedStockMt > 0 && <p className="text-xs text-muted-foreground">{formatNumber(m.reservedStockMt, 2)} reserved</p>}
        </div>
      ),
    },
    { id: 'bar', header: 'Free vs reorder level', hideBelow: 'md', cell: (m) => <StockBar m={m} /> },
    { id: 'free', header: 'Free', align: 'right', hideBelow: 'sm', sortValue: (m) => m.availableStockMt, cell: (m) => <span className="whitespace-nowrap font-mono">{formatNumber(m.availableStockMt, 2)} MT</span> },
    { id: 'st', header: 'Status', sortValue: (m) => ['critical', 'warning', 'adequate'].indexOf(level(m)), cell: (m) => <Badge tone={STATUS[level(m)].tone}>{STATUS[level(m)].label}</Badge> },
    ...(canWrite
      ? [
          {
            id: 'act',
            header: '',
            align: 'right' as const,
            cell: (m: RawMaterialStock) => (
              <Button size="sm" variant="secondary" onClick={() => setMoving(m)}>
                Move
              </Button>
            ),
          },
        ]
      : []),
  ];

  const moveCols: Column<StockMovement>[] = [
    { id: 'when', header: 'When', sortValue: (v) => v.timestamp, cell: (v) => <span className="whitespace-nowrap">{formatDate(v.timestamp?.slice(0, 10))}</span> },
    {
      id: 'mat',
      header: 'Material / heat',
      cell: (v) => (
        <div className="max-w-60">
          <p className="truncate">{v.materialGrade}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{[v.materialCode, v.heatNumber].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'type', header: 'Type', hideBelow: 'md', cell: (v) => v.movementType },
    {
      id: 'qty',
      header: 'Qty',
      align: 'right',
      sortValue: (v) => v.quantityMt,
      cell: (v) => (
        <span className={cn('whitespace-nowrap font-mono font-semibold', v.quantityMt < 0 ? 'text-destructive' : 'text-success')}>
          {v.quantityMt > 0 ? '+' : ''}
          {formatNumber(v.quantityMt, 2)} MT
        </span>
      ),
    },
    { id: 'bal', header: 'Balance', align: 'right', hideBelow: 'sm', cell: (v) => <span className="whitespace-nowrap font-mono">{formatNumber(v.balanceAfterMt, 2)} MT</span> },
    { id: 'ref', header: 'Reference', hideBelow: 'lg', cell: (v) => <span className="font-mono text-xs">{v.referenceDoc || '—'}</span> },
    {
      id: 'act',
      header: '',
      align: 'right',
      cell: (v) => (
        <Button size="icon-sm" variant="ghost" aria-label={`Slip for ${v.id}`} onClick={() => pdf(v)}>
          <FileText />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        description="Raw material on hand by grade and size, what is reserved for jobs, and every receipt and issue with its heat number."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {canWrite && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus /> Add material
              </Button>
            )}
            {canWrite && rawMaterials.length > 0 && (
              <Button onClick={() => setMoving('new')}>
                <Plus /> Record movement
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="On hand" icon={Boxes} value={formatNumber(totals.onHand, 1)} unit="MT" hint={`${rawMaterials.length} items`} onClick={() => setTab('stock')} />
        <StatTile label="Reserved for jobs" icon={Layers} value={formatNumber(totals.reserved, 1)} unit="MT" hint={`${formatNumber(totals.onHand - totals.reserved, 1)} MT free`} />
        <StatTile label="Below reorder" icon={AlertTriangle} tone={totals.low.length ? 'danger' : 'neutral'} value={totals.low.length} hint={totals.low.length ? totals.low.slice(0, 2).map((m) => m.grade).join(', ') : 'All healthy'} onClick={() => setTab('stock')} />
        <StatTile label="On order" icon={ArrowDownToLine} value={formatNumber(totals.incoming, 1)} unit="MT" hint="Pending on open mill POs" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="ledger">Movements</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="mt-4">
          <DataTable rows={rawMaterials} columns={stockCols} rowKey={(m) => m.id} searchText={(m) => `${m.code} ${m.name} ${m.grade} ${m.dimensionsMm} ${m.supplier}`} searchPlaceholder="Search grade, size, code or supplier" initialSort={{ id: 'st' }} emptyTitle="No materials in stock master" />
        </TabsContent>
        <TabsContent value="ledger" className="mt-4">
          <DataTable rows={stockMovements} columns={moveCols} rowKey={(v) => v.id} searchText={(v) => `${v.materialCode} ${v.materialGrade} ${v.heatNumber} ${v.referenceDoc} ${v.movementType}`} searchPlaceholder="Search material, heat, reference" initialSort={{ id: 'when', desc: true }} emptyTitle="No stock movements yet" />
        </TabsContent>
      </Tabs>

      <Dialog open={moving !== null} onOpenChange={(o) => !o && setMoving(null)}>
        {moving !== null && (
          <DialogContent>
            <MovementForm materials={rawMaterials} initial={moving === 'new' ? undefined : moving} onDone={() => setMoving(null)} />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        {adding && (
          <DialogContent className="sm:max-w-xl">
            <MaterialForm existing={rawMaterials} showRate={['super_admin', 'ceo'].includes(currentUser.role)} onDone={() => setAdding(false)} />
          </DialogContent>
        )}
      </Dialog>

      <DocumentPreviewModal payload={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

/** A grade and size kept in the yard. It starts at 0 MT; stock comes in through movements, so every tonne has a ledger entry. */
function MaterialForm({ existing, showRate, onDone }: { existing: RawMaterialStock[]; showRate: boolean; onDone: () => void }) {
  const { upsertRawMaterialRecord } = useRtdb();
  const [f, setF] = useState({ grade: '', size: '', reorder: '', minimum: '', rate: '', mill: '', bay: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, clean?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: clean ? clean(e.target.value) : e.target.value }));
  const dec = (v: string) => v.replace(/[^0-9.]/g, '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const grade = f.grade.trim();
    const size = f.size.trim();
    if (grade.length < 2) return setError('Enter the steel grade, for example ASTM A105 or 42CrMo4.');
    if (existing.some((m) => m.grade.toLowerCase() === grade.toLowerCase() && (m.dimensionsMm || '').toLowerCase() === size.toLowerCase()))
      return setError('This grade and size is already in the list.');
    const reorder = Number(f.reorder || 0);
    const minimum = Number(f.minimum || 0);
    if (minimum > 0 && reorder > 0 && minimum > reorder) return setError('The minimum should not be higher than the reorder level.');
    setError('');
    setSaving(true);
    const id = newRecordId('MAT');
    const res = await upsertRawMaterialRecord(
      {
        id,
        code: id,
        name: size ? `${grade} ${size}` : grade,
        grade,
        sectionShape: 'Round Billet',
        dimensionsMm: size,
        currentStockMt: 0,
        reservedStockMt: 0,
        availableStockMt: 0,
        minimumStockMt: minimum,
        reorderLevelMt: reorder,
        standardRatePerMt: Number(f.rate || 0),
        supplier: f.mill.trim(),
        locationBay: f.bay.trim(),
        status: reorder > 0 || minimum > 0 ? 'critical' : 'adequate',
      },
      true
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'The material could not be saved.');
    toast.success('Material added', { description: `${grade}${size ? ` ${size}` : ''}. Record its opening stock with "Record movement".` });
    onDone();
  };

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Add material</DialogTitle>
        <DialogDescription>A grade and size you keep in the yard. It starts at 0 MT; add the opening stock afterwards as a stock movement.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Steel grade" htmlFor="mt-grade">
          <Input id="mt-grade" maxLength={64} value={f.grade} onChange={set('grade')} />
        </Field>
        <Field label="Size / section (optional)" htmlFor="mt-size">
          <Input id="mt-size" maxLength={22} value={f.size} placeholder="e.g. Ø180 mm round" onChange={set('size')} />
        </Field>
        <Field label="Reorder level (MT)" htmlFor="mt-reorder">
          <Input id="mt-reorder" inputMode="decimal" value={f.reorder} onChange={set('reorder', dec)} />
        </Field>
        <Field label="Minimum stock (MT, optional)" htmlFor="mt-min">
          <Input id="mt-min" inputMode="decimal" value={f.minimum} onChange={set('minimum', dec)} />
        </Field>
        <Field label="Usual mill (optional)" htmlFor="mt-mill">
          <Input id="mt-mill" maxLength={160} value={f.mill} onChange={set('mill')} />
        </Field>
        <Field label="Yard / bay (optional)" htmlFor="mt-bay">
          <Input id="mt-bay" maxLength={80} value={f.bay} onChange={set('bay')} />
        </Field>
        {showRate && (
          <Field label="Standard rate (₹ per MT, optional)" htmlFor="mt-rate">
            <Input id="mt-rate" inputMode="decimal" value={f.rate} onChange={set('rate', dec)} />
          </Field>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Add material
        </Button>
      </DialogFooter>
    </form>
  );
}

function MovementForm({ materials, initial, onDone }: { materials: RawMaterialStock[]; initial?: RawMaterialStock; onDone: () => void }) {
  const { recordStockMovementRecord } = useRtdb();
  const [materialId, setMaterialId] = useState(initial?.id || '');
  const [type, setType] = useState<StockMovement['movementType']>('Receipt (GRN)');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [qty, setQty] = useState('');
  const [heat, setHeat] = useState('');
  const [ref, setRef] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const material = materials.find((m) => m.id === materialId);
  const meta = MOVE_TYPES.find((t) => t.value === type)!;
  const sign = meta.sign === 0 ? direction : meta.sign;
  const amount = Number(qty);
  const after = material && amount > 0 ? material.currentStockMt + sign * amount : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!material) return setError('Choose the material.');
    if (!(amount > 0)) return setError('Enter the quantity in MT.');
    if (type !== 'Adjustment' && !heat.trim()) return setError('Enter the heat number so the steel stays traceable.');
    if (!ref.trim()) return setError(type === 'Receipt (GRN)' ? 'Enter the GRN or PO number.' : type === 'Production Issue' ? 'Enter the job number it is issued to.' : 'Enter a reference or reason.');
    if (after !== null && after < 0) return setError(`Only ${formatNumber(material.currentStockMt, 2)} MT is on hand.`);
    if (sign < 0 && after !== null && after < material.reservedStockMt)
      return setError(`${formatNumber(material.reservedStockMt, 2)} MT is reserved for jobs; only ${formatNumber(material.availableStockMt, 2)} MT is free to issue.`);
    setError('');
    setSaving(true);
    const res = await recordStockMovementRecord({
      material,
      quantityDeltaMt: Number((sign * amount).toFixed(3)),
      movementType: type,
      heatNumber: heat.trim(),
      referenceDoc: ref.trim(),
    });
    setSaving(false);
    if (!res.success) return setError(res.error || 'The movement could not be saved.');
    toast.success(`${meta.label} saved`, { description: `${material.grade}: now ${formatNumber(after ?? 0, 2)} MT` });
    onDone();
  };

  return (
    <form className="space-y-4" noValidate onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Record stock movement</DialogTitle>
        <DialogDescription>Each entry is added to the stock ledger; balances update immediately for everyone.</DialogDescription>
      </DialogHeader>
      <Field label="Material" htmlFor="mv-mat">
        <Select id="mv-mat" value={materialId} onChange={(e) => setMaterialId(e.target.value)}>
          <option value="">Choose</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.grade} · {m.dimensionsMm || m.code} ({formatNumber(m.currentStockMt, 2)} MT)
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="mv-type">
          <Select id="mv-type" value={type} onChange={(e) => setType(e.target.value as StockMovement['movementType'])}>
            {MOVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        {type === 'Adjustment' ? (
          <Field label="Direction" htmlFor="mv-dir">
            <Select id="mv-dir" value={direction} onChange={(e) => setDirection(Number(e.target.value) as 1 | -1)}>
              <option value={1}>Add to stock</option>
              <option value={-1}>Remove from stock</option>
            </Select>
          </Field>
        ) : (
          <Field label="Quantity (MT)" htmlFor="mv-qty">
            <Input id="mv-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
        )}
        {type === 'Adjustment' && (
          <Field label="Quantity (MT)" htmlFor="mv-qty">
            <Input id="mv-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} />
          </Field>
        )}
        <Field label={type === 'Adjustment' ? 'Heat number (optional)' : 'Heat number'} htmlFor="mv-heat">
          <Input id="mv-heat" className="font-mono" maxLength={64} value={heat} onChange={(e) => setHeat(e.target.value.toUpperCase())} />
        </Field>
        <Field label={type === 'Receipt (GRN)' ? 'GRN / PO no.' : type === 'Production Issue' ? 'Job number' : 'Reference / reason'} htmlFor="mv-ref">
          <Input id="mv-ref" className="font-mono" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </div>
      {material && after !== null && (
        <p className={cn('flex items-center gap-1.5 text-xs', after < 0 ? 'text-destructive' : 'text-muted-foreground')}>
          {sign > 0 ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
          {formatNumber(material.currentStockMt, 2)} → {formatNumber(after, 2)} MT
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
