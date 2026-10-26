/**
 * One-time migration: Realtime Database → Cloud Firestore.
 *
 * Firestore is the only source of truth for Montex MIS. This script copies the
 * business records that still exist only in the Realtime Database.
 *
 * Safety:
 *  - Dry run by default: prints what would happen and writes nothing.
 *  - `--apply` writes. Each document is created with `create()`, so a record that
 *    already exists in Firestore is never overwritten (Firestore wins).
 *  - Employee profiles are copied as `pending_approval` with no permissions, so an
 *    administrator re-approves each one. Pass `--keep-user-status` to keep the
 *    RTDB status instead.
 *  - Dashboard KPIs, alert thresholds and audit logs are reported, not copied.
 *
 * Needs Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS or
 * FIREBASE_SERVICE_ACCOUNT_JSON), the same as the Express server.
 *
 *   npx tsx scripts/migrate-rtdb-to-firestore.ts              # dry run
 *   npx tsx scripts/migrate-rtdb-to-firestore.ts --apply      # write
 */
import {
  getAdminFirestoreInstance,
  getAdminRtdbInstance,
  SERVER_FIRESTORE_DATABASE_ID,
  SERVER_RTDB_URL,
} from '../server/config/firebaseAdmin';
import {
  mapActionQueueToFirestoreDoc,
  mapCustomerToFirestoreDoc,
  mapDispatchToFirestoreDoc,
  mapOutstandingToFirestoreDoc,
  mapProductToFirestoreDoc,
  mapQualityInspectionToFirestoreDoc,
  mapRawMaterialToFirestoreDoc,
  mapSalesOrderToFirestoreDoc,
  mapStockMovementToFirestoreDoc,
  mapUserProfileToFirestoreDoc,
} from '../src/services/firestoreMappers';
import {
  COLLECTION_PRIMARY_KEY_FIELD,
  FirestoreCollectionName,
} from '../src/services/firestoreService';
import { resolveUserRoleMapping } from '../src/services/misDataValidator';
import { UserProfile } from '../src/types/mis';

const APPLY = process.argv.includes('--apply');
const KEEP_USER_STATUS = process.argv.includes('--keep-user-status');

type Mapper = (record: any) => Record<string, any>;

const PLAN: { rtdbPath: string; collection: FirestoreCollectionName; map: Mapper }[] = [
  { rtdbPath: 'customers', collection: 'customers', map: (r) => mapCustomerToFirestoreDoc(r) },
  { rtdbPath: 'products', collection: 'products', map: (r) => mapProductToFirestoreDoc(r) },
  { rtdbPath: 'salesOrders', collection: 'salesOrders', map: (r) => mapSalesOrderToFirestoreDoc(r) },
  { rtdbPath: 'dispatch', collection: 'dispatches', map: (r) => mapDispatchToFirestoreDoc(r) },
  { rtdbPath: 'inventory/rawMaterials', collection: 'rawMaterials', map: (r) => mapRawMaterialToFirestoreDoc(r) },
  {
    rtdbPath: 'inventory/stockMovements',
    collection: 'stockMovements',
    map: (r) => mapStockMovementToFirestoreDoc(r, r.materialId),
  },
  { rtdbPath: 'quality/inspections', collection: 'qualityInspections', map: (r) => mapQualityInspectionToFirestoreDoc(r) },
  { rtdbPath: 'outstandingPayments', collection: 'outstandingPayments', map: (r) => mapOutstandingToFirestoreDoc(r) },
  { rtdbPath: 'alerts/actionQueue', collection: 'actionQueue', map: (r) => mapActionQueueToFirestoreDoc(r) },
  { rtdbPath: 'users', collection: 'users', map: (r) => mapUserProfileToFirestoreDoc(toUserProfile(r)) },
];

const REPORT_ONLY = ['dashboardKpis', 'production', 'alerts/thresholds', 'auditLogs'];

/** RTDB stored group names in `role` and the granular role in `legacyRole`. */
function toUserProfile(raw: Record<string, any>): UserProfile {
  const resolved = resolveUserRoleMapping(raw);
  const uid = String(raw.uid || raw.id || '');
  const status = KEEP_USER_STATUS ? raw.accountStatus || 'pending_approval' : 'pending_approval';
  return {
    ...raw,
    id: uid,
    uid,
    name: raw.displayName || raw.name || String(raw.email || '').split('@')[0] || 'Employee',
    displayName: raw.displayName || raw.name || String(raw.email || '').split('@')[0] || 'Employee',
    email: String(raw.email || '').trim().toLowerCase(),
    role: resolved.granularRole,
    requestedRole: resolved.granularRole,
    rbacGroup: resolved.rbacGroup,
    department: raw.department || raw.requestedDepartment || 'Operations',
    accountStatus: status,
    permissions: status === 'active' ? resolved.permissions : [],
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as UserProfile;
}

function toArray(value: unknown): any[] {
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).filter((v) => v && typeof v === 'object');
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error(
      'Firebase Admin credentials are not set. Set GOOGLE_APPLICATION_CREDENTIALS (path to the ' +
        'service-account key file) or FIREBASE_SERVICE_ACCOUNT_JSON, then run this again.'
    );
    process.exit(1);
  }
  console.log(`Montex MIS — RTDB → Firestore migration (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log(`  RTDB:      ${SERVER_RTDB_URL}`);
  console.log(`  Firestore: ${SERVER_FIRESTORE_DATABASE_ID}\n`);

  const rtdb = getAdminRtdbInstance();
  const fs = getAdminFirestoreInstance();
  let totalCreated = 0;
  let totalInvalid = 0;

  for (const { rtdbPath, collection, map } of PLAN) {
    const records = toArray((await rtdb.ref(rtdbPath).get()).val());
    const keyField = COLLECTION_PRIMARY_KEY_FIELD[collection];
    let toCreate = 0;
    let existing = 0;
    const invalid: string[] = [];

    for (const record of records) {
      let doc: Record<string, any>;
      try {
        doc = map(record);
      } catch (err: any) {
        invalid.push(`${record.id ?? '?'}: ${err?.message || err}`);
        continue;
      }
      const docId = String(doc[keyField] ?? '');
      if (!docId) {
        invalid.push(`${record.id ?? '?'}: no ${keyField}`);
        continue;
      }
      const ref = fs.collection(collection).doc(docId);
      if ((await ref.get()).exists) {
        existing++;
        continue;
      }
      toCreate++;
      if (APPLY) await ref.create(doc);
    }

    totalCreated += toCreate;
    totalInvalid += invalid.length;
    console.log(
      `${rtdbPath.padEnd(26)} → ${collection.padEnd(20)} RTDB ${String(records.length).padStart(4)} | ` +
        `${APPLY ? 'created' : 'would create'} ${toCreate} | already in Firestore ${existing} | invalid ${invalid.length}`
    );
    invalid.slice(0, 5).forEach((line) => console.log(`    ! ${line}`));
  }

  console.log('\nNot copied (review by hand):');
  for (const path of REPORT_ONLY) {
    const value = (await rtdb.ref(path).get()).val();
    const size = value && typeof value === 'object' ? Object.keys(value).length : value == null ? 0 : 1;
    console.log(`  ${path.padEnd(20)} ${size} entr${size === 1 ? 'y' : 'ies'}`);
  }

  console.log(
    `\n${APPLY ? 'Created' : 'Would create'} ${totalCreated} documents; ${totalInvalid} invalid records skipped.` +
      (APPLY ? '' : '\nRun again with --apply to write.')
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err?.message || err);
  process.exit(1);
});
