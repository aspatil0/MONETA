import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

const tableNames = [
  'bank_accounts', 'categories', 'transfers', 'transactions', 'budgets',
  'balance_observations', 'sms_processed_messages', 'sms_review_queue',
  'audit_logs', 'debts', 'debt_payments', 'subscriptions', 'app_settings',
] as const;

type BackupRow = Record<string, string | number | null>;
type BackupPayload = {
  format: 'MONETA_BACKUP';
  version: 1;
  exportedAt: string;
  tables: Record<string, BackupRow[]>;
};

function isBackupRow(value: unknown): value is BackupRow {
  return typeof value === 'object' && value !== null && Object.values(value).every((item) => item === null || typeof item === 'string' || typeof item === 'number');
}

function parseBackup(value: unknown): BackupPayload {
  if (typeof value !== 'object' || value === null) throw new Error('This file is not a valid MONETA backup.');
  const candidate = value as { format?: unknown; version?: unknown; tables?: unknown };
  if (candidate.format !== 'MONETA_BACKUP' || candidate.version !== 1 || typeof candidate.tables !== 'object' || candidate.tables === null) {
    throw new Error('This backup is not compatible with this version of MONETA.');
  }
  const tables = candidate.tables as Record<string, unknown>;
  for (const tableName of tableNames) {
    if (tables[tableName] !== undefined && (!Array.isArray(tables[tableName]) || !tables[tableName].every(isBackupRow))) {
      throw new Error(`Invalid data in backup table: ${tableName}.`);
    }
  }
  return { format: 'MONETA_BACKUP', version: 1, exportedAt: typeof value === 'object' && 'exportedAt' in value && typeof (value as { exportedAt?: unknown }).exportedAt === 'string' ? (value as { exportedAt: string }).exportedAt : '', tables: tables as Record<string, BackupRow[]> };
}

export async function createBackupFile(db: SQLiteDatabase) {
  const tables: Record<string, BackupRow[]> = {};
  for (const tableName of tableNames) {
    tables[tableName] = await db.getAllAsync<BackupRow>(`SELECT * FROM ${tableName}`);
  }
  const payload: BackupPayload = { format: 'MONETA_BACKUP', version: 1, exportedAt: new Date().toISOString(), tables };
  const file = new File(Paths.cache, `moneta-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await file.write(JSON.stringify(payload));
  return file.uri;
}

export async function restoreBackupFile(db: SQLiteDatabase, uri: string) {
  const content = await new File(uri).text();
  const backup = parseBackup(JSON.parse(content) as unknown);
  await db.withTransactionAsync(async () => {
    for (const tableName of [...tableNames].reverse()) await db.runAsync(`DELETE FROM ${tableName}`);
    for (const tableName of tableNames) {
      const rows = backup.tables[tableName] ?? [];
      for (const row of rows) {
        const columns = Object.keys(row);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(', ');
        const values = columns.map((column) => row[column]);
        await db.runAsync(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`, ...values);
      }
    }
  });
}
