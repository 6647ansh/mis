/**
 * Firestore security rules tests, run against the real Firestore emulator.
 *
 *   npm run test:rules
 *
 * (`firebase emulators:exec` starts the emulator, runs this file, then stops it.)
 * Each case states the business rule it protects; the blueprint bugs are marked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import {
  mapQualityInspectionToFirestoreDoc,
  mapUserProfileToFirestoreDoc,
} from '../src/services/firestoreMappers';
import { UserProfile, UserRole } from '../src/types/mis';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_EMAIL = 'anshyadav6647@gmail.com';

type Status = UserProfile['accountStatus'];

function profile(uid: string, role: UserRole, accountStatus: Status): Record<string, any> {
  return mapUserProfileToFirestoreDoc({
    id: uid,
    uid,
    name: `Test ${uid}`,
    displayName: `Test ${uid}`,
    email: `${uid}@example.com`,
    role,
    roleTitle: role,
    department: 'Operations',
    avatarInitials: 'TT',
    accountStatus,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    permissions: [],
  } as UserProfile);
}

function inspection(id: string, inspected: number, passed: number, rejected: number) {
  return mapQualityInspectionToFirestoreDoc({
    id,
    jobNumber: 'JOB-TEST-1',
    customer: 'Test Customer',
    product: 'Flange',
    grade: 'A105',
    heatNo: 'H-1',
    inspectedQty: inspected,
    passedQty: passed,
    rejectedQty: rejected,
    status: 'in_progress',
    inspector: 'Inspector',
    date: '2026-10-26',
    mtcNumber: '',
  });
}

function salesOrder(orderId: string): Record<string, any> {
  return {
    orderId,
    customerName: 'Test Customer',
    productName: 'Flange',
    steelGrade: 'A105',
    quantityMT: 10,
    orderDate: '2026-10-01',
    committedDeliveryDate: '2026-11-15',
    currentStage: 'Ready for Dispatch',
    overallStatus: 'On Track',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function consignment(id: string, salesOrderId: string): Record<string, any> {
  return {
    id,
    orderId: 'JOB-TEST-1',
    salesOrderId,
    customerName: 'Test Customer',
    quantityTons: 2,
    dispatchDate: '2026-10-26',
    status: 'Scheduled',
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
  };
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  // RULES_TEST_FILTER=text runs only the cases whose name contains text.
  if (process.env.RULES_TEST_FILTER && !name.toLowerCase().includes(process.env.RULES_TEST_FILTER.toLowerCase())) return;
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err: any) {
    results.push({ name, ok: false, detail: err?.message || String(err) });
  }
}

async function main() {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'montex-mis-rules-test',
    firestore: { rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin1'), profile('admin1', 'super_admin', 'active'));
    await setDoc(doc(db, 'users/ceo1'), profile('ceo1', 'ceo', 'active'));
    await setDoc(doc(db, 'users/sales1'), profile('sales1', 'sales', 'active'));
    await setDoc(doc(db, 'users/quality1'), profile('quality1', 'quality', 'active'));
    await setDoc(doc(db, 'users/dispatch1'), profile('dispatch1', 'dispatch', 'active'));
    await setDoc(doc(db, 'users/pending1'), profile('pending1', 'sales', 'pending_approval'));
    await setDoc(doc(db, 'users/pending2'), profile('pending2', 'sales', 'pending_approval'));
    await setDoc(doc(db, 'users/pending3'), profile('pending3', 'quality', 'pending_approval'));
    await setDoc(doc(db, 'users/rejected1'), profile('rejected1', 'sales', 'rejected'));
    await setDoc(doc(db, 'users/deact1'), profile('deact1', 'sales', 'deactivated'));
    await setDoc(doc(db, 'salesOrders/ORD-1'), salesOrder('ORD-1'));
    await setDoc(doc(db, 'salesOrders/ORD-2'), salesOrder('ORD-2'));
    await setDoc(doc(db, 'users/finance1'), profile('finance1', 'finance', 'active'));
    await setDoc(doc(db, 'orderCommercials/ORD-1'), {
      orderId: 'ORD-1',
      totalValueINR: 500000,
      ratePerUnitINR: 1250,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await setDoc(doc(db, 'systemConfig/dashboardKpis'), {
      configId: 'dashboardKpis',
      configType: 'dashboardKpis',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  const as = (uid: string, email = `${uid}@example.com`) =>
    env.authenticatedContext(uid, { email, email_verified: true }).firestore();
  const anon = env.unauthenticatedContext().firestore();

  // --- Access gate -------------------------------------------------------
  await check('Signed-out visitor cannot read business data', () =>
    assertFails(getDoc(doc(anon, 'salesOrders/ORD-1')))
  );
  await check('Active sales user can read sales orders', () =>
    assertSucceeds(getDoc(doc(as('sales1'), 'salesOrders/ORD-1')))
  );
  await check('Pending employee cannot read business data', () =>
    assertFails(getDoc(doc(as('pending1'), 'salesOrders/ORD-1')))
  );
  await check('Rejected employee cannot read business data', () =>
    assertFails(getDoc(doc(as('rejected1'), 'salesOrders/ORD-1')))
  );
  await check('Deactivated employee cannot read business data', () =>
    assertFails(getDoc(doc(as('deact1'), 'salesOrders/ORD-1')))
  );
  await check('Deactivated employee cannot read own profile (app treats this as deactivated)', () =>
    assertFails(getDoc(doc(as('deact1'), 'users/deact1')))
  );
  await check('Pending employee can read own profile (to see approval)', () =>
    assertSucceeds(getDoc(doc(as('pending1'), 'users/pending1')))
  );

  // --- Listing (queries) — the old rules refused every listing -------------
  await check('Active sales user can list sales orders', () =>
    assertSucceeds(getDocs(collection(as('sales1'), 'salesOrders')))
  );
  await check('Active quality user can list customers', () =>
    assertSucceeds(getDocs(collection(as('quality1'), 'customers')))
  );
  await check('CEO can list employees', () => assertSucceeds(getDocs(collection(as('ceo1'), 'users'))));
  await check('Sales user cannot list employees', () => assertFails(getDocs(collection(as('sales1'), 'users'))));
  await check('Pending employee cannot list sales orders', () =>
    assertFails(getDocs(collection(as('pending1'), 'salesOrders')))
  );
  await check('Finance can list order values', () =>
    assertSucceeds(getDocs(collection(as('finance1'), 'orderCommercials')))
  );
  await check('Dispatch cannot list order values', () =>
    assertFails(getDocs(collection(as('dispatch1'), 'orderCommercials')))
  );

  // --- Self-registration and escalation ----------------------------------
  await check('New Google user can file a pending access request', () =>
    assertSucceeds(setDoc(doc(as('new1'), 'users/new1'), profile('new1', 'sales', 'pending_approval')))
  );
  await check('New Google user can file the full request the app sends', () => {
    const now = '2026-10-27T00:00:00.000Z';
    const full = mapUserProfileToFirestoreDoc({
      id: 'new9',
      uid: 'new9',
      name: 'Priya Test',
      displayName: 'Priya Test',
      email: 'new9@example.com',
      role: 'sales',
      requestedRole: 'sales',
      requestedDepartment: 'Sales & Marketing',
      rbacGroup: 'Sales',
      roleTitle: 'Pending Admin Approval (Requested: SALES — Sales & Marketing)',
      designation: 'Pending Admin Approval',
      department: 'Sales & Marketing',
      avatarInitials: 'PT',
      accountStatus: 'pending_approval',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      approvalHistory: [{ status: 'pending_approval', actorUid: 'new9', actorEmail: 'new9@example.com', actorName: 'Priya Test', timestamp: now, notes: 'x' }],
      permissions: [],
      isDepartmentHead: false,
      dataOrigin: 'production',
    } as UserProfile);
    return assertSucceeds(setDoc(doc(as('new9'), 'users/new9'), full));
  });
  await check('New user can read back their own access request', () =>
    assertSucceeds(getDoc(doc(as('new9'), 'users/new9')))
  );
  await check('Access request must carry the signed-in Google email', () =>
    assertFails(setDoc(doc(as('new8'), 'users/new8'), { ...profile('new8', 'sales', 'pending_approval'), email: 'boss@example.com' }))
  );
  await check('Access request cannot arrive pre-approved', () =>
    assertFails(setDoc(doc(as('new7'), 'users/new7'), { ...profile('new7', 'sales', 'pending_approval'), approvedByUid: 'someone' }))
  );
  await check('New user cannot create themselves as active', () =>
    assertFails(setDoc(doc(as('new2'), 'users/new2'), profile('new2', 'sales', 'active')))
  );
  await check('New user cannot request super_admin', () =>
    assertFails(setDoc(doc(as('new3'), 'users/new3'), profile('new3', 'super_admin', 'pending_approval')))
  );
  await check('Active sales user cannot promote themselves', () =>
    assertFails(updateDoc(doc(as('sales1'), 'users/sales1'), { role: 'super_admin', legacyRole: 'super_admin' }))
  );
  await check('Pending employee cannot approve themselves', () =>
    assertFails(
      updateDoc(doc(as('pending2'), 'users/pending2'), {
        accountStatus: 'active',
        status: 'Active',
        updatedAt: '2026-10-26T09:00:00.000Z',
      })
    )
  );
  await check('BLUEPRINT BUG: rejected employee cannot flip themselves back to pending', () =>
    assertFails(
      setDoc(doc(as('rejected1'), 'users/rejected1'), {
        ...profile('rejected1', 'sales', 'pending_approval'),
        createdAt: '2026-10-01T00:00:00.000Z',
      })
    )
  );
  await check('CEO cannot promote anyone to super_admin', () =>
    assertFails(updateDoc(doc(as('ceo1'), 'users/sales1'), { role: 'super_admin', legacyRole: 'super_admin' }))
  );

  await check('Active employee can update their own last-login time', () =>
    assertSucceeds(updateDoc(doc(as('sales1'), 'users/sales1'), { lastLoginAt: '2026-10-26T09:00:00.000Z' }))
  );
  await check('Pending employee can update their own requested department', () =>
    assertSucceeds(
      updateDoc(doc(as('pending2'), 'users/pending2'), {
        requestedDepartment: 'Quality',
        updatedAt: '2026-10-26T09:00:00.000Z',
      })
    )
  );

  // --- Employee governance ----------------------------------------------
  await check('Super Admin can reject a pending request', () =>
    assertSucceeds(
      setDoc(doc(as('admin1'), 'users/pending1'), {
        ...profile('pending1', 'sales', 'rejected'),
        rejectedByUid: 'admin1',
        rejectionReason: 'Not a Montex employee',
      })
    )
  );
  await check('CEO can approve a pending quality request', () =>
    assertSucceeds(
      setDoc(doc(as('ceo1'), 'users/pending3'), {
        ...profile('pending3', 'quality', 'active'),
        approvedByUid: 'ceo1',
      })
    )
  );
  await check('Sales user cannot approve anyone', () =>
    assertFails(updateDoc(doc(as('sales1'), 'users/rejected1'), { accountStatus: 'active', status: 'Active' }))
  );

  // --- KPIs and targets -------------------------------------------------
  await check('CEO can set the monthly sales target', () =>
    assertSucceeds(
      updateDoc(doc(as('ceo1'), 'systemConfig/dashboardKpis'), {
        monthlySalesTarget: 45000000,
        updatedAt: '2026-10-26T00:00:00.000Z',
      })
    )
  );
  await check('Dispatch user cannot change the monthly sales target', () =>
    assertFails(
      updateDoc(doc(as('dispatch1'), 'systemConfig/dashboardKpis'), {
        monthlySalesTarget: 1,
        updatedAt: '2026-10-26T00:00:00.000Z',
      })
    )
  );

  // --- Quality ------------------------------------------------------------
  await check('BLUEPRINT BUG: 500 inspected, 500 passed, 8 rejected is refused', () =>
    assertFails(setDoc(doc(as('quality1'), 'qualityInspections/QC-1'), inspection('QC-1', 500, 500, 8)))
  );
  await check('A consistent lot (500 = 492 + 8) is accepted from Quality', () =>
    assertSucceeds(setDoc(doc(as('quality1'), 'qualityInspections/QC-2'), inspection('QC-2', 500, 492, 8)))
  );
  await check('Rework larger than the rejected quantity is refused', () =>
    assertFails(
      setDoc(doc(as('quality1'), 'qualityInspections/QC-4'), {
        ...inspection('QC-4', 100, 90, 10),
        reworkQtyMT: 12,
      })
    )
  );
  await check('Rework within the rejected quantity is accepted', () =>
    assertSucceeds(
      setDoc(doc(as('quality1'), 'qualityInspections/QC-5'), {
        ...inspection('QC-5', 100, 90, 10),
        reworkQtyMT: 4,
      })
    )
  );
  await check('Sales cannot record a quality inspection', () =>
    assertFails(setDoc(doc(as('sales1'), 'qualityInspections/QC-3'), inspection('QC-3', 10, 10, 0)))
  );

  // --- Order value is visible to commercial roles only (Montex) -----------
  await check('Dispatch cannot read order value', () =>
    assertFails(getDoc(doc(as('dispatch1'), 'orderCommercials/ORD-1')))
  );
  await check('Quality cannot read order value', () =>
    assertFails(getDoc(doc(as('quality1'), 'orderCommercials/ORD-1')))
  );
  await check('Finance can read order value', () =>
    assertSucceeds(getDoc(doc(as('finance1'), 'orderCommercials/ORD-1')))
  );
  await check('Sales can update order value', () =>
    assertSucceeds(
      updateDoc(doc(as('sales1'), 'orderCommercials/ORD-1'), {
        totalValueINR: 520000,
        updatedAt: '2026-10-26T00:00:00.000Z',
      })
    )
  );
  await check('Order value cannot be written into the order itself', () =>
    assertFails(updateDoc(doc(as('sales1'), 'salesOrders/ORD-2'), { totalValueINR: 1 }))
  );

  // --- Dispatch clearances (both mandatory, confirmed by Montex) ---------
  const clear = (kind: 'quality' | 'finance', uid: string) => ({
    [`${kind}ClearedBy`]: uid,
    [`${kind}ClearedAt`]: '2026-10-26T10:00:00.000Z',
    updatedAt: '2026-10-26T10:00:00.000Z',
  });
  await check('Dispatch cannot be created for an order without clearances', () =>
    assertFails(setDoc(doc(as('dispatch1'), 'dispatches/DSP-1'), consignment('DSP-1', 'ORD-1')))
  );
  await check('Sales cannot give quality clearance', () =>
    assertFails(updateDoc(doc(as('sales1'), 'salesOrders/ORD-1'), clear('quality', 'sales1')))
  );
  await check('Quality cannot give finance clearance', () =>
    assertFails(updateDoc(doc(as('quality1'), 'salesOrders/ORD-1'), clear('finance', 'quality1')))
  );
  await check('Quality cannot sign a clearance in someone else\'s name', () =>
    assertFails(updateDoc(doc(as('quality1'), 'salesOrders/ORD-1'), clear('quality', 'ceo1')))
  );
  await check('Quality gives quality clearance', () =>
    assertSucceeds(updateDoc(doc(as('quality1'), 'salesOrders/ORD-1'), clear('quality', 'quality1')))
  );
  await check('Dispatch still blocked with quality clearance only', () =>
    assertFails(setDoc(doc(as('dispatch1'), 'dispatches/DSP-2'), consignment('DSP-2', 'ORD-1')))
  );
  await check('Finance gives finance clearance', () =>
    assertSucceeds(updateDoc(doc(as('finance1'), 'salesOrders/ORD-1'), clear('finance', 'finance1')))
  );
  await check('Dispatch allowed once both clearances are given', () =>
    assertSucceeds(setDoc(doc(as('dispatch1'), 'dispatches/DSP-3'), consignment('DSP-3', 'ORD-1')))
  );
  await check('Dispatch without a linked sales order is refused', () =>
    assertFails(
      setDoc(doc(as('dispatch1'), 'dispatches/DSP-4'), (({ salesOrderId, ...rest }) => rest)(consignment('DSP-4', 'ORD-2')))
    )
  );

  await env.cleanup();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.detail}`}`);
  }
  console.log(`\nFirestore rules: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
