import type { SQLiteDatabase } from 'expo-sqlite';
import type { Account, AccountType, Debt, DebtDirection, FinancialSnapshot, SmsReview, Subscription, Transaction, TransactionSource, TransactionType } from './types';
import { toDateKey } from './finance';

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_name TEXT NOT NULL,
      nickname TEXT,
      last_four TEXT,
      type TEXT NOT NULL CHECK(type IN ('Savings', 'Current', 'Cash', 'Other')),
      opening_balance INTEGER NOT NULL CHECK(opening_balance >= 0),
      opening_date TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'EXPENSE'
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      amount INTEGER NOT NULL CHECK(amount > 0),
      source_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      destination_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      transfer_id TEXT REFERENCES transfers(id),
      reversed_transaction_id INTEGER REFERENCES transactions(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, amount INTEGER NOT NULL, month TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS balance_observations (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL REFERENCES bank_accounts(id), balance INTEGER NOT NULL, observed_at TEXT NOT NULL, source_message_id TEXT);
    CREATE TABLE IF NOT EXISTS sms_processed_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_hash TEXT NOT NULL UNIQUE, account_id INTEGER REFERENCES bank_accounts(id), processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sms_review_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_hash TEXT NOT NULL UNIQUE,
      raw_message TEXT NOT NULL,
      sender TEXT,
      detected_bank TEXT,
      account_id INTEGER REFERENCES bank_accounts(id),
      account_last_four TEXT,
      transaction_type TEXT,
      amount INTEGER,
      merchant TEXT,
      transaction_date TEXT NOT NULL,
      reported_balance INTEGER,
      confidence TEXT NOT NULL DEFAULT 'LOW',
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER, action TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('LENT', 'BORROWED')),
      original_amount INTEGER NOT NULL CHECK(original_amount > 0),
      due_date TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'SETTLED')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS debt_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debt_id INTEGER NOT NULL REFERENCES debts(id),
      amount INTEGER NOT NULL CHECK(amount > 0),
      payment_date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT,
      amount INTEGER NOT NULL CHECK(amount > 0),
      billing_cycle TEXT NOT NULL CHECK(billing_cycle IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
      next_billing_date TEXT NOT NULL,
      category TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await migrateLegacyTables(db);
  await rebuildLegacyTransactions(db);
  await ensureTransactionColumns(db);
  await ensureSmsReviewColumns(db);
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);
    CREATE INDEX IF NOT EXISTS idx_observations_account ON balance_observations(account_id, observed_at);
    CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing ON subscriptions(next_billing_date, active);
  `);
  for (const category of [
    'Food',
    'Milk',
    'Auto',
    'Groceries',
    'Transport',
    'Fuel',
    'Shopping',
    'Bills',
    'Health',
    'Entertainment',
    'Salary',
    'Investment',
    'General',
  ]) {
    await db.runAsync('INSERT OR IGNORE INTO categories (name) VALUES (?)', category);
  }

  async function ensureSmsReviewColumns(db: SQLiteDatabase) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(sms_review_queue)');
    const existing = new Set(columns.map((column) => column.name));
    const additions = [
      ['sender', 'TEXT'], ['detected_bank', 'TEXT'], ['account_id', 'INTEGER'], ['account_last_four', 'TEXT'],
      ['transaction_type', 'TEXT'], ['amount', 'INTEGER'], ['merchant', 'TEXT'], ['transaction_date', 'TEXT'],
      ['reported_balance', 'INTEGER'], ['confidence', "TEXT NOT NULL DEFAULT 'LOW'"],
    ] as const;
    for (const [name, definition] of additions) {
      if (!existing.has(name)) await db.execAsync(`ALTER TABLE sms_review_queue ADD COLUMN ${name} ${definition}`);
    }
    await db.runAsync("UPDATE sms_review_queue SET transaction_date = COALESCE(transaction_date, date(created_at), date('now'))");
  }
}

async function migrateLegacyTables(db: SQLiteDatabase) {
  const legacyAccounts = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = 'accounts'");
  if (legacyAccounts?.count) {
    await db.execAsync(`
      INSERT OR IGNORE INTO bank_accounts (id, bank_name, nickname, last_four, type, opening_balance, opening_date, archived)
      SELECT id, bank_name, name, last_four, type, opening_balance, opening_date, archived FROM accounts;
    `);
  }
}

async function rebuildLegacyTransactions(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
  const existing = new Set(columns.map((column) => column.name));
  const foreignKeys = await db.getAllAsync<{ table: string; from: string }>('PRAGMA foreign_key_list(transactions)');
  const accountForeignKey = foreignKeys.some((foreignKey) => foreignKey.from === 'account_id' && foreignKey.table !== 'bank_accounts');
  if (!existing.has('account_id') || (!accountForeignKey && existing.has('transfer_id'))) return;

  await db.execAsync(`
    ALTER TABLE transactions RENAME TO transactions_legacy;
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      transfer_id TEXT REFERENCES transfers(id),
      reversed_transaction_id INTEGER REFERENCES transactions(id),
      created_at TEXT,
      updated_at TEXT
    );
    INSERT INTO transactions (id, title, type, amount, account_id, category, date, notes, source, created_at, updated_at)
    SELECT id, title, type, amount, account_id, category, date, notes, COALESCE(source, 'MANUAL'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM transactions_legacy
    WHERE account_id IN (SELECT id FROM bank_accounts);
    DROP TABLE transactions_legacy;
  `);
}

async function ensureTransactionColumns(db: SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(transactions)');
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ['transfer_id', 'TEXT'],
    ['reversed_transaction_id', 'INTEGER'],
    ['created_at', 'TEXT'],
    ['updated_at', 'TEXT'],
  ] as const;
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await db.execAsync(`ALTER TABLE transactions ADD COLUMN ${name} ${definition}`);
  }
  if (!existing.has('created_at') || !existing.has('updated_at')) {
    await db.runAsync(
      "UPDATE transactions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)",
    );
  }
}

export async function loadSnapshot(db: SQLiteDatabase): Promise<FinancialSnapshot> {
  const accounts = await db.getAllAsync<Account>('SELECT id, bank_name as bankName, nickname, last_four as lastFour, type, opening_balance as openingBalance, opening_date as openingDate, archived FROM bank_accounts ORDER BY archived, bank_name, id');
  const transactions = await db.getAllAsync<Transaction>('SELECT id, title, type, amount, account_id as accountId, category, date, notes, source, transfer_id as transferId, reversed_transaction_id as reversedTransactionId FROM transactions ORDER BY date DESC, id DESC');
  return { accounts, transactions };
}

export async function loadDebts(db: SQLiteDatabase): Promise<Debt[]> {
  return db.getAllAsync<Debt>(`
    SELECT d.id, d.person_name as personName, d.direction, d.original_amount as originalAmount,
      COALESCE(SUM(p.amount), 0) as settledAmount, d.due_date as dueDate, d.notes, d.status
    FROM debts d LEFT JOIN debt_payments p ON p.debt_id = d.id
    GROUP BY d.id ORDER BY CASE d.status WHEN 'OPEN' THEN 0 ELSE 1 END, d.due_date
  `);
}

export async function createDebt(db: SQLiteDatabase, input: { personName: string; direction: DebtDirection; amount: number; dueDate: string; notes: string }) {
  const result = await db.runAsync(
    'INSERT INTO debts (person_name, direction, original_amount, due_date, notes) VALUES (?, ?, ?, ?, ?)',
    input.personName.trim(), input.direction, input.amount, input.dueDate.trim() || null, input.notes.trim() || null,
  );
  await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'debt', result.lastInsertRowId, 'CREATE', JSON.stringify(input));
}

export async function recordDebtPayment(db: SQLiteDatabase, debtId: number, amount: number, paymentDate: string, notes: string) {
  await db.withTransactionAsync(async () => {
    const debt = await db.getFirstAsync<{ originalAmount: number; settledAmount: number }>(`
      SELECT d.original_amount as originalAmount, COALESCE(SUM(p.amount), 0) as settledAmount
      FROM debts d LEFT JOIN debt_payments p ON p.debt_id = d.id WHERE d.id = ? GROUP BY d.id
    `, debtId);
    if (!debt || amount <= 0 || amount > debt.originalAmount - debt.settledAmount) throw new Error('Payment exceeds the outstanding debt.');
    await db.runAsync('INSERT INTO debt_payments (debt_id, amount, payment_date, notes) VALUES (?, ?, ?, ?)', debtId, amount, paymentDate, notes.trim() || null);
    if (amount === debt.originalAmount - debt.settledAmount) await db.runAsync("UPDATE debts SET status = 'SETTLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", debtId);
    await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'debt', debtId, 'PAYMENT', JSON.stringify({ amount, paymentDate }));
  });
}

export async function loadSubscriptions(db: SQLiteDatabase): Promise<Subscription[]> {
  return db.getAllAsync<Subscription>('SELECT id, name, provider, amount, billing_cycle as billingCycle, next_billing_date as nextBillingDate, category, active, notes FROM subscriptions ORDER BY active DESC, next_billing_date');
}

export async function createSubscription(db: SQLiteDatabase, input: { name: string; provider: string; amount: number; billingCycle: Subscription['billingCycle']; nextBillingDate: string; category: string; notes: string }) {
  const result = await db.runAsync(
    'INSERT INTO subscriptions (name, provider, amount, billing_cycle, next_billing_date, category, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    input.name.trim(), input.provider.trim() || null, input.amount, input.billingCycle, input.nextBillingDate, input.category.trim(), input.notes.trim() || null,
  );
  await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'subscription', result.lastInsertRowId, 'CREATE', JSON.stringify(input));
}

export async function setSubscriptionActive(db: SQLiteDatabase, id: number, active: boolean) {
  await db.runAsync('UPDATE subscriptions SET active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', active ? 1 : 0, id);
  await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action) VALUES (?, ?, ?)', 'subscription', id, active ? 'ACTIVATE' : 'PAUSE');
}

export async function getAutoApproveSms(db: SQLiteDatabase) {
  const setting = await db.getFirstAsync<{ value: string }>("SELECT value FROM app_settings WHERE key = 'sms_auto_approve'");
  return setting?.value === 'true';
}

export async function setAutoApproveSms(db: SQLiteDatabase, enabled: boolean) {
  await db.runAsync("INSERT INTO app_settings (key, value) VALUES ('sms_auto_approve', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", enabled ? 'true' : 'false');
}

export async function getPrivacyAccepted(db: SQLiteDatabase): Promise<boolean> {
  const setting = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'privacy_accepted'"
  );
  return setting?.value === 'true';
}

export async function setPrivacyAccepted(db: SQLiteDatabase, accepted: boolean): Promise<void> {
  await db.runAsync(
    "INSERT INTO app_settings (key, value) VALUES ('privacy_accepted', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    accepted ? 'true' : 'false'
  );
}

export async function loadSmsReviews(db: SQLiteDatabase): Promise<SmsReview[]> {
  return db.getAllAsync<SmsReview>(`
    SELECT id, message_hash as messageHash, raw_message as rawMessage, sender,
      detected_bank as detectedBank, account_id as accountId, account_last_four as accountLastFour,
      transaction_type as transactionType, amount, merchant, transaction_date as transactionDate,
      reported_balance as reportedBalance, confidence, status
    FROM sms_review_queue WHERE status = 'PENDING' ORDER BY id DESC
  `);
}

export async function confirmSmsReview(db: SQLiteDatabase, reviewId: number, input: { accountId: number; title: string; category: string; type: TransactionType; amount: number; date: string; reportedBalance: number | null }) {
  await db.withTransactionAsync(async () => {
    const review = await db.getFirstAsync<{ messageHash: string; rawMessage: string }>('SELECT message_hash as messageHash, raw_message as rawMessage FROM sms_review_queue WHERE id = ? AND status = ?', reviewId, 'PENDING');
    if (!review) throw new Error('This SMS review is no longer pending.');
    const processed = await db.getFirstAsync<{ id: number }>('SELECT id FROM sms_processed_messages WHERE message_hash = ?', review.messageHash);
    if (processed) {
      // Remove from queue since it was already processed
      await db.runAsync('DELETE FROM sms_review_queue WHERE id = ?', reviewId);
      return;
    }
    const transaction = await db.runAsync(
      'INSERT INTO transactions (title, type, amount, account_id, category, date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      input.title.trim(), input.type, input.amount, input.accountId, input.category.trim() || 'General', input.date, `Imported from SMS: ${review.rawMessage}`, 'SMS',
    );
    if (input.reportedBalance !== null) {
      await db.runAsync('INSERT INTO balance_observations (account_id, balance, observed_at, source_message_id) VALUES (?, ?, ?, ?)', input.accountId, input.reportedBalance, new Date().toISOString(), review.messageHash);
    }
    await db.runAsync('INSERT INTO sms_processed_messages (message_hash, account_id) VALUES (?, ?)', review.messageHash, input.accountId);
    // Remove the confirmed review from queue so next message reaches cleanly
    await db.runAsync('DELETE FROM sms_review_queue WHERE id = ?', reviewId);
    await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'sms_review', transaction.lastInsertRowId, 'CONFIRM', JSON.stringify({ reviewId, messageHash: review.messageHash }));
  });
}

export async function rejectSmsReview(db: SQLiteDatabase, reviewId: number) {
  // Remove the rejected review from the queue immediately so next messages enter properly
  await db.runAsync('DELETE FROM sms_review_queue WHERE id = ?', reviewId);
}

export async function createAccount(db: SQLiteDatabase, input: { bankName: string; nickname: string; openingBalance: number; type: AccountType; lastFour: string; openingDate: string }) {
  const result = await db.runAsync('INSERT INTO bank_accounts (bank_name, nickname, opening_balance, type, last_four, opening_date) VALUES (?, ?, ?, ?, ?, ?)', input.bankName.trim(), input.nickname.trim() || null, input.openingBalance, input.type, input.lastFour.trim() || null, input.openingDate);
  await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'bank_account', result.lastInsertRowId, 'CREATE', JSON.stringify(input));
}

export async function archiveAccount(db: SQLiteDatabase, accountId: number) {
  await db.runAsync('UPDATE bank_accounts SET archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', accountId);
  await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action) VALUES (?, ?, ?)', 'bank_account', accountId, 'ARCHIVE');
}

export async function loadCategories(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    'SELECT name FROM categories ORDER BY name COLLATE NOCASE ASC'
  );
  return rows.map((row) => row.name);
}

export async function createCategory(db: SQLiteDatabase, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name cannot be empty.');
  await db.runAsync('INSERT OR IGNORE INTO categories (name) VALUES (?)', trimmed);
  return trimmed;
}

export async function createTransaction(db: SQLiteDatabase, input: { title: string; type: TransactionType; amount: number; accountId: number; category: string; date: string; notes: string; source?: TransactionSource }) {
  await db.withTransactionAsync(async () => {
    const account = await db.getFirstAsync<{ id: number }>('SELECT id FROM bank_accounts WHERE id = ? AND archived = 0', input.accountId);
    if (!account) throw new Error('Select an active bank account before saving a transaction.');
    const catName = input.category.trim() || 'General';
    await db.runAsync('INSERT OR IGNORE INTO categories (name) VALUES (?)', catName);
    const result = await db.runAsync('INSERT INTO transactions (title, type, amount, account_id, category, date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', input.title.trim(), input.type, input.amount, input.accountId, catName, input.date, input.notes.trim() || null, input.source ?? 'MANUAL');
    await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'transaction', result.lastInsertRowId, 'CREATE', JSON.stringify(input));
  });
}

export async function reverseTransaction(db: SQLiteDatabase, transactionId: number) {
  await db.withTransactionAsync(async () => {
    const transaction = await db.getFirstAsync<Transaction>('SELECT id, title, type, amount, account_id as accountId, category, date, notes, source, transfer_id as transferId, reversed_transaction_id as reversedTransactionId FROM transactions WHERE id = ?', transactionId);
    if (!transaction || transaction.reversedTransactionId) throw new Error('Transaction is unavailable for reversal.');
    const reverseType: TransactionType = transaction.type === 'CREDIT' ? 'DEBIT' : 'CREDIT';
    const result = await db.runAsync('INSERT INTO transactions (title, type, amount, account_id, category, date, notes, source, reversed_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', `Reversal: ${transaction.title}`, reverseType, transaction.amount, transaction.accountId, transaction.category, toDateKey(new Date()), transaction.notes, 'MANUAL', transaction.id);
    await db.runAsync('UPDATE transactions SET reversed_transaction_id = ? WHERE id = ?', result.lastInsertRowId, transaction.id);
    await db.runAsync('INSERT INTO audit_logs (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)', 'transaction', transactionId, 'REVERSE', JSON.stringify({ reversalId: result.lastInsertRowId }));
  });
}

export async function createTransfer(db: SQLiteDatabase, input: { sourceAccountId: number; destinationAccountId: number; amount: number; date: string; notes: string }) {
  if (input.sourceAccountId === input.destinationAccountId) throw new Error('Choose two different accounts for a transfer.');
  const transferId = `transfer-${Date.now()}`;
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO transfers (id, amount, source_account_id, destination_account_id, date, notes) VALUES (?, ?, ?, ?, ?, ?)', transferId, input.amount, input.sourceAccountId, input.destinationAccountId, input.date, input.notes.trim() || null);
    await db.runAsync('INSERT INTO transactions (title, type, amount, account_id, category, date, notes, source, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 'Transfer out', 'DEBIT', input.amount, input.sourceAccountId, 'Transfer', input.date, input.notes.trim() || null, 'TRANSFER', transferId);
    await db.runAsync('INSERT INTO transactions (title, type, amount, account_id, category, date, notes, source, transfer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', 'Transfer in', 'CREDIT', input.amount, input.destinationAccountId, 'Transfer', input.date, input.notes.trim() || null, 'TRANSFER', transferId);
  });
}

export async function clearAllData(db: SQLiteDatabase) {
  await db.execAsync(`
    DELETE FROM transactions;
    DELETE FROM debt_payments;
    DELETE FROM debts;
    DELETE FROM subscriptions;
    DELETE FROM balance_observations;
    DELETE FROM sms_review_queue;
    DELETE FROM sms_processed_messages;
    DELETE FROM transfers;
    DELETE FROM budgets;
    DELETE FROM audit_logs;
    DELETE FROM app_settings;
    DELETE FROM bank_accounts;
  `);
}
