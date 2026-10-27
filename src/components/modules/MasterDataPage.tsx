import React, { useState } from 'react';
import { toast } from 'sonner';
import { Building2, Download, MoreHorizontal, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRtdb } from '../../context/RtdbContext';
import type { Customer, Product } from '../../types/mis';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader, StatTile } from '@/components/ui/data-display';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { formatINR, formatNumber, newRecordId, todayIso } from '@/lib/utils';

const CUSTOMER_WRITERS = ['super_admin', 'ceo', 'sales', 'finance'];
const PRODUCT_WRITERS = ['super_admin', 'ceo', 'sales', 'stores', 'quality'];
const DELETERS = ['super_admin', 'ceo'];
const CATEGORIES: Product['category'][] = ['Flange', 'Blind Flange', 'Forged Ring', 'Shaft', 'Custom Forging'];
const decimal = (v: string) => v.replace(/[^0-9.]/g, '');
const digits = (v: string) => v.replace(/[^0-9]/g, '');

type Kind = 'customers' | 'products';

export function MasterDataPage({ initialType }: { initialType: Kind }) {
  const { currentUser, customers, products, salesOrders, quotations, outstandingAgeing, deleteCustomerRecord, deleteProductRecord } = useRtdb();
  const active = currentUser.accountStatus === 'active';
  const isCustomers = initialType === 'customers';
  const canWrite = active && (isCustomers ? CUSTOMER_WRITERS : PRODUCT_WRITERS).includes(currentUser.role);
  const canDelete = active && DELETERS.includes(currentUser.role);
  const [editing, setEditing] = useState<{ item?: Customer | Product } | null>(null);
  const [deleting, setDeleting] = useState<Customer | Product | null>(null);

  const ordersFor = (c: Customer) => salesOrders.filter((o) => o.customerId === c.id).length;
  const dueFor = (c: Customer) => outstandingAgeing.find((a) => a.customerId === c.id)?.totalOutstanding ?? c.totalOutstanding ?? 0;
  const usesOf = (p: Product) => salesOrders.filter((o) => o.lineItems?.some((li) => li.productId === p.id)).length + quotations.filter((q) => q.productId === p.id).length;

  const exportExcel = async () => {
    const svc = await import('../../services/documentExportService');
    const res = isCustomers
      ? svc.exportMontexExcelWorkbook(`Montex_Customers_${todayIso()}.xlsx`, [
          {
            sheetName: 'Customers',
            reportTitle: 'MONTEX MIS — CUSTOMERS',
            reportSubtitle: `${customers.length} customers`,
            headers: ['Code', 'Name', 'Contact', 'Phone', 'Email', 'Location', 'Industry', 'Credit limit', 'Credit days', 'Sales owner', 'Active', 'Orders', 'Outstanding'],
            rows: customers.map((c) => [c.code, c.name, c.contactPerson, c.phone, c.email, c.location, c.industry, c.creditLimit, c.creditDays, c.assignedSalesPerson, c.active ? 'Yes' : 'No', ordersFor(c), dueFor(c)]),
          },
        ], currentUser.email)
      : svc.exportMontexExcelWorkbook(`Montex_Products_${todayIso()}.xlsx`, [
          {
            sheetName: 'Products',
            reportTitle: 'MONTEX MIS — PRODUCTS',
            reportSubtitle: `${products.length} products`,
            headers: ['Code', 'Name', 'Category', 'Size', 'Grade', 'Standard', 'UOM', 'Weight kg', 'HSN', 'Standard price'],
            rows: products.map((p) => [p.code, p.name, p.category, p.size, p.materialGrade, p.standard, p.uom, p.standardWeightKg, p.hsnCode, p.standardSellingPrice]),
          },
        ], currentUser.email);
    if (res.success) toast.success('Download started', { description: res.filename });
    else toast.error('Export failed', { description: res.error });
  };

  const rowMenu = (item: Customer | Product) =>
    canWrite || canDelete ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${item.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canWrite && (
            <DropdownMenuItem onSelect={() => setEditing({ item })}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem className="text-destructive" onSelect={() => setDeleting(item)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  const customerCols: Column<Customer>[] = [
    {
      id: 'name',
      header: 'Customer',
      sortValue: (c) => c.name,
      cell: (c) => (
        <div className="max-w-72">
          <p className="truncate font-medium">{c.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[c.code, c.location, c.industry].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'contact',
      header: 'Contact',
      hideBelow: 'md',
      cell: (c) => (
        <div className="max-w-56 text-xs">
          <p className="truncate text-sm">{c.contactPerson || '—'}</p>
          <p className="truncate text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    {
      id: 'credit',
      header: 'Credit',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (c) => c.creditLimit,
      cell: (c) => (
        <div className="whitespace-nowrap text-right">
          <p className="font-mono">{c.creditLimit ? formatINR(c.creditLimit, { compact: true }) : '—'}</p>
          {c.creditDays ? <p className="text-xs text-muted-foreground">{c.creditDays} days</p> : null}
        </div>
      ),
    },
    {
      id: 'due',
      header: 'Outstanding',
      align: 'right',
      sortValue: (c) => dueFor(c),
      cell: (c) => {
        const d = dueFor(c);
        const over = c.creditLimit > 0 && d > c.creditLimit;
        return <span className={`whitespace-nowrap font-mono ${over ? 'font-semibold text-destructive' : ''}`}>{d ? formatINR(d, { compact: true }) : '—'}</span>;
      },
    },
    { id: 'orders', header: 'Orders', align: 'right', hideBelow: 'lg', sortValue: (c) => ordersFor(c), cell: (c) => <span className="font-mono">{formatNumber(ordersFor(c))}</span> },
    { id: 'st', header: 'Status', hideBelow: 'sm', cell: (c) => <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge> },
    { id: 'act', header: '', align: 'right', cell: (c) => rowMenu(c) },
  ];

  const productCols: Column<Product>[] = [
    {
      id: 'name',
      header: 'Product',
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="max-w-80">
          <p className="truncate font-medium">{p.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[p.code, p.category, p.size].filter(Boolean).join(' · ')}</p>
        </div>
      ),
    },
    { id: 'grade', header: 'Grade / standard', hideBelow: 'md', cell: (p) => <div className="max-w-56 text-xs"><p className="truncate text-sm">{p.materialGrade}</p><p className="truncate text-muted-foreground">{p.standard || '—'}</p></div> },
    { id: 'wt', header: 'Weight', align: 'right', sortValue: (p) => p.standardWeightKg, cell: (p) => <span className="whitespace-nowrap font-mono">{p.standardWeightKg ? `${formatNumber(p.standardWeightKg, 2)} kg` : '—'}</span> },
    { id: 'price', header: 'Std. price', align: 'right', hideBelow: 'sm', cell: (p) => <span className="whitespace-nowrap font-mono">{p.standardSellingPrice ? formatINR(p.standardSellingPrice) : '—'}</span> },
    { id: 'hsn', header: 'HSN', hideBelow: 'lg', cell: (p) => <span className="font-mono text-xs">{p.hsnCode || '—'}</span> },
    { id: 'act', header: '', align: 'right', cell: (p) => rowMenu(p) },
  ];

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = isCustomers ? await deleteCustomerRecord(deleting.id) : await deleteProductRecord(deleting.id);
    if (res.success) toast.success(`${deleting.name} deleted`);
    else toast.error('Not deleted', { description: res.error });
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={isCustomers ? 'Customers' : 'Products'}
        description={isCustomers ? 'Who you sell to: contacts, credit limit and terms, and what they owe now.' : 'What you make: size, grade, standard, forged weight and HSN — used by quotations and orders.'}
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel}>
              <Download /> Export
            </Button>
            {canWrite && (
              <Button onClick={() => setEditing({})}>
                <Plus /> {isCustomers ? 'Add customer' : 'Add product'}
              </Button>
            )}
          </>
        }
      />

      {isCustomers ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Customers" icon={Building2} value={customers.length} hint={`${customers.filter((c) => c.active).length} active`} />
          <StatTile label="Over credit limit" icon={Building2} tone={customers.some((c) => c.creditLimit > 0 && dueFor(c) > c.creditLimit) ? 'danger' : 'neutral'} value={customers.filter((c) => c.creditLimit > 0 && dueFor(c) > c.creditLimit).length} />
          <StatTile label="With open orders" icon={Package} value={customers.filter((c) => salesOrders.some((o) => o.customerId === c.id && o.status !== 'completed')).length} />
          <StatTile label="No contact on file" icon={Building2} tone={customers.some((c) => !c.phone && !c.email) ? 'warning' : 'neutral'} value={customers.filter((c) => !c.phone && !c.email).length} hint="Missing phone and email" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Products" icon={Package} value={products.length} />
          <StatTile label="Grades" icon={Package} value={new Set(products.map((p) => p.materialGrade)).size} />
          <StatTile label="Missing weight" icon={Package} tone={products.some((p) => !p.standardWeightKg) ? 'warning' : 'neutral'} value={products.filter((p) => !p.standardWeightKg).length} hint="Needed for pricing" />
          <StatTile label="Missing HSN" icon={Package} tone={products.some((p) => !p.hsnCode) ? 'warning' : 'neutral'} value={products.filter((p) => !p.hsnCode).length} hint="Needed for invoices" />
        </div>
      )}

      {isCustomers ? (
        <DataTable rows={customers} columns={customerCols} rowKey={(c) => c.id} searchText={(c) => `${c.name} ${c.code} ${c.location} ${c.contactPerson} ${c.industry}`} searchPlaceholder="Search name, code, place or contact" initialSort={{ id: 'name' }} emptyTitle="No customers yet" />
      ) : (
        <DataTable rows={products} columns={productCols} rowKey={(p) => p.id} searchText={(p) => `${p.name} ${p.code} ${p.materialGrade} ${p.size} ${p.standard}`} searchPlaceholder="Search name, code, grade or size" initialSort={{ id: 'name' }} emptyTitle="No products yet" />
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent className="sm:max-w-xl">
            {isCustomers ? (
              <CustomerForm customer={editing.item as Customer | undefined} existing={customers} onDone={() => setEditing(null)} />
            ) : (
              <ProductForm product={editing.item as Product | undefined} existing={products} onDone={() => setEditing(null)} />
            )}
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        {deleting && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {deleting.name}?</DialogTitle>
              <DialogDescription>
                {isCustomers
                  ? ordersFor(deleting as Customer) > 0
                    ? `This customer has ${ordersFor(deleting as Customer)} order(s), so it cannot be deleted. Mark it inactive instead.`
                    : 'This cannot be undone. If you only stopped dealing with them, mark the customer inactive instead.'
                  : usesOf(deleting as Product) > 0
                  ? `This product is used in ${usesOf(deleting as Product)} order(s)/quotation(s) and cannot be deleted.`
                  : 'This cannot be undone.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={isCustomers ? ordersFor(deleting as Customer) > 0 : usesOf(deleting as Product) > 0} onClick={confirmDelete}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Shell({ title, error, saving, onCancel, onSubmit, children }: { title: string; error: string; saving: boolean; onCancel: () => void; onSubmit: () => void; children: React.ReactNode }) {
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
        <DialogDescription>Fields left blank stay blank; nothing is filled in for you.</DialogDescription>
      </DialogHeader>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
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

function CustomerForm({ customer, existing, onDone }: { customer?: Customer; existing: Customer[]; onDone: () => void }) {
  const { upsertCustomerRecord } = useRtdb();
  const [f, setF] = useState({
    name: customer?.name || '',
    code: customer?.code || '',
    contact: customer?.contactPerson || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    location: customer?.location || '',
    industry: customer?.industry || '',
    limit: customer?.creditLimit ? String(customer.creditLimit) : '',
    days: customer?.creditDays ? String(customer.creditDays) : '',
    owner: customer?.assignedSalesPerson || '',
    active: customer ? customer.active : true,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, clean?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: clean ? clean(e.target.value) : e.target.value }));

  const submit = async () => {
    if (f.name.trim().length < 2) return setError('Enter the customer name.');
    if (existing.some((c) => c.id !== customer?.id && c.name.trim().toLowerCase() === f.name.trim().toLowerCase())) return setError('A customer with this name already exists.');
    if (f.contact.trim().length < 2) return setError('Enter the contact person.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError('Enter a valid contact email.');
    setError('');
    setSaving(true);
    const id = customer?.id || newRecordId('CUST');
    const res = await upsertCustomerRecord(
      {
        ...(customer || { totalOrders: 0, totalOutstanding: 0 }),
        id,
        code: f.code.trim() || id,
        name: f.name.trim(),
        contactPerson: f.contact.trim(),
        phone: f.phone.trim(),
        email: f.email.trim().toLowerCase(),
        location: f.location.trim(),
        industry: f.industry.trim(),
        creditLimit: Number(f.limit) || 0,
        creditDays: Number(f.days) || 0,
        assignedSalesPerson: f.owner.trim(),
        active: f.active,
      } as Customer,
      !customer
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success(customer ? 'Customer updated' : 'Customer added', { description: f.name.trim() });
    onDone();
  };

  return (
    <Shell title={customer ? `Edit ${customer.name}` : 'Add customer'} error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="cu-name" className="sm:col-span-2">
          <Input id="cu-name" maxLength={160} value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Code (optional)" htmlFor="cu-code">
          <Input id="cu-code" className="font-mono" maxLength={40} value={f.code} onChange={set('code')} />
        </Field>
        <Field label="City / location" htmlFor="cu-loc">
          <Input id="cu-loc" maxLength={120} value={f.location} onChange={set('location')} />
        </Field>
        <Field label="Contact person" htmlFor="cu-contact">
          <Input id="cu-contact" maxLength={120} value={f.contact} onChange={set('contact')} />
        </Field>
        <Field label="Phone" htmlFor="cu-phone">
          <Input id="cu-phone" inputMode="tel" maxLength={30} value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email" htmlFor="cu-email">
          <Input id="cu-email" type="email" maxLength={160} value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Industry" htmlFor="cu-ind">
          <Input id="cu-ind" maxLength={80} value={f.industry} onChange={set('industry')} />
        </Field>
        <Field label="Credit limit (₹)" htmlFor="cu-limit">
          <Input id="cu-limit" inputMode="numeric" value={f.limit} onChange={set('limit', digits)} />
        </Field>
        <Field label="Credit days" htmlFor="cu-days">
          <Input id="cu-days" inputMode="numeric" value={f.days} onChange={set('days', digits)} />
        </Field>
        <Field label="Sales owner" htmlFor="cu-owner">
          <Input id="cu-owner" maxLength={80} value={f.owner} onChange={set('owner')} />
        </Field>
        <Field label="Status" htmlFor="cu-active">
          <Select id="cu-active" value={f.active ? '1' : '0'} onChange={(e) => setF((p) => ({ ...p, active: e.target.value === '1' }))}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </Select>
        </Field>
      </div>
    </Shell>
  );
}

function ProductForm({ product, existing, onDone }: { product?: Product; existing: Product[]; onDone: () => void }) {
  const { upsertProductRecord } = useRtdb();
  const [f, setF] = useState({
    name: product?.name || '',
    code: product?.code || '',
    category: product?.category || ('' as Product['category'] | ''),
    size: product?.size || '',
    grade: product?.materialGrade || '',
    standard: product?.standard || '',
    uom: product?.uom || ('PCS' as Product['uom']),
    weight: product?.standardWeightKg ? String(product.standardWeightKg) : '',
    hsn: product?.hsnCode || '',
    price: product?.standardSellingPrice ? String(product.standardSellingPrice) : '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, clean?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: clean ? clean(e.target.value) : e.target.value }));

  const submit = async () => {
    if (f.name.trim().length < 2) return setError('Enter the product name.');
    if (!f.category) return setError('Choose the category.');
    if (!f.grade.trim()) return setError('Enter the material grade.');
    if (!(Number(f.weight) > 0)) return setError('Enter the forged weight per piece in kg.');
    if (f.code.trim() && existing.some((p) => p.id !== product?.id && p.code.trim().toLowerCase() === f.code.trim().toLowerCase())) return setError('Another product already uses this code.');
    setError('');
    setSaving(true);
    const id = product?.id || newRecordId('PROD');
    const res = await upsertProductRecord(
      {
        ...(product || {}),
        id,
        code: f.code.trim() || id,
        name: f.name.trim(),
        category: f.category as Product['category'],
        size: f.size.trim(),
        materialGrade: f.grade.trim(),
        standard: f.standard.trim(),
        uom: f.uom,
        standardWeightKg: Number(f.weight),
        hsnCode: f.hsn.trim(),
        standardSellingPrice: Number(f.price) || 0,
      } as Product,
      !product
    );
    setSaving(false);
    if (!res.success) return setError(res.error || 'Not saved.');
    toast.success(product ? 'Product updated' : 'Product added', { description: f.name.trim() });
    onDone();
  };

  return (
    <Shell title={product ? `Edit ${product.name}` : 'Add product'} error={error} saving={saving} onCancel={onDone} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="pd-name" className="sm:col-span-2">
          <Input id="pd-name" maxLength={160} value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Code (optional)" htmlFor="pd-code">
          <Input id="pd-code" className="font-mono" maxLength={40} value={f.code} onChange={set('code')} />
        </Field>
        <Field label="Category" htmlFor="pd-cat">
          <Select id="pd-cat" value={f.category} onChange={set('category')}>
            <option value="">Choose</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Size / rating" htmlFor="pd-size">
          <Input id="pd-size" maxLength={80} value={f.size} onChange={set('size')} />
        </Field>
        <Field label="Material grade" htmlFor="pd-grade">
          <Input id="pd-grade" maxLength={64} value={f.grade} onChange={set('grade')} />
        </Field>
        <Field label="Standard" htmlFor="pd-std">
          <Input id="pd-std" maxLength={64} value={f.standard} onChange={set('standard')} />
        </Field>
        <Field label="Unit" htmlFor="pd-uom">
          <Select id="pd-uom" value={f.uom} onChange={set('uom')}>
            <option>PCS</option>
            <option>KG</option>
            <option>MT</option>
          </Select>
        </Field>
        <Field label="Forged weight per piece (kg)" htmlFor="pd-wt">
          <Input id="pd-wt" inputMode="decimal" value={f.weight} onChange={set('weight', decimal)} />
        </Field>
        <Field label="HSN code" htmlFor="pd-hsn">
          <Input id="pd-hsn" className="font-mono" inputMode="numeric" maxLength={10} value={f.hsn} onChange={set('hsn', digits)} />
        </Field>
        <Field label="Standard price (₹, optional)" htmlFor="pd-price">
          <Input id="pd-price" inputMode="decimal" value={f.price} onChange={set('price', decimal)} />
        </Field>
      </div>
    </Shell>
  );
}
