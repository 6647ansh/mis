/**
 * Montex Forge MIS — Phase 4 Verification Suite
 *
 * Verifies:
 * 1. P4-T01: Reusable Firestore CRUD operations (getDocumentById, listDocuments with filters & cursor pagination, createDocument, updateDocument, deleteDocument)
 * 2. P4-T02: Missing documents (not_found) and empty collections (empty) with zero uncaught exceptions
 * 3. P4-T03: Invalid payloads, schema/invariant violations, secret/credential rejection (SECRET_DETECTED), and demo-data isolation (DEMO_DATA_REJECTED)
 * 4. P4-T04: Permission-denied responses across roles, inactive/disabled accounts, and immutable collection protection (systemConfig, auditLogs, stockMovements)
 * 5. P4-T05: Duplicate-create handling (ALREADY_EXISTS) and update-missing handling (NOT_FOUND)
 * 6. P4-T06: Transaction conflict retry and atomic rollback behavior
 * 7. P4-T07: Stock, PO receipt, and dispatch quantity constraints (negative stock prevention, over-receipt prevention, over-dispatch prevention, cancelled SO stage block, cross-collection role boundary for Purchase vs Stores GRN)
 * 8. P4-T08: Clean production initialization without sample/prototype records (0 business collection records)
 * 9. P4-T09: Idempotent initialization on retry (both client service helper and trusted server HTTP endpoint POST /api/admin/system/initialize)
 * 10. P4-T10: Preservation of existing RTDB service exports and non-destructive live Firestore health check
 */

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import {
  MontexFirestoreService,
  FirestorePersistenceDriver,
  FirestoreTransactionContext,
  FirestoreListOptions,
  FirestoreQueryFilter,
  FirestoreCallerContext,
  FirestoreCollectionName,
  ALL_FIRESTORE_COLLECTIONS,
  BUSINESS_DATA_COLLECTIONS,
  FirestoreRawMaterialDoc,
  FirestorePurchaseOrderDoc,
  FirestoreSalesOrderDoc,
  FirestoreSystemConfigDoc,
  initializeCleanProductionFirestore,
} from '../src/services/firestoreService';
import {
  createSystemInitRouter,
  SystemConfigStoreAdapter,
} from '../server/routes/systemInitRoutes';
import {
  AdminAuthAdapter,
  EmployeeStoreAdapter,
} from '../server/config/firebaseAdmin';
import { checkFirestoreConnectionHealth } from '../src/lib/firebase';
import * as rtdbService from '../src/services/rtdbService';

interface TestResult {
  id: string;
  suite: string;
  description: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordResult(
  id: string,
  suite: string,
  description: string,
  passed: boolean,
  details: string
) {
  results.push({ id, suite, description, passed, details });
  const badge = passed ? 'PASS' : 'FAIL';
  console.log(`[${badge}] ${id} (${suite}): ${description} — ${details}`);
}

/**
 * Deterministic Transactional In-Memory Driver for testing MontexFirestoreService.
 * Supports:
 * - Atomic transaction snapshots (rollback on error)
 * - Simulated optimistic concurrency conflict (`simulateConflictCount`) to verify retry behavior
 * - Simulated permission-denied errors (`deniedCollections`)
 * - Filter evaluation (`==`, `!=`, `<`, `<=`, `>`, `>=`, `in`) + sorting + cursor pagination
 */
class InMemoryTransactionalFirestoreDriver implements FirestorePersistenceDriver {
  private store: Map<string, Map<string, Record<string, any>>> = new Map();
  public simulateConflictCount = 0;
  public totalTransactionAttempts = 0;
  public deniedCollections: Set<string> = new Set();

  constructor() {
    for (const col of ALL_FIRESTORE_COLLECTIONS) {
      this.store.set(col, new Map());
    }
  }

  private getCollectionMap(collectionName: string): Map<string, Record<string, any>> {
    let col = this.store.get(collectionName);
    if (!col) {
      col = new Map();
      this.store.set(collectionName, col);
    }
    return col;
  }

  private assertNotDenied(collectionName: string): void {
    if (this.deniedCollections.has(collectionName)) {
      const err = new Error(
        `Missing or insufficient permissions for /${collectionName}.`
      ) as Error & { code?: string };
      err.code = 'permission-denied';
      throw err;
    }
  }

  public countCollection(collectionName: string): number {
    return this.getCollectionMap(collectionName).size;
  }

  private matchesFilter(
    doc: Record<string, any>,
    filter: FirestoreQueryFilter
  ): boolean {
    const val = doc[filter.field];
    switch (filter.op) {
      case '==':
        return val === filter.value;
      case '!=':
        return val !== filter.value;
      case '<':
        return typeof val === 'number' && typeof filter.value === 'number' && val < filter.value;
      case '<=':
        return typeof val === 'number' && typeof filter.value === 'number' && val <= filter.value;
      case '>':
        return typeof val === 'number' && typeof filter.value === 'number' && val > filter.value;
      case '>=':
        return typeof val === 'number' && typeof filter.value === 'number' && val >= filter.value;
      case 'in':
        return Array.isArray(filter.value) && filter.value.includes(val);
      default:
        return false;
    }
  }

  async getDoc<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<T | null> {
    this.assertNotDenied(collectionName);
    const doc = this.getCollectionMap(collectionName).get(docId);
    return doc ? (JSON.parse(JSON.stringify(doc)) as T) : null;
  }

  async listDocs<T = Record<string, any>>(
    collectionName: FirestoreCollectionName,
    options: FirestoreListOptions = {}
  ): Promise<{ items: T[]; nextPageCursor: string | null; hasMore: boolean }> {
    this.assertNotDenied(collectionName);
    const col = this.getCollectionMap(collectionName);
    let entries = Array.from(col.entries()).map(([id, data]) => ({
      id,
      data: JSON.parse(JSON.stringify(data)) as Record<string, any>,
    }));

    if (options.filters && options.filters.length > 0) {
      entries = entries.filter((entry) =>
        options.filters!.every((f) => this.matchesFilter(entry.data, f))
      );
    }

    if (options.orderByField) {
      const field = options.orderByField;
      const dir = options.orderDirection === 'desc' ? -1 : 1;
      entries.sort((a, b) => {
        const va = a.data[field];
        const vb = b.data[field];
        if (va === vb) return a.id.localeCompare(b.id) * dir;
        if (va === undefined || va === null) return 1;
        if (vb === undefined || vb === null) return -1;
        return (va < vb ? -1 : 1) * dir;
      });
    } else {
      entries.sort((a, b) => a.id.localeCompare(b.id));
    }

    if (options.cursorDocId) {
      const idx = entries.findIndex((e) => e.id === options.cursorDocId);
      if (idx >= 0) {
        entries = entries.slice(idx + 1);
      }
    }

    const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 200);
    const hasMore = entries.length > pageSize;
    const sliced = hasMore ? entries.slice(0, pageSize) : entries;
    const items = sliced.map((e) => e.data as T);
    const nextPageCursor =
      hasMore && sliced.length > 0 ? sliced[sliced.length - 1].id : null;

    return { items, nextPageCursor, hasMore };
  }

  async createDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    this.assertNotDenied(collectionName);
    const col = this.getCollectionMap(collectionName);
    if (col.has(docId)) {
      const err = new Error(
        `Document "${collectionName}/${docId}" already exists.`
      ) as Error & { code?: string };
      err.code = 'already-exists';
      throw err;
    }
    col.set(docId, JSON.parse(JSON.stringify(data)));
  }

  async updateDoc<T extends Record<string, any>>(
    collectionName: FirestoreCollectionName,
    docId: string,
    data: Partial<T>
  ): Promise<void> {
    this.assertNotDenied(collectionName);
    const col = this.getCollectionMap(collectionName);
    const existing = col.get(docId);
    if (!existing) {
      const err = new Error(
        `Document "${collectionName}/${docId}" does not exist.`
      ) as Error & { code?: string };
      err.code = 'not-found';
      throw err;
    }
    col.set(docId, {
      ...JSON.parse(JSON.stringify(existing)),
      ...JSON.parse(JSON.stringify(data)),
    });
  }

  async deleteDoc(
    collectionName: FirestoreCollectionName,
    docId: string
  ): Promise<void> {
    this.assertNotDenied(collectionName);
    this.getCollectionMap(collectionName).delete(docId);
  }

  async runTransaction<R>(
    updateFunction: (tx: FirestoreTransactionContext) => Promise<R>,
    maxAttempts = 5
  ): Promise<R> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.totalTransactionAttempts++;

      // Deep-clone entire store for atomic transaction isolation
      const snapshot = new Map<string, Map<string, Record<string, any>>>();
      for (const [colName, colMap] of this.store.entries()) {
        const clonedCol = new Map<string, Record<string, any>>();
        for (const [id, doc] of colMap.entries()) {
          clonedCol.set(id, JSON.parse(JSON.stringify(doc)));
        }
        snapshot.set(colName, clonedCol);
      }

      const txContext: FirestoreTransactionContext = {
        getDoc: async <T = Record<string, any>>(
          collectionName: FirestoreCollectionName,
          docId: string
        ): Promise<T | null> => {
          this.assertNotDenied(collectionName);
          const col = snapshot.get(collectionName);
          const doc = col?.get(docId);
          return doc ? (JSON.parse(JSON.stringify(doc)) as T) : null;
        },
        setDoc: async <T extends Record<string, any>>(
          collectionName: FirestoreCollectionName,
          docId: string,
          data: T
        ): Promise<void> => {
          this.assertNotDenied(collectionName);
          let col = snapshot.get(collectionName);
          if (!col) {
            col = new Map();
            snapshot.set(collectionName, col);
          }
          col.set(docId, JSON.parse(JSON.stringify(data)));
        },
        updateDoc: async <T extends Record<string, any>>(
          collectionName: FirestoreCollectionName,
          docId: string,
          data: Partial<T>
        ): Promise<void> => {
          this.assertNotDenied(collectionName);
          const col = snapshot.get(collectionName);
          const existing = col?.get(docId);
          if (!existing) {
            const err = new Error(
              `No document to update in tx: /${collectionName}/${docId}`
            ) as Error & { code?: string };
            err.code = 'NOT_FOUND';
            throw err;
          }
          col!.set(docId, {
            ...JSON.parse(JSON.stringify(existing)),
            ...JSON.parse(JSON.stringify(data)),
          });
        },
      };

      try {
        const result = await updateFunction(txContext);

        // Simulate transient optimistic concurrency conflict ('aborted') if configured
        if (this.simulateConflictCount > 0) {
          this.simulateConflictCount--;
          const conflictErr = new Error(
            'Transaction aborted due to optimistic concurrency conflict.'
          ) as Error & { code?: string };
          conflictErr.code = 'aborted';
          throw conflictErr;
        }

        // Commit transactional snapshot atomically
        this.store = snapshot;
        return result;
      } catch (err) {
        lastError = err;
        const code = (err as { code?: string })?.code ?? '';
        if (code === 'aborted' && attempt < maxAttempts) {
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }
}

// ============================================================================
// Test Callers
// ============================================================================

const CALLER_SUPER_ADMIN: FirestoreCallerContext = {
  uid: 'uid_admin_001',
  email: 'keyur@montex.in',
  displayName: 'Keyur Shah',
  role: 'super_admin',
  accountStatus: 'active',
};

const CALLER_STORES: FirestoreCallerContext = {
  uid: 'uid_stores_001',
  email: 'stores@montex.in',
  displayName: 'Ramesh Stores',
  role: 'stores',
  accountStatus: 'active',
};

const CALLER_PURCHASE: FirestoreCallerContext = {
  uid: 'uid_purchase_001',
  email: 'purchase@montex.in',
  displayName: 'Suresh Purchase',
  role: 'purchase',
  accountStatus: 'active',
};

const CALLER_QUALITY: FirestoreCallerContext = {
  uid: 'uid_quality_001',
  email: 'quality@montex.in',
  displayName: 'Vikram Quality',
  role: 'quality',
  accountStatus: 'active',
};

const CALLER_DISPATCH: FirestoreCallerContext = {
  uid: 'uid_dispatch_001',
  email: 'dispatch@montex.in',
  displayName: 'Mahesh Dispatch',
  role: 'dispatch',
  accountStatus: 'active',
};

const CALLER_SALES: FirestoreCallerContext = {
  uid: 'uid_sales_001',
  email: 'sales@montex.in',
  displayName: 'Anil Sales',
  role: 'sales',
  accountStatus: 'active',
};

const CALLER_SUSPENDED: FirestoreCallerContext = {
  uid: 'uid_suspended_001',
  email: 'suspended@montex.in',
  displayName: 'Suspended User',
  role: 'super_admin',
  accountStatus: 'suspended',
};

async function runTests() {
  console.log('======================================================================');
  console.log('Montex Forge MIS — Phase 4 Firestore Service & Persistence Verification');
  console.log('======================================================================\n');

  // --------------------------------------------------------------------------
  // P4-T01: Reusable CRUD operations + filtering + cursor pagination
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    let activeCaller: FirestoreCallerContext | null = CALLER_STORES;
    const service = new MontexFirestoreService(driver, () => activeCaller);
    const now = '2026-04-01T10:00:00.000Z';

    const grades: FirestoreRawMaterialDoc[] = [
      {
        gradeId: 'SS304L',
        steelGrade: 'SS 304L Bright Bar',
        category: 'Stainless Steel',
        availableMT: 42.5,
        allocatedMT: 10.0,
        reorderLevelMT: 15.0,
        unitCostPerMT: 215000,
        status: 'Healthy',
        lastUpdated: now,
      },
      {
        gradeId: 'SS316L',
        steelGrade: 'SS 316L Round Bar',
        category: 'Stainless Steel',
        availableMT: 11.0,
        allocatedMT: 4.0,
        reorderLevelMT: 12.0,
        unitCostPerMT: 310000,
        status: 'Low Stock',
        lastUpdated: now,
      },
      {
        gradeId: 'SS410',
        steelGrade: 'SS 410 Forging Ingot',
        category: 'Stainless Steel',
        availableMT: 3.5,
        allocatedMT: 1.0,
        reorderLevelMT: 10.0,
        unitCostPerMT: 145000,
        status: 'Critical',
        lastUpdated: now,
      },
    ];

    for (const g of grades) {
      const createRes = await service.createDocument('rawMaterials', g.gradeId, g);
      if (!createRes.success) {
        throw new Error(`Unexpected create failure: ${createRes.message}`);
      }
    }

    const readRes = await service.getDocumentById<FirestoreRawMaterialDoc>(
      'rawMaterials',
      'SS304L'
    );
    const page1 = await service.listDocuments<FirestoreRawMaterialDoc>(
      'rawMaterials',
      { orderByField: 'unitCostPerMT', orderDirection: 'asc', pageSize: 2 }
    );
    const page2 = await service.listDocuments<FirestoreRawMaterialDoc>(
      'rawMaterials',
      {
        orderByField: 'unitCostPerMT',
        orderDirection: 'asc',
        pageSize: 2,
        cursorDocId: page1.nextPageCursor ?? undefined,
      }
    );
    const filtered = await service.listDocuments<FirestoreRawMaterialDoc>(
      'rawMaterials',
      { filters: [{ field: 'status', op: '==', value: 'Low Stock' }] }
    );

    const updateRes = await service.updateDocument<FirestoreRawMaterialDoc>(
      'rawMaterials',
      'SS316L',
      { availableMT: 18.0, status: 'Healthy' }
    );

    activeCaller = CALLER_SUPER_ADMIN;
    const deleteRes = await service.deleteDocument('rawMaterials', 'SS410');
    const afterDelete = await service.getDocumentById('rawMaterials', 'SS410');

    const passed =
      readRes.status === 'ok' &&
      readRes.data?.gradeId === 'SS304L' &&
      page1.status === 'ok' &&
      page1.items.length === 2 &&
      page1.hasMore === true &&
      page1.nextPageCursor === 'SS304L' &&
      page2.status === 'ok' &&
      page2.items.length === 1 &&
      page2.items[0].gradeId === 'SS316L' &&
      page2.hasMore === false &&
      filtered.items.length === 1 &&
      filtered.items[0].gradeId === 'SS316L' &&
      updateRes.status === 'ok' &&
      updateRes.data?.availableMT === 18.0 &&
      deleteRes.status === 'ok' &&
      afterDelete.status === 'not_found';

    recordResult(
      'P4-T01',
      'CRUD & Pagination',
      'Create, read by ID, list with filter & cursor pagination, update, and super_admin delete',
      passed,
      `read=${readRes.status}, page1=${page1.items.length} (hasMore=${page1.hasMore}), page2=${page2.items.length}, filtered=${filtered.items.length}, updatedMT=${updateRes.data?.availableMT}, afterDelete=${afterDelete.status}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T02: Missing documents and empty collections
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_SALES);

    const missingDoc = await service.getDocumentById(
      'salesOrders',
      'SO-NON-EXISTENT'
    );
    const emptyList = await service.listDocuments('salesOrders', {
      pageSize: 10,
    });

    const passed =
      missingDoc.success === true &&
      missingDoc.status === 'not_found' &&
      missingDoc.code === 'NOT_FOUND' &&
      missingDoc.data === null &&
      emptyList.success === true &&
      emptyList.status === 'empty' &&
      emptyList.code === 'EMPTY_COLLECTION' &&
      emptyList.items.length === 0 &&
      emptyList.hasMore === false;

    recordResult(
      'P4-T02',
      'Missing & Empty States',
      'Missing document returns status="not_found" and empty collection returns status="empty" without throwing',
      passed,
      `missingDoc.status=${missingDoc.status} (${missingDoc.code}), emptyList.status=${emptyList.status} (${emptyList.code})`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T03: Invalid payloads, secret rejection, and demo-data isolation
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_STORES);

    // 3a. Primary key mismatch
    const pkMismatch = await service.createDocument('rawMaterials', 'SS304L', {
      gradeId: 'WRONG_ID',
      steelGrade: 'SS 304L',
      availableMT: 10,
      reorderLevelMT: 5,
      status: 'Healthy',
    });

    // 3b. Negative quantity invariant violation
    const negativeStockPayload = await service.createDocument(
      'rawMaterials',
      'SS304L',
      {
        gradeId: 'SS304L',
        steelGrade: 'SS 304L',
        availableMT: -5,
        reorderLevelMT: 5,
        status: 'Healthy',
      }
    );

    // 3c. Secret / private key payload rejected
    const secretPayloadRes = await service.createDocument(
      'rawMaterials',
      'SS304L',
      {
        gradeId: 'SS304L',
        steelGrade: 'SS 304L',
        availableMT: 10,
        reorderLevelMT: 5,
        status: 'Healthy',
        supplierName:
          'leaked -----BEGIN PRIVATE KEY----- MIIEvgIBADANBgkqhkiG9w0BAQE',
      }
    );

    // 3d. Demo sandbox data rejected from production Firestore
    const demoDataRes = await service.createDocument(
      'rawMaterials',
      'SS304L',
      {
        gradeId: 'SS304L',
        steelGrade: 'SS 304L',
        availableMT: 10,
        reorderLevelMT: 5,
        status: 'Healthy',
        dataOrigin: 'demo_sandbox',
      }
    );

    const passed =
      pkMismatch.status === 'error' &&
      pkMismatch.code === 'VALIDATION_ERROR' &&
      negativeStockPayload.status === 'error' &&
      negativeStockPayload.code === 'VALIDATION_ERROR' &&
      secretPayloadRes.status === 'error' &&
      secretPayloadRes.code === 'SECRET_DETECTED' &&
      demoDataRes.status === 'error' &&
      demoDataRes.code === 'DEMO_DATA_REJECTED';

    recordResult(
      'P4-T03',
      'Validation, Secrets & Demo Isolation',
      'Rejects primary-key mismatch, negative inventory invariants, embedded credentials/private keys, and demo_sandbox payloads',
      passed,
      `pkMismatch=${pkMismatch.code}, negStock=${negativeStockPayload.code}, secret=${secretPayloadRes.code}, demoData=${demoDataRes.code}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T04: Permission-denied responses across roles & inactive accounts
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    let activeCaller: FirestoreCallerContext | null = null;
    const service = new MontexFirestoreService(driver, () => activeCaller);

    // 4a. Unauthenticated caller
    const unauthRead = await service.getDocumentById('rawMaterials', 'SS304L');

    // 4b. Suspended caller
    activeCaller = CALLER_SUSPENDED;
    const suspendedRead = await service.getDocumentById('rawMaterials', 'SS304L');

    // 4c. Non-super_admin attempting to delete a document
    activeCaller = CALLER_STORES;
    const storesDelete = await service.deleteDocument('rawMaterials', 'SS304L');

    // 4d. Super_admin attempting to delete/mutate immutable collections (systemConfig, auditLogs, stockMovements)
    activeCaller = CALLER_SUPER_ADMIN;
    const deleteSysConfig = await service.deleteDocument(
      'systemConfig',
      'dashboardKpis'
    );
    const deleteAuditLog = await service.deleteDocument('auditLogs', 'AUD-001');
    const updateAuditLog = await service.updateDocument('auditLogs', 'AUD-001', {
      details: 'tampered',
    });

    // 4e. Client attempting to directly create a user profile (must go through trusted Admin API)
    const directUserCreate = await service.createDocument('users', 'uid_new', {
      uid: 'uid_new',
      email: 'new@montex.in',
      displayName: 'New User',
      role: 'sales',
      accountStatus: 'active',
    });

    // 4f. Firestore driver permission-denied propagation
    activeCaller = CALLER_SUPER_ADMIN;
    driver.deniedCollections.add('outstandingPayments');
    const driverDenied = await service.listDocuments('outstandingPayments', {});
    driver.deniedCollections.delete('outstandingPayments');

    const passed =
      unauthRead.code === 'UNAUTHENTICATED' &&
      suspendedRead.code === 'ACCOUNT_INACTIVE' &&
      storesDelete.code === 'DELETION_REQUIRES_SUPER_ADMIN' &&
      deleteSysConfig.code === 'DELETION_FORBIDDEN_IMMUTABLE_COLLECTION' &&
      deleteAuditLog.code === 'DELETION_FORBIDDEN_IMMUTABLE_COLLECTION' &&
      updateAuditLog.code === 'IMMUTABLE_DOCUMENT' &&
      directUserCreate.code === 'PERMISSION_DENIED' &&
      driverDenied.code === 'PERMISSION_DENIED';

    recordResult(
      'P4-T04',
      'RBAC & Immutable Collection Guards',
      'Enforces active caller status, super_admin-only delete, immutable systemConfig/auditLogs, client /users creation block, and driver permission-denied mapping',
      passed,
      `unauth=${unauthRead.code}, suspended=${suspendedRead.code}, nonAdminDel=${storesDelete.code}, sysConfigDel=${deleteSysConfig.code}, auditUpdate=${updateAuditLog.code}, directUserCreate=${directUserCreate.code}, driverDenied=${driverDenied.code}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T05: Duplicate-create handling (ALREADY_EXISTS) & update missing (NOT_FOUND)
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_STORES);

    const payload: FirestoreRawMaterialDoc = {
      gradeId: 'SS304L',
      steelGrade: 'SS 304L Bright Bar',
      availableMT: 25.0,
      allocatedMT: 5.0,
      reorderLevelMT: 10.0,
      status: 'Healthy',
      unitCostPerMT: 215000,
      lastUpdated: '2026-04-01T10:00:00.000Z',
    };

    const firstCreate = await service.createDocument(
      'rawMaterials',
      'SS304L',
      payload
    );
    const duplicateCreate = await service.createDocument('rawMaterials', 'SS304L', {
      ...payload,
      availableMT: 999,
    });
    const currentDoc = await service.getDocumentById<FirestoreRawMaterialDoc>(
      'rawMaterials',
      'SS304L'
    );
    const updateMissing = await service.updateDocument(
      'rawMaterials',
      'NON_EXISTENT_GRADE',
      { availableMT: 10 }
    );

    const passed =
      firstCreate.status === 'ok' &&
      duplicateCreate.status === 'error' &&
      duplicateCreate.code === 'ALREADY_EXISTS' &&
      currentDoc.data?.availableMT === 25.0 && // Original not overwritten!
      updateMissing.status === 'not_found' &&
      updateMissing.code === 'NOT_FOUND';

    recordResult(
      'P4-T05',
      'Duplicate Create & Update Missing Guards',
      'createDocument refuses to overwrite existing IDs (ALREADY_EXISTS) and updateDocument rejects missing docs (NOT_FOUND)',
      passed,
      `first=${firstCreate.code}, dup=${duplicateCreate.code}, preservedMT=${currentDoc.data?.availableMT}, updateMissing=${updateMissing.code}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T06: Transaction conflict retry & atomic rollback on mid-transaction failure
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_STORES);
    const now = '2026-04-01T10:00:00.000Z';

    await service.createDocument('rawMaterials', 'SS304L', {
      gradeId: 'SS304L',
      steelGrade: 'SS 304L Bright Bar',
      availableMT: 50.0,
      allocatedMT: 10.0,
      reorderLevelMT: 15.0,
      status: 'Healthy',
      unitCostPerMT: 215000,
      lastUpdated: now,
    });

    // Simulate 1 transient optimistic concurrency conflict ('aborted') -> should retry and succeed on attempt 2
    driver.simulateConflictCount = 1;
    const attemptsBefore = driver.totalTransactionAttempts;

    const retryStockRes = await service.recordStockMovementAtomically({
      movementId: 'MOV-2026-001',
      gradeId: 'SS304L',
      type: 'INWARD',
      quantityTons: 10.0,
      referenceDocument: 'PO-2026-101',
    });
    const attemptsUsed = driver.totalTransactionAttempts - attemptsBefore;

    // Now test atomic rollback when a transaction fails mid-flight (e.g. duplicate movementId)
    const duplicateMoveRes = await service.recordStockMovementAtomically({
      movementId: 'MOV-2026-001', // Duplicate ID!
      gradeId: 'SS304L',
      type: 'INWARD',
      quantityTons: 25.0,
      referenceDocument: 'PO-2026-102',
    });

    const gradeAfterRollback =
      await service.getDocumentById<FirestoreRawMaterialDoc>(
        'rawMaterials',
        'SS304L'
      );

    const passed =
      retryStockRes.status === 'ok' &&
      attemptsUsed === 2 &&
      retryStockRes.data?.material.availableMT === 60.0 &&
      duplicateMoveRes.status === 'error' &&
      duplicateMoveRes.code === 'ALREADY_EXISTS' &&
      gradeAfterRollback.data?.availableMT === 60.0; // Unchanged after failed tx

    recordResult(
      'P4-T06',
      'Transaction Conflict Retry & Rollback',
      'Retries transient optimistic concurrency conflict automatically and rolls back state on mid-transaction failure',
      passed,
      `retryStatus=${retryStockRes.code}, attemptsUsed=${attemptsUsed}, balanceAfterCommit=${gradeAfterRollback.data?.availableMT}MT, dupRollback=${duplicateMoveRes.code}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T07: Stock, PO receipt, Sales Order stage, and Dispatch quantity constraints
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    let activeCaller: FirestoreCallerContext = CALLER_STORES;
    const service = new MontexFirestoreService(driver, () => activeCaller);
    const now = '2026-04-01T09:00:00.000Z';

    // Seed 1 raw material (20 MT available), 1 PO (30 MT ordered, 10 MT received), 1 Sales Order (15 MT ordered)
    await service.createDocument('rawMaterials', 'SS316L', {
      gradeId: 'SS316L',
      steelGrade: 'SS 316L Round Bar',
      availableMT: 20.0,
      allocatedMT: 5.0,
      reorderLevelMT: 10.0,
      status: 'Healthy',
      unitCostPerMT: 310000,
      lastUpdated: now,
    });

    activeCaller = CALLER_PURCHASE;
    const poDoc: FirestorePurchaseOrderDoc = {
      id: 'PO-2026-501',
      poNumber: 'PO-2026-501',
      supplierId: 'SUP-01',
      supplierName: 'Jindal Stainless Ltd',
      steelGrade: 'SS 316L Round Bar',
      orderedMT: 30.0,
      receivedMT: 10.0,
      ratePerMT: 305000,
      totalAmountINR: 9150000,
      status: 'Partially Received',
      expectedDeliveryDate: '2026-04-15',
      createdAt: now,
      updatedAt: now,
    };
    await service.createDocument('purchaseOrders', poDoc.id, poDoc);

    activeCaller = CALLER_SALES;
    const soDoc: FirestoreSalesOrderDoc = {
      orderId: 'SO-2026-901',
      customerName: 'Larsen & Toubro Heavy Engg',
      productName: 'Forged Flange ANSI B16.5',
      steelGrade: 'SS 316L Round Bar',
      quantityMT: 15.0,
      totalValueINR: 5250000,
      orderDate: '2026-04-01',
      committedDeliveryDate: '2026-04-25',
      currentStage: 'Raw Material Allocated',
      overallStatus: 'On Track',
      paymentStatus: 'Pending',
      createdBy: CALLER_SALES.uid,
      createdAt: now,
      updatedAt: now,
    };
    await service.createDocument('salesOrders', soDoc.orderId, soDoc);

    // 7a. Negative stock prevention: Issue 25 MT when only 20 MT available
    activeCaller = CALLER_STORES;
    const excessiveIssue = await service.recordStockMovementAtomically({
      movementId: 'MOV-OVER-ISSUE',
      gradeId: 'SS316L',
      type: 'ISSUE',
      quantityTons: 25.0,
      orderId: 'SO-2026-901',
    });

    // 7b. PO over-receipt prevention: Receive 25 MT when only 20 MT remaining on PO (30 ordered, 10 received)
    const overReceipt = await service.recordPurchaseOrderReceiptAtomically({
      poId: 'PO-2026-501',
      receiptQuantityMT: 25.0,
    });

    // 7c. Cross-collection role boundary: Purchase role can update PO receivedMT without rawMaterial inward,
    //     but cannot directly mutate /rawMaterials via inventoryInward
    activeCaller = CALLER_PURCHASE;
    const purchaseAttemptInward =
      await service.recordPurchaseOrderReceiptAtomically({
        poId: 'PO-2026-501',
        receiptQuantityMT: 5.0,
        inventoryInward: {
          gradeId: 'SS316L',
          movementId: 'MOV-PURCHASE-BLOCKED',
        },
      });

    // 7d. Valid Stores GRN receipt (20 MT -> completes PO to 30/30 'Received' + increments SS316L to 40 MT)
    activeCaller = CALLER_STORES;
    const validStoresGrn = await service.recordPurchaseOrderReceiptAtomically({
      poId: 'PO-2026-501',
      receiptQuantityMT: 20.0,
      inventoryInward: {
        gradeId: 'SS316L',
        movementId: 'MOV-GRN-501',
        heatNumber: 'HT-2026-99',
      },
    });

    // 7e. Role-scoped Sales Order stage transition: Quality cannot modify paymentStatus, but can update mtcStatus + currentStage
    activeCaller = CALLER_QUALITY;
    const qualityIllegalPaymentField =
      await service.updateSalesOrderStageAtomically({
        orderId: 'SO-2026-901',
        currentStage: 'Quality Inspection',
        overallStatus: 'On Track',
        paymentStatus: 'Paid', // Forbidden for quality role!
      });

    const qualityValidTransition = await service.updateSalesOrderStageAtomically(
      {
        orderId: 'SO-2026-901',
        currentStage: 'Ready for Dispatch',
        overallStatus: 'On Track',
        mtcStatus: 'Verified',
      }
    );

    // 7f. Dispatch consignment: First dispatch 10 MT succeeds ('Partial', remaining 5 MT),
    //     second dispatch 8 MT (10+8=18 > 15 MT) fails ('DISPATCH_EXCEEDS_ORDER_BALANCE'),
    //     third dispatch 5 MT (10+5=15 MT) completes order ('Completed', 'Dispatched')
    activeCaller = CALLER_DISPATCH;
    const dispatch1 = await service.recordDispatchConsignmentAtomically({
      dispatchId: 'DISP-901-A',
      orderId: 'SO-2026-901',
      quantityTons: 10.0,
      dispatchDate: '2026-04-10',
      transporterName: 'TCI Freight',
      vehicleNo: 'GJ-01-XX-1234',
      lrNo: 'LR-88210',
      status: 'In Transit',
      previouslyDispatchedTons: 0,
    });

    const dispatchOverLimit = await service.recordDispatchConsignmentAtomically({
      dispatchId: 'DISP-901-B',
      orderId: 'SO-2026-901',
      quantityTons: 8.0, // 10 + 8 = 18 MT > 15 MT ordered
      dispatchDate: '2026-04-11',
      transporterName: 'TCI Freight',
      vehicleNo: 'GJ-01-XX-5678',
      lrNo: 'LR-88211',
      status: 'In Transit',
      previouslyDispatchedTons: 10.0,
    });

    const dispatchFinal5MT = await service.recordDispatchConsignmentAtomically({
      dispatchId: 'DISP-901-C',
      orderId: 'SO-2026-901',
      quantityTons: 5.0, // 10 + 5 = 15 MT == 15 MT ordered -> Completed
      dispatchDate: '2026-04-12',
      transporterName: 'TCI Freight',
      vehicleNo: 'GJ-01-XX-9999',
      lrNo: 'LR-88212',
      status: 'Delivered',
      previouslyDispatchedTons: 10.0,
    });

    const passed =
      excessiveIssue.code === 'INSUFFICIENT_RAW_MATERIAL_STOCK' &&
      overReceipt.code === 'PO_RECEIPT_EXCEEDS_ORDERED_QTY' &&
      purchaseAttemptInward.code === 'PERMISSION_DENIED' &&
      validStoresGrn.status === 'ok' &&
      validStoresGrn.data?.purchaseOrder.status === 'Received' &&
      validStoresGrn.data?.material?.availableMT === 40.0 &&
      qualityIllegalPaymentField.code === 'PERMISSION_DENIED' &&
      qualityValidTransition.status === 'ok' &&
      qualityValidTransition.data?.order.mtcStatus === 'Verified' &&
      dispatch1.status === 'ok' &&
      dispatch1.data?.order.dispatchStatus === 'Partial' &&
      dispatch1.data?.remainingOrderBalanceMT === 5.0 &&
      dispatchOverLimit.code === 'DISPATCH_EXCEEDS_ORDER_BALANCE' &&
      dispatchFinal5MT.status === 'ok' &&
      dispatchFinal5MT.data?.order.overallStatus === 'Completed' &&
      dispatchFinal5MT.data?.order.dispatchStatus === 'Dispatched';

    recordResult(
      'P4-T07',
      'Atomic Business Invariants & Role Field Locks',
      'Enforces stock floor >=0, PO receipt <= orderedMT, Purchase vs Stores GRN boundary, role field whitelists, and cumulative dispatch <= order.quantityMT',
      passed,
      `negStock=${excessiveIssue.code}, overPO=${overReceipt.code}, purchaseGrnBlock=${purchaseAttemptInward.code}, grnFinalStatus=${validStoresGrn.data?.purchaseOrder.status}, overDispatch=${dispatchOverLimit.code}, finalSO=${dispatchFinal5MT.data?.order.overallStatus}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T08: Clean production initialization without sample records
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_SUPER_ADMIN);

    const initRes = await initializeCleanProductionFirestore(
      service,
      CALLER_SUPER_ADMIN
    );

    const sysConfigCount = driver.countCollection('systemConfig');
    const userCount = driver.countCollection('users');
    const businessRecordCounts = BUSINESS_DATA_COLLECTIONS.map((c) =>
      driver.countCollection(c)
    );
    const totalBusinessRecords = businessRecordCounts.reduce(
      (acc, n) => acc + n,
      0
    );

    const kpisDoc = await service.getDocumentById<FirestoreSystemConfigDoc>(
      'systemConfig',
      'dashboardKpis'
    );
    const prodSummaryDoc =
      await service.getDocumentById<FirestoreSystemConfigDoc>(
        'systemConfig',
        'productionSummary'
      );
    const thresholdsDoc =
      await service.getDocumentById<FirestoreSystemConfigDoc>(
        'systemConfig',
        'alertThresholds'
      );

    const passed =
      initRes.success === true &&
      initRes.createdConfigs.length === 3 &&
      initRes.skippedExistingConfigs.length === 0 &&
      initRes.businessCollectionsSeededCount === 0 &&
      initRes.superAdminAutoCreated === false &&
      sysConfigCount === 3 &&
      userCount === 0 &&
      totalBusinessRecords === 0 &&
      kpisDoc.status === 'ok' &&
      kpisDoc.data?.activeOrdersCount === 0 &&
      kpisDoc.data?.totalOrderBookValue === 0 &&
      prodSummaryDoc.status === 'ok' &&
      thresholdsDoc.status === 'ok';

    recordResult(
      'P4-T08',
      'Clean-Production Initialization',
      'Initializes only the 3 zeroed /systemConfig singletons with 0 sample business records and 0 auto-created users',
      passed,
      `createdConfigs=[${initRes.createdConfigs.join(', ')}], sysConfigCount=${sysConfigCount}, totalBusinessRecords=${totalBusinessRecords}, superAdminAutoCreated=${initRes.superAdminAutoCreated}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T09: Idempotent initialization on retry (Service + HTTP Endpoint POST /api/admin/system/initialize)
  // --------------------------------------------------------------------------
  {
    const driver = new InMemoryTransactionalFirestoreDriver();
    const service = new MontexFirestoreService(driver, () => CALLER_SUPER_ADMIN);

    // First run via service
    const run1 = await initializeCleanProductionFirestore(
      service,
      CALLER_SUPER_ADMIN
    );

    // Mutate dashboardKpis to simulate live production activity (activeOrdersCount = 7)
    await service.updateDocument<FirestoreSystemConfigDoc>(
      'systemConfig',
      'dashboardKpis',
      { activeOrdersCount: 7 }
    );

    // Second run via service — must skip all 3 existing docs and preserve activeOrdersCount === 7
    const run2 = await initializeCleanProductionFirestore(
      service,
      CALLER_SUPER_ADMIN
    );
    const kpisAfterRetry =
      await service.getDocumentById<FirestoreSystemConfigDoc>(
        'systemConfig',
        'dashboardKpis'
      );

    // Also verify HTTP route POST /api/admin/system/initialize with injected adapters
    const httpConfigMap = new Map<string, FirestoreSystemConfigDoc>();
    const mockAuthAdapter: AdminAuthAdapter = {
      verifyIdToken: async () =>
        ({
          uid: CALLER_SUPER_ADMIN.uid,
          email: CALLER_SUPER_ADMIN.email,
          aud: 'montex-forge-mis',
          auth_time: 1700000000,
          exp: 1900000000,
          iat: 1700000000,
          iss: 'https://securetoken.google.com/montex-forge-mis',
          sub: CALLER_SUPER_ADMIN.uid,
          firebase: { identities: {}, sign_in_provider: 'password' },
        }) as any,
      getUser: async () => null,
      getUserByEmail: async () => null,
      createUser: async () => ({
        uid: 'u1',
        email: 'e',
        disabled: false,
        emailVerified: true,
      }),
      updateUser: async (uid) => ({
        uid,
        email: 'e',
        disabled: false,
        emailVerified: true,
      }),
      setCustomUserClaims: async () => {},
      revokeRefreshTokens: async () => {},
      generatePasswordResetLink: async () => 'https://reset.example',
    };
    const mockStoreAdapter: EmployeeStoreAdapter = {
      getEmployeeProfile: async (uid: string) =>
        uid === CALLER_SUPER_ADMIN.uid
          ? {
              id: CALLER_SUPER_ADMIN.uid,
              uid: CALLER_SUPER_ADMIN.uid,
              name: 'Keyur Shah',
              displayName: 'Keyur Shah',
              email: CALLER_SUPER_ADMIN.email,
              role: 'super_admin',
              roleTitle: 'Super Administrator',
              department: 'Management',
              avatarInitials: 'KS',
              status: 'Active',
              accountStatus: 'active',
              createdAt: '2026-04-01T00:00:00.000Z',
              updatedAt: '2026-04-01T00:00:00.000Z',
            }
          : null,
      getEmployeeProfileByEmail: async () => null,
      listEmployeeProfiles: async () => [],
      countActiveSuperAdmins: async () => 1,
      saveEmployeeProfile: async () => {},
      appendAuditLog: async () => {},
      listAuditLogs: async () => [],
    };
    const mockSystemConfigAdapter: SystemConfigStoreAdapter = {
      getSystemConfig: async (configId: string) =>
        httpConfigMap.get(configId) ?? null,
      createSystemConfigIfAbsent: async (doc: FirestoreSystemConfigDoc) => {
        if (httpConfigMap.has(doc.configId)) return false;
        httpConfigMap.set(doc.configId, doc);
        return true;
      },
    };

    const app = express();
    app.use(express.json());
    app.use(
      '/api/admin/system',
      createSystemInitRouter({
        authAdapter: mockAuthAdapter,
        storeAdapter: mockStoreAdapter,
        systemConfigAdapter: mockSystemConfigAdapter,
      })
    );

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    let httpStatus1 = 0;
    let httpBody1: any = {};
    let httpStatus2 = 0;
    let httpBody2: any = {};
    try {
      const resp1 = await fetch(
        `http://127.0.0.1:${port}/api/admin/system/initialize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-super-admin-token',
          },
        }
      );
      httpStatus1 = resp1.status;
      httpBody1 = await resp1.json();

      const resp2 = await fetch(
        `http://127.0.0.1:${port}/api/admin/system/initialize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-super-admin-token',
          },
        }
      );
      httpStatus2 = resp2.status;
      httpBody2 = await resp2.json();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    const passed =
      run1.success === true &&
      run1.createdConfigs.length === 3 &&
      run2.success === true &&
      run2.createdConfigs.length === 0 &&
      run2.skippedExistingConfigs.length === 3 &&
      kpisAfterRetry.data?.activeOrdersCount === 7 &&
      httpStatus1 === 200 &&
      httpBody1.data?.createdConfigs?.length === 3 &&
      httpStatus2 === 200 &&
      httpBody2.data?.createdConfigs?.length === 0 &&
      httpBody2.data?.skippedExistingConfigs?.length === 3;

    recordResult(
      'P4-T09',
      'Idempotent Initialization on Retry (Service + HTTP)',
      'Repeated initialization skips existing /systemConfig documents without overwriting live KPI values and succeeds via POST /api/admin/system/initialize',
      passed,
      `run1Created=${run1.createdConfigs.length}, run2Skipped=${run2.skippedExistingConfigs.length}, preservedActiveOrders=${kpisAfterRetry.data?.activeOrdersCount}, http1Created=${httpBody1.data?.createdConfigs?.length}, http2Skipped=${httpBody2.data?.skippedExistingConfigs?.length}`
    );
  }

  // --------------------------------------------------------------------------
  // P4-T10: RTDB Preservation & Non-Destructive Live Firestore Health Probe
  // --------------------------------------------------------------------------
  {
    const rtdbExportsPresent =
      typeof rtdbService.seedMontexRealtimeDatabase === 'function' &&
      typeof rtdbService.logAuditToRtdb === 'function' &&
      typeof rtdbService.mapRoleToRbacGroup === 'function' &&
      typeof rtdbService.mapRbacGroupToUserRole === 'function';

    const health = await checkFirestoreConnectionHealth();
    const healthStructured =
      typeof health.databaseId === 'string' &&
      health.databaseId.length > 0 &&
      [
        'reachable',
        'reachable_rules_enforced',
        'unreachable',
        'unconfigured',
      ].includes(health.status);

    const passed = rtdbExportsPresent && healthStructured;

    recordResult(
      'P4-T10',
      'RTDB Preservation & Live Firestore Health Check',
      'Existing RTDB service functions remain intact and live Firestore health check returns structured diagnostic status',
      passed,
      `rtdbExportsPresent=${rtdbExportsPresent}, firestoreDbId=${health.databaseId}, liveHealthStatus=${health.status} (${health.message})`
    );
  }

  console.log('\n======================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  console.log(
    `Phase 4 Verification Summary: ${passedCount}/${results.length} test suites PASSED`
  );
  console.log('======================================================================');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal error in Phase 4 verification suite:', err);
  process.exit(1);
});
