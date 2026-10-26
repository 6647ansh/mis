/**
 * One-time move of order value, rates and invoice amounts out of /salesOrders into
 * /orderCommercials, so production, stores, quality and dispatch can read orders
 * without seeing prices (Montex decision). Until an order is moved, the new rules
 * refuse updates to it.
 *
 * Dry run by default; `--apply` writes. Needs Firebase Admin credentials.
 *
 *   npx tsx scripts/split-order-commercials.ts            # dry run
 *   npx tsx scripts/split-order-commercials.ts --apply    # write
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestoreInstance, SERVER_FIRESTORE_DATABASE_ID } from '../server/config/firebaseAdmin';

const APPLY = process.argv.includes('--apply');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error(
      'Firebase Admin credentials are not set. Set GOOGLE_APPLICATION_CREDENTIALS or ' +
        'FIREBASE_SERVICE_ACCOUNT_JSON, then run this again.'
    );
    process.exit(1);
  }
  console.log(`Split order values (${APPLY ? 'APPLY' : 'DRY RUN'}) on ${SERVER_FIRESTORE_DATABASE_ID}\n`);

  const db = getAdminFirestoreInstance();
  const orders = await db.collection('salesOrders').get();
  let moved = 0;
  let clean = 0;

  for (const snap of orders.docs) {
    const order = snap.data();
    const stage = Array.isArray(order.stages) && order.stages[0] ? { ...order.stages[0] } : null;
    const lineItem = stage?.lineItem ? { ...stage.lineItem } : null;
    const invoice = stage?.invoiceStatus ? { ...stage.invoiceStatus } : null;

    const commercial: Record<string, number> = {};
    const total = num(order.totalValueINR);
    if (total !== undefined) commercial.totalValueINR = total;
    if (num(lineItem?.ratePerUnit) !== undefined) commercial.ratePerUnitINR = lineItem.ratePerUnit;
    if (num(lineItem?.totalAmount) !== undefined) commercial.lineTotalINR = lineItem.totalAmount;
    if (num(invoice?.invoiceAmount) !== undefined) commercial.invoiceAmountINR = invoice.invoiceAmount;
    if (num(invoice?.paidAmount) !== undefined) commercial.paidAmountINR = invoice.paidAmount;
    if (num(invoice?.outstandingAmount) !== undefined) commercial.outstandingAmountINR = invoice.outstandingAmount;

    if (Object.keys(commercial).length === 0) {
      clean++;
      continue;
    }
    moved++;
    console.log(`  ${snap.id}: ${Object.entries(commercial).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (!APPLY) continue;

    const nowIso = new Date().toISOString();
    const comRef = db.collection('orderCommercials').doc(snap.id);
    const existing = await comRef.get();
    if (lineItem) {
      delete lineItem.ratePerUnit;
      delete lineItem.totalAmount;
      stage.lineItem = lineItem;
    }
    if (invoice) {
      delete invoice.invoiceAmount;
      delete invoice.paidAmount;
      delete invoice.outstandingAmount;
      stage.invoiceStatus = invoice;
    }

    const batch = db.batch();
    batch.set(
      comRef,
      {
        orderId: snap.id,
        totalValueINR: commercial.totalValueINR ?? 0,
        ...commercial,
        updatedBy: 'split-order-commercials',
        createdAt: existing.exists ? existing.get('createdAt') : nowIso,
        updatedAt: nowIso,
        dataOrigin: 'production',
      },
      { merge: true }
    );
    batch.update(snap.ref, {
      totalValueINR: FieldValue.delete(),
      ...(stage ? { stages: [stage, ...order.stages.slice(1)] } : {}),
      updatedAt: nowIso,
    });
    await batch.commit();
  }

  console.log(
    `\n${orders.size} orders: ${APPLY ? 'moved' : 'would move'} values for ${moved}, ${clean} already clean.` +
      (APPLY ? '' : '\nRun again with --apply to write.')
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Split failed:', err?.message || err);
  process.exit(1);
});
