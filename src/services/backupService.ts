import { collection, getDocs, Timestamp } from 'firebase/firestore';
import { firestore, FIREBASE_CONFIG_METADATA } from '../lib/firebase';
import { ALL_FIRESTORE_COLLECTIONS } from './firestoreService';

export interface BackupCollectionResult {
  name: string;
  count: number;
  error?: string;
}

export interface BackupResult {
  fileBase: string;
  totalRecords: number;
  collections: BackupCollectionResult[];
}

// Excel refuses cells longer than this.
const EXCEL_CELL_LIMIT = 32767;

/** Firestore values to plain JSON: timestamps become ISO strings, everything else is kept as stored. */
function toPlain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toPlain(v);
    return out;
  }
  return value;
}

function toCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > EXCEL_CELL_LIMIT ? `${text.slice(0, EXCEL_CELL_LIMIT - 40)} …[cut; full value in the .json file]` : text;
}

function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Reads every collection the signed-in Super Admin can see and downloads two files:
 * a .json copy of every record exactly as stored, and an .xlsx workbook with one sheet
 * per collection for reading. A collection that cannot be read is listed, not skipped silently.
 */
export async function downloadFullBackup(exportedBy: string): Promise<BackupResult> {
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const fileBase = `montex-backup-${stamp}`;

  const data: Record<string, Record<string, unknown>[]> = {};
  const results: BackupCollectionResult[] = [];
  for (const name of ALL_FIRESTORE_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(firestore, name));
      data[name] = snap.docs.map((d) => ({ _id: d.id, ...(toPlain(d.data()) as Record<string, unknown>) }));
      results.push({ name, count: snap.size });
    } catch (err: any) {
      data[name] = [];
      results.push({ name, count: 0, error: err?.code || err?.message || 'Could not read' });
    }
  }
  const totalRecords = results.reduce((s, r) => s + r.count, 0);

  const json = {
    app: 'Montex MIS',
    projectId: FIREBASE_CONFIG_METADATA.projectId,
    databaseId: FIREBASE_CONFIG_METADATA.firestoreDatabaseId,
    exportedAt: now.toISOString(),
    exportedBy,
    totalRecords,
    collections: results,
    data,
  };
  saveFile(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), `${fileBase}.json`);

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const summary = [
    ['Montex MIS backup'],
    ['Exported at', now.toLocaleString('en-IN')],
    ['Exported by', exportedBy],
    ['Total records', totalRecords],
    [],
    ['Collection', 'Records', 'Problem'],
    ...results.map((r) => [r.name, r.count, r.error || '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  for (const r of results) {
    const rows = data[r.name];
    if (!rows.length) continue;
    const headers = Array.from(rows.reduce((set, row) => (Object.keys(row).forEach((k) => set.add(k)), set), new Set<string>()));
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows.map((row) => headers.map((h) => toCell(row[h])))]);
    XLSX.utils.book_append_sheet(wb, sheet, r.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveFile(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${fileBase}.xlsx`);

  return { fileBase, totalRecords, collections: results };
}
