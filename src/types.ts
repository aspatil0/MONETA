export type TransactionType = 'CREDIT' | 'DEBIT';
export type AccountType = 'Savings' | 'Current' | 'Cash' | 'Other';
export type TransactionSource = 'MANUAL' | 'SMS' | 'IMPORT' | 'TRANSFER';

export type Account = {
  id: number;
  bankName: string;
  nickname: string | null;
  lastFour: string | null;
  type: AccountType;
  openingBalance: number;
  openingDate: string;
  archived: boolean;
};

export type Transaction = {
  id: number;
  title: string;
  type: TransactionType;
  amount: number;
  accountId: number;
  category: string;
  date: string;
  notes: string | null;
  source: TransactionSource;
  transferId: string | null;
  reversedTransactionId: number | null;
};

export type FinancialSnapshot = {
  accounts: Account[];
  transactions: Transaction[];
};

export type DebtDirection = 'LENT' | 'BORROWED';
export type DebtStatus = 'OPEN' | 'SETTLED';

export type Debt = {
  id: number;
  personName: string;
  direction: DebtDirection;
  originalAmount: number;
  settledAmount: number;
  dueDate: string | null;
  notes: string | null;
  status: DebtStatus;
};

export type Subscription = {
  id: number;
  name: string;
  provider: string | null;
  amount: number;
  billingCycle: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  nextBillingDate: string;
  category: string;
  active: boolean;
  notes: string | null;
};

export type SmsReview = {
  id: number;
  messageHash: string;
  rawMessage: string;
  sender: string | null;
  detectedBank: string | null;
  accountId: number | null;
  accountLastFour: string | null;
  transactionType: TransactionType | null;
  amount: number | null;
  merchant: string | null;
  transactionDate: string;
  reportedBalance: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED';
};
