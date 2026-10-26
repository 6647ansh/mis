/**
 * Fills the LOCAL Firebase emulators with sample Montex data and one Google user per
 * role, for UI development and end-to-end checks. Refuses to run against a real project.
 *
 *   npx firebase emulators:start --only auth,firestore --project montex-mis
 *   npm run seed:emulator
 *   VITE_FIREBASE_EMULATORS=true npm run dev
 *   (in the browser console) __montexEmulatorSignIn('ceo@montex.test')
 *
 * Every record is marked dataOrigin 'demo_sandbox'.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import appletConfig from '../firebase-applet-config.json';
import {
  MOCK_ACTION_QUEUE,
  MOCK_CUSTOMERS,
  MOCK_ORDER_JOURNEYS,
  MOCK_OUTSTANDING_AGEING,
  MOCK_PRODUCTS,
  MOCK_RAW_MATERIALS,
  MOCK_STOCK_MOVEMENTS,
} from '../src/data/mockData';
import {
  INITIAL_FURNACE_BATCH_LOGS,
  INITIAL_HANDOVERS,
  INITIAL_JOB_COST_SHEETS,
  INITIAL_SHOP_MACHINE_LOGS,
  INITIAL_MAINTENANCE_TICKETS,
  INITIAL_NCR_CAPA_RECORDS,
  INITIAL_PAYMENT_FOLLOW_UPS,
  INITIAL_POWER_LOGS,
  INITIAL_PURCHASE_ORDERS,
  INITIAL_PURCHASE_REQUISITIONS,
  INITIAL_QUOTATIONS,
  INITIAL_STEEL_MILLS,
  INITIAL_TASKS,
  INITIAL_TENDERS,
} from '../src/data/requirementsRegister';
import * as M from '../src/services/firestoreMappers';
import { COLLECTION_PRIMARY_KEY_FIELD, FirestoreCollectionName } from '../src/services/firestoreService';
import { ROLE_PERMISSION_DEFAULTS, UserRole } from '../src/types/roles';
import { UserProfile } from '../src/types/mis';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('Refusing to seed: FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST must point at the local emulators.');
  process.exit(1);
}

const app = initializeApp({ projectId: appletConfig.projectId || 'montex-mis' });
const db = getFirestore(app, appletConfig.firestoreDatabaseId);
const auth = getAuth(app);

const PEOPLE: { role: UserRole; name: string; department: string }[] = [
  { role: 'super_admin', name: 'Admin Demo', department: 'Information Technology' },
  { role: 'ceo', name: 'CEO Demo', department: 'Top Management' },
  { role: 'sales', name: 'Sales Demo', department: 'Sales & Marketing' },
  { role: 'purchase', name: 'Purchase Demo', department: 'Procurement' },
  { role: 'stores', name: 'Stores Demo', department: 'Stores & Production' },
  { role: 'quality', name: 'Quality Demo', department: 'Quality Assurance' },
  { role: 'dispatch', name: 'Dispatch Demo', department: 'Logistics' },
  { role: 'finance', name: 'Finance Demo', department: 'Finance & Accounts' },
];

async function put(collection: FirestoreCollectionName, records: any[], map: (r: any) => Record<string, any>) {
  let ok = 0;
  let skipped = 0;
  for (const record of records) {
    try {
      const doc = JSON.parse(JSON.stringify(map(record))); // drop undefined fields, as the app's writer does
      await db.collection(collection).doc(String(doc[COLLECTION_PRIMARY_KEY_FIELD[collection]])).set(doc);
      ok++;
    } catch {
      skipped++;
    }
  }
  console.log(`  ${collection.padEnd(22)} ${ok} written${skipped ? `, ${skipped} skipped (incomplete sample)` : ''}`);
}

async function main() {
  console.log('Seeding emulators…');
  const nowIso = new Date().toISOString();

  for (const person of PEOPLE) {
    const email = `${person.role.replace('_', '')}@montex.test`;
    const uid = `demo-${person.role}`;
    // Link a fake Google identity so the emulator's Google sign-in lands on this uid.
    await auth.deleteUser(uid).catch(() => undefined);
    await auth.importUsers([
      { uid, email, displayName: person.name, emailVerified: true, providerData: [{ uid: email, email, displayName: person.name, providerId: 'google.com' }] },
    ]);
    const profile = M.mapUserProfileToFirestoreDoc(
      {
        id: uid,
        uid,
        name: person.name,
        displayName: person.name,
        email,
        role: person.role,
        roleTitle: person.name,
        department: person.department,
        avatarInitials: person.name.slice(0, 2).toUpperCase(),
        accountStatus: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        permissions: ROLE_PERMISSION_DEFAULTS[person.role],
      } as UserProfile,
      'demo_sandbox'
    );
    await db.collection('users').doc(uid).set(profile);
  }
  console.log(`  users                  ${PEOPLE.length} (sign in as <role>@montex.test, e.g. superadmin@montex.test)`);

  const demo = 'demo_sandbox' as const;
  await put('customers', MOCK_CUSTOMERS, (r) => M.mapCustomerToFirestoreDoc(r, demo));
  await put('products', MOCK_PRODUCTS, (r) => M.mapProductToFirestoreDoc(r, demo));
  await put('salesOrders', MOCK_ORDER_JOURNEYS, (r) => M.mapSalesOrderToFirestoreDoc(r, demo));
  await put('orderCommercials', MOCK_ORDER_JOURNEYS, (r) => M.mapOrderCommercialToFirestoreDoc(r, 'seed', undefined, demo));
  await put('rawMaterials', MOCK_RAW_MATERIALS, (r) => M.mapRawMaterialToFirestoreDoc(r, demo));
  await put('stockMovements', MOCK_STOCK_MOVEMENTS, (r) => M.mapStockMovementToFirestoreDoc(r, r.materialId, demo));
  await put('outstandingPayments', MOCK_OUTSTANDING_AGEING, (r) => M.mapOutstandingToFirestoreDoc(r, demo));
  await put('actionQueue', MOCK_ACTION_QUEUE, (r) => M.mapActionQueueToFirestoreDoc(r, demo));
  await put('quotations', INITIAL_QUOTATIONS, (r) => M.mapQuotationToFirestoreDoc(r, demo));
  await put('tenders', INITIAL_TENDERS, (r) => M.mapTenderToFirestoreDoc(r, demo));
  await put('suppliers', INITIAL_STEEL_MILLS, (r) => M.mapSupplierToFirestoreDoc(r, demo));
  await put('purchaseOrders', INITIAL_PURCHASE_ORDERS, (r) => M.mapPurchaseOrderToFirestoreDoc(r, demo));
  await put('machineLogs', INITIAL_SHOP_MACHINE_LOGS, (r) => M.mapMachineLogToFirestoreDoc(r, demo));
  await put('furnaceLogs', INITIAL_FURNACE_BATCH_LOGS, (r) => M.mapFurnaceLogToFirestoreDoc(r, demo));
  await put('maintenanceTickets', INITIAL_MAINTENANCE_TICKETS, (r) => M.mapMaintenanceTicketToFirestoreDoc(r, demo));
  await put('powerLogs', INITIAL_POWER_LOGS, (r) => M.mapPowerLogToFirestoreDoc(r, demo));
  await put('jobCostSheets', INITIAL_JOB_COST_SHEETS, (r) => M.mapJobCostSheetToFirestoreDoc(r, demo));
  await put('tasks', INITIAL_TASKS, (r) => M.mapTaskToFirestoreDoc(r, demo));
  await put('handovers', INITIAL_HANDOVERS, (r) => M.mapHandoverToFirestoreDoc(r, demo));
  await put('purchaseRequisitions', INITIAL_PURCHASE_REQUISITIONS, (r) => M.mapPurchaseRequisitionToFirestoreDoc(r, demo));
  await put('ncrCapaRecords', INITIAL_NCR_CAPA_RECORDS, (r) => M.mapNcrCapaToFirestoreDoc(r, demo));
  await put('paymentFollowUps', INITIAL_PAYMENT_FOLLOW_UPS, (r) => M.mapPaymentFollowUpToFirestoreDoc(r, demo));
  console.log('Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err?.message || err);
  process.exit(1);
});
