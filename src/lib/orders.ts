import type { Customer, OrderJourney, Product } from '../types/mis';

/** Next job number in the PO year's series (JOB-MF-YYYY-NNNN); Firestore refuses a duplicate id. */
export function nextJobNumber(orders: OrderJourney[], year: string) {
  const seq =
    Math.max(
      0,
      ...orders
        .map((o) => o.jobNumber.match(new RegExp(`^JOB-MF-${year}-(\\d+)$`)))
        .filter(Boolean)
        .map((m) => Number(m![1]))
    ) + 1;
  return `JOB-MF-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * A new order exactly as the customer PO states it. Later stages are filled by Stores,
 * Quality, Dispatch and Finance; nothing downstream is pre-assumed.
 */
export function buildNewOrder(p: {
  orders: OrderJourney[];
  customer: Customer;
  product: Product;
  poNumber: string;
  poDate: string;
  deliveryDate: string;
  qty: number;
  rate: number;
  statusLabel?: string;
}): OrderJourney {
  const { customer: cust, product: prod, qty, rate } = p;
  const year = p.poDate.slice(0, 4);
  const jobNumber = nextJobNumber(p.orders, year);
  const id = `ORD-${year}-${Date.now().toString(36).toUpperCase()}`;
  const total = qty * rate;
  const today = new Date().toISOString().slice(0, 10);
  return {
    id,
    poNumber: p.poNumber.trim(),
    poDate: p.poDate,
    jobNumber,
    customerId: cust.id,
    customerName: cust.name,
    totalValue: total,
    currency: 'INR',
    expectedDeliveryDate: p.deliveryDate,
    targetDeliveryDate: p.deliveryDate,
    status: 'material_pending',
    statusLabel: p.statusLabel || 'New order — awaiting material allocation',
    lineItems: [
      {
        id: `${id}-L1`,
        salesOrderId: id,
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        materialGrade: prod.materialGrade,
        size: prod.size,
        orderedQty: qty,
        uom: prod.uom || 'PCS',
        ratePerUnit: rate,
        totalAmount: total,
        producedQty: 0,
        inspectedOkQty: 0,
        rejectedQty: 0,
        dispatchedQty: 0,
        pendingQty: qty,
      },
    ],
    materialStatus: { state: 'shortage', materialGrade: prod.materialGrade, heatNumber: '', requiredKg: Math.round(qty * (prod.standardWeightKg || 0)), allocatedKg: 0, supplierName: '', lastUpdated: today, notes: 'Not yet allocated by Stores.' },
    qualityStatus: { state: 'pending', inspectorName: '', inspectionDate: '', mtcNumber: '', mtcStatus: 'draft', testTypes: [] },
    clearanceStatus: { state: 'pending', agency: '', inspectorName: '', clearanceDate: '', clearanceRefNo: '', remarks: '' },
    dispatchStatus: { state: 'pending', totalShippedQty: 0, balanceQty: qty, transporterName: '', vehicleNo: '', lrNumber: '', dispatchDate: '', destinationCity: cust.location || '' },
    invoiceStatus: { state: 'pending', invoiceNumber: '', invoiceDate: '', invoiceAmount: 0, paidAmount: 0, paymentDueDate: '', tallySyncStatus: 'pending_import', outstandingAmount: 0 },
  } as OrderJourney;
}
