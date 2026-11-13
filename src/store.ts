import { create } from 'zustand';
import type { FinancialSnapshot, Transaction } from './types';
import { calculateFinancialSummary, calculateAccountBalance, getAccountBalanceInfo } from './finance';

type MoneyStore = FinancialSnapshot & {
  hydrated: boolean;
  setSnapshot: (snapshot: FinancialSnapshot) => void;
};

export const useMoneyStore = create<MoneyStore>((set) => ({
  accounts: [],
  transactions: [],
  hydrated: false,
  setSnapshot: (snapshot) => set({ ...snapshot, hydrated: true }),
}));

export { calculateAccountBalance, calculateFinancialSummary, getAccountBalanceInfo };

export function formatCurrency(amountInPaise: number) {
  return `₹${(amountInPaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function transactionColor(type: Transaction['type']) {
  return type === 'CREDIT' ? '#10B981' : '#E11D48';
}
