import type { Account, Transaction } from './types';

export function calculateAccountBalance(account: Account, transactions: Transaction[]) {
  return account.openingBalance + transactions
    .filter((transaction) => transaction.accountId === account.id)
    .reduce((balance, transaction) => balance + (transaction.type === 'CREDIT' ? transaction.amount : -transaction.amount), 0);
}

export function getAccountBalanceInfo(account: Account, transactions: Transaction[]) {
  const rawBalance = calculateAccountBalance(account, transactions);
  return {
    rawBalance,
    displayBalance: Math.max(0, rawBalance),
    isInsufficient: rawBalance <= 0,
    isOverdrawn: rawBalance < 0,
  };
}

export function calculateFinancialSummary(accounts: Account[], transactions: Transaction[], now = new Date()) {
  const activeAccounts = accounts.filter((account) => !account.archived);
  const today = toDateKey(now);
  const monthPrefix = today.slice(0, 7);
  const activeTransactions = transactions.filter((transaction) => !transaction.reversedTransactionId);
  const debit = (items: Transaction[]) => items.filter((item) => item.type === 'DEBIT').reduce((sum, item) => sum + item.amount, 0);
  const credit = (items: Transaction[]) => items.filter((item) => item.type === 'CREDIT').reduce((sum, item) => sum + item.amount, 0);
  return {
    totalBalance: Math.max(0, activeAccounts.reduce((sum, account) => sum + calculateAccountBalance(account, activeTransactions), 0)),
    todaySpending: debit(activeTransactions.filter((item) => item.date === today)),
    monthlySpending: debit(activeTransactions.filter((item) => item.date.startsWith(monthPrefix))),
    monthlyIncome: credit(activeTransactions.filter((item) => item.date.startsWith(monthPrefix))),
    monthlySavings: credit(activeTransactions.filter((item) => item.date.startsWith(monthPrefix)))-debit(activeTransactions.filter((item) => item.date.startsWith(monthPrefix))),
  };
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parsePaise(value: string) {
  const normalized = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
