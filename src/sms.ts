import type { SQLiteDatabase } from 'expo-sqlite';
import { createAccount, getAutoApproveSms, confirmSmsReview } from './database';
import type { Account, SmsReview, TransactionType } from './types';
import { toDateKey } from './finance';
import { sendTransactionNotification } from './notificationManager';

function hashMessage(value: string, receivedAt?: Date) {
  // 15-second debounce bucket so duplicate native OS callbacks are deduplicated,
  // but future payments with similar text can still queue without getting stuck
  const bucket = receivedAt ? Math.floor(receivedAt.getTime() / 15000) : 0;
  const str = bucket ? `${value}_${bucket}` : value;
  let hash = 2166136261;
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export interface BankDescriptor {
  name: string;
  shortName: string;
  code: string;
  aliases: string[];
}

export const POPULAR_BANKS: BankDescriptor[] = [
  { name: 'State Bank of India', shortName: 'SBI', code: 'SBI', aliases: ['state bank of india', 'state bank', 'sbi', 'sbik'] },
  { name: 'Bank of India', shortName: 'BOI', code: 'BOI', aliases: ['bank of india', 'boi', 'bk of india'] },
  { name: 'Union Bank of India', shortName: 'Union Bank', code: 'UBI', aliases: ['union bank of india', 'union bank', 'union bk', 'ubi'] },
  { name: 'HDFC Bank', shortName: 'HDFC', code: 'HDFC', aliases: ['hdfc bank', 'hdfc', 'hdfcbk'] },
  { name: 'ICICI Bank', shortName: 'ICICI', code: 'ICICI', aliases: ['icici bank', 'icici', 'icicibk'] },
  { name: 'Punjab National Bank', shortName: 'PNB', code: 'PNB', aliases: ['punjab national bank', 'pnb'] },
  { name: 'Bank of Baroda', shortName: 'BOB', code: 'BOB', aliases: ['bank of baroda', 'baroda', 'bob'] },
  { name: 'Axis Bank', shortName: 'Axis', code: 'AXIS', aliases: ['axis bank', 'axis', 'uti bank'] },
  { name: 'Kotak Mahindra Bank', shortName: 'Kotak', code: 'KOTAK', aliases: ['kotak mahindra bank', 'kotak bank', 'kotak'] },
  { name: 'Canara Bank', shortName: 'Canara', code: 'CANARA', aliases: ['canara bank', 'canara', 'cnrb'] },
  { name: 'IndusInd Bank', shortName: 'IndusInd', code: 'INDUS', aliases: ['indusind bank', 'indusind', 'indus'] },
  { name: 'IDFC FIRST Bank', shortName: 'IDFC FIRST', code: 'IDFC', aliases: ['idfc first bank', 'idfc first', 'idfc bank', 'idfc'] },
  { name: 'Federal Bank', shortName: 'Federal', code: 'FED', aliases: ['federal bank', 'fed bank', 'federal'] },
  { name: 'IDBI Bank', shortName: 'IDBI', code: 'IDBI', aliases: ['idbi bank', 'idbi'] },
  { name: 'Central Bank of India', shortName: 'Central Bank', code: 'CBI', aliases: ['central bank of india', 'central bank', 'cbi'] },
  { name: 'Indian Bank', shortName: 'Indian Bank', code: 'INDIAN', aliases: ['indian bank', 'indbank'] },
  { name: 'Indian Overseas Bank', shortName: 'IOB', code: 'IOB', aliases: ['indian overseas bank', 'iob'] },
  { name: 'UCO Bank', shortName: 'UCO', code: 'UCO', aliases: ['uco bank', 'uco'] },
  { name: 'Yes Bank', shortName: 'Yes Bank', code: 'YES', aliases: ['yes bank', 'yes'] },
  { name: 'Punjab & Sind Bank', shortName: 'PSB', code: 'PSB', aliases: ['punjab and sind bank', 'punjab & sind bank', 'psb'] },
  { name: 'Paytm Payments Bank', shortName: 'Paytm Bank', code: 'PAYTM', aliases: ['paytm payments bank', 'paytm bank', 'paytm'] },
  { name: 'Airtel Payments Bank', shortName: 'Airtel Bank', code: 'AIRTEL', aliases: ['airtel payments bank', 'airtel bank', 'airtel'] },
  // Foreign / International banks commonly used in India
  { name: 'DBS Bank', shortName: 'DBS', code: 'DBS', aliases: ['dbs bank', 'dbs', 'digibank', 'dbs digibank'] },
  { name: 'Citibank', shortName: 'Citi', code: 'CITI', aliases: ['citibank', 'citi bank', 'citi'] },
  { name: 'Standard Chartered', shortName: 'StanChart', code: 'SCB', aliases: ['standard chartered', 'stanchart', 'scb'] },
  { name: 'HSBC Bank', shortName: 'HSBC', code: 'HSBC', aliases: ['hsbc bank', 'hsbc'] },
  { name: 'Deutsche Bank', shortName: 'Deutsche', code: 'DB', aliases: ['deutsche bank', 'deutsche'] },
  { name: 'RBL Bank', shortName: 'RBL', code: 'RBL', aliases: ['rbl bank', 'rbl', 'ratnakar bank'] },
  { name: 'South Indian Bank', shortName: 'SIB', code: 'SIB', aliases: ['south indian bank', 'sib'] },
  { name: 'Bandhan Bank', shortName: 'Bandhan', code: 'BANDHAN', aliases: ['bandhan bank', 'bandhan'] },
];

export function findBankDescriptor(textOrName: string): BankDescriptor | undefined {
  const norm = textOrName.toLowerCase().trim();
  for (const b of POPULAR_BANKS) {
    if (
      b.name.toLowerCase() === norm ||
      b.shortName.toLowerCase() === norm ||
      b.code.toLowerCase() === norm
    ) {
      return b;
    }
    for (const alias of b.aliases) {
      if (new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(norm)) {
        return b;
      }
    }
  }
  return undefined;
}

export function findMatchingAccount(
  accounts: Account[],
  parsed: { accountLastFour: string | null; detectedBank: string | null },
  rawMessage: string
): Account | undefined {
  if (accounts.length === 0) return undefined;

  // 1. Highest priority: exact match on last 4 digits
  if (parsed.accountLastFour) {
    const byLastFour = accounts.find(
      (a) => a.lastFour && a.lastFour.trim() === parsed.accountLastFour
    );
    if (byLastFour) return byLastFour;
  }

  // 2. Match by Bank Alias / Descriptor against existing accounts
  const rawLower = rawMessage.toLowerCase();
  for (const acc of accounts) {
    const desc = findBankDescriptor(acc.bankName);
    if (desc) {
      for (const alias of desc.aliases) {
        if (new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(rawLower)) {
          return acc;
        }
      }
    }
  }

  // 3. Match by detectedBank string against account name
  if (parsed.detectedBank) {
    const detectedDesc = findBankDescriptor(parsed.detectedBank);
    for (const acc of accounts) {
      const accDesc = findBankDescriptor(acc.bankName);
      if (detectedDesc && accDesc && detectedDesc.code === accDesc.code) {
        return acc;
      }
      const accClean = acc.bankName.toLowerCase().replace(/\s+bank$/, '').trim();
      const detClean = parsed.detectedBank.toLowerCase().replace(/\s+bank$/, '').trim();
      if (
        accClean.length > 2 &&
        detClean.length > 2 &&
        (accClean.includes(detClean) || detClean.includes(accClean))
      ) {
        return acc;
      }
    }
  }

  // 4. If only one account exists in the app, default to it (safe assumption).
  // If multiple accounts exist and no match found, return undefined — do not auto-assign
  // to wrong bank (user will pick manually in the review modal).
  if (accounts.length === 1) return accounts[0];
  return undefined;
}

export function parseBankSms(rawMessage: string, receivedAt = new Date()): Omit<SmsReview, 'id' | 'status'> {
  const text = rawMessage.replace(/\s+/g, ' ').trim();
  const normalized = text.toLowerCase();

  // 1. Debit or Credit
  const debitMatch = normalized.match(/\b(debited|debit|spent|withdrawn|paid|sent|transferred|purchase|deducted|deduct)\b/);
  const creditMatch = normalized.match(/\b(credited|credit|received|deposited|transferred|added|refunded)\b/);
  const type: TransactionType | null = debitMatch && creditMatch
    ? (debitMatch.index ?? Number.MAX_SAFE_INTEGER) < (creditMatch.index ?? Number.MAX_SAFE_INTEGER) ? 'DEBIT' : 'CREDIT'
    : debitMatch ? 'DEBIT' : creditMatch ? 'CREDIT' : null;

  // 2. Amount (supports Rs 50, Rs. 50, INR 50, ₹50, 50.00 Rs, 50 Rs)
  const amountMatch = text.match(/(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i)
    ?? text.match(/\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)\b/i);

  // 3. Balance
  const balanceMatch = text.match(/(?:available\s+balance|avl\.?\s+bal(?:ance)?|balance)\s*(?:is|:)?\s*(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);

  // 4. Account Last 4
  const accountMatch = text.match(/(?:a\/c|account|acct|ac)\s*(?:xx|x{2,}|\*{2,})?([0-9]{4})\b/i);

  // 5. Merchant / Payee
  const merchantMatch = text.match(/\b(?:to|at|from|towards|paid to|sent to|transfer to)\s+([A-Za-z0-9][A-Za-z0-9 &.'-]{1,40}?)(?:\s+(?:on|via|ref|using|avl|available|gpay|upi|phonepe|paytm|[.!,]|$))/i)
    ?? text.match(/\b(?:info:?|desc:?|vpa:?)\s*([A-Za-z0-9@_.-]+)/i);

  // 6. Bank Name (Union Bank, SBI, HDFC, ICICI, etc.)
  let detectedBank: string | null = null;
  for (const b of POPULAR_BANKS) {
    for (const alias of b.aliases) {
      if (new RegExp(`\\b${alias.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
        detectedBank = b.name;
        break;
      }
    }
    if (detectedBank) break;
  }
  if (!detectedBank) {
    const genericMatch = text.match(/\b(?:in\s+(?:your\s+)?|with\s+|at\s+)([A-Za-z][A-Za-z&.-]*(?:\s+[A-Za-z][A-Za-z&.-]*){0,2})\s+(?:bank|bk)\b/i);
    if (genericMatch) {
      detectedBank = genericMatch[1].toLowerCase().includes('bank') ? genericMatch[1] : `${genericMatch[1]} Bank`;
    }
  }

  const paise = (value: string | undefined) => value ? Math.round(Number(value.replace(/,/g, '')) * 100) : null;
  const amount = paise(amountMatch?.[1]);
  const reportedBalance = paise(balanceMatch?.[1]);
  const accountLastFour = accountMatch?.[1] ?? null;
  // Issue 4 fix: confidence is MEDIUM even without lastFour if bank name is detected
  const confidence = type && amount && accountLastFour ? 'HIGH'
    : type && amount && detectedBank ? 'HIGH'
    : type && amount ? 'MEDIUM'
    : 'LOW';

  return {
    messageHash: hashMessage(text, receivedAt),
    rawMessage: text,
    sender: null,
    detectedBank,
    accountId: null,
    accountLastFour,
    transactionType: type,
    amount,
    merchant: merchantMatch?.[1]?.trim() ?? (type === 'DEBIT' ? 'UPI Payment' : 'UPI Credit'),
    transactionDate: toDateKey(receivedAt),
    reportedBalance,
    confidence,
  };
}

export function isBankTransactionSms(rawMessage: string) {
  const normalized = rawMessage.replace(/\s+/g, ' ').trim().toLowerCase();
  const hasAmount = /(?:rs\.?|inr|₹)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/.test(normalized) ||
    /[0-9][0-9,]*(?:\.[0-9]{1,2})?\s*(?:rs\.?|inr|₹)/.test(normalized);
  const hasTransactionAction = /\b(debited|debit|spent|withdrawn|paid|sent|transferred|credited|credit|received|deposited|purchase|deducted|deduct)\b/.test(normalized);
  // Extended bank pattern: now includes DBS, HSBC, Citi, StanChart, RBL, Bandhan, etc.
  const hasPaymentEvidence = /\b(upi|bank|boi|sbi|hdfc|icici|axis|kotak|pnb|canara|union|paytm|phonepe|gpay|a\/c|account|acct|avl\.?\s*bal(?:ance)?|available\s+balance|transaction|txn|ref(?:erence)?|utr|neft|imps|card|dbs|citi|hsbc|stanchart|rbl|bandhan|federal|indusind|idfc|idbi|ubi|bob|digibank)\b/.test(normalized);
  return hasAmount && hasTransactionAction && hasPaymentEvidence;
}

export async function ingestBankSms(
  db: SQLiteDatabase,
  rawMessage: string,
  accounts: Account[],
  receivedAt = new Date(),
  shouldNotify = true
): Promise<SmsReview> {
  const parsed = parseBankSms(rawMessage, receivedAt);
  if (!isBankTransactionSms(rawMessage)) {
    return { ...parsed, id: 0, status: 'REJECTED' };
  }
  const existingReview = await db.getFirstAsync<SmsReview>(
    "SELECT id, status FROM sms_review_queue WHERE message_hash = ? AND status = 'PENDING'",
    parsed.messageHash
  );
  if (existingReview) {
    return { ...parsed, id: existingReview.id, status: existingReview.status };
  }

  // Always query fresh active accounts directly from SQLite to avoid stale props
  const freshAccounts = await db.getAllAsync<Account>(
    'SELECT id, bank_name as bankName, nickname, last_four as lastFour, type, opening_balance as openingBalance, opening_date as openingDate, archived FROM bank_accounts WHERE archived = 0 ORDER BY id ASC'
  );
  const activeAccounts = freshAccounts.length > 0 ? freshAccounts : accounts.filter((a) => !a.archived);

  let reviewAccount = findMatchingAccount(activeAccounts, parsed, rawMessage);

  // CRITICAL: NEVER auto-create a bank account if the user already has one or more bank accounts!
  // Only create if there are zero accounts in the entire app.
  if (!reviewAccount && activeAccounts.length === 0 && parsed.transactionType && parsed.amount !== null) {
    const fallbackBank = parsed.detectedBank ?? 'Union Bank of India';
    const fallbackLastFour = parsed.accountLastFour ?? '';
    await createAccount(db, {
      bankName: fallbackBank,
      nickname: 'Primary Account',
      openingBalance: 0,
      type: 'Savings',
      lastFour: fallbackLastFour,
      openingDate: parsed.transactionDate,
    });
    reviewAccount = (await db.getFirstAsync<Account>(
      'SELECT id, bank_name as bankName, nickname, last_four as lastFour, type, opening_balance as openingBalance, opening_date as openingDate, archived FROM bank_accounts WHERE bank_name = ? AND last_four IS ? ORDER BY id DESC LIMIT 1',
      fallbackBank,
      fallbackLastFour || null,
    )) ?? undefined;
  }

  const review: SmsReview = {
    ...parsed,
    id: 0,
    status: 'PENDING',
    accountId: reviewAccount?.id ?? null,
    confidence: reviewAccount ? parsed.confidence : 'LOW' as const,
  };

  await db.runAsync(`
    INSERT OR IGNORE INTO sms_review_queue
      (message_hash, raw_message, sender, detected_bank, account_id, account_last_four, transaction_type, amount, merchant, transaction_date, reported_balance, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, review.messageHash, review.rawMessage, review.sender, review.detectedBank, review.accountId, review.accountLastFour, review.transactionType, review.amount, review.merchant, review.transactionDate, review.reportedBalance, review.confidence);

  const queueRow = await db.getFirstAsync<{ id: number; status: SmsReview['status'] }>('SELECT id, status FROM sms_review_queue WHERE message_hash = ?', review.messageHash);
  if (queueRow) {
    review.id = queueRow.id;
    review.status = queueRow.status;
  }

  const autoApprove = await getAutoApproveSms(db);
  if (autoApprove && queueRow?.status === 'PENDING' && review.accountId && review.transactionType && review.amount && review.confidence === 'HIGH') {
    await confirmSmsReview(db, queueRow.id, {
      accountId: review.accountId,
      title: review.merchant ?? 'Bank SMS transaction',
      category: 'General',
      type: review.transactionType,
      amount: review.amount,
      date: review.transactionDate,
      reportedBalance: review.reportedBalance,
    });
  } else if (shouldNotify && queueRow?.status === 'PENDING' && review.amount) {
    // Deliver Android local notification to phone!
    await sendTransactionNotification({
      amount: review.amount,
      title: review.merchant,
      bank: review.detectedBank ?? reviewAccount?.bankName,
      reviewId: queueRow.id,
    });
  }

  return review;
}

export async function rejectInvalidSmsReviews(db: SQLiteDatabase) {
  const pendingReviews = await db.getAllAsync<{ id: number; rawMessage: string }>(
    "SELECT id, raw_message as rawMessage FROM sms_review_queue WHERE status = 'PENDING'",
  );
  for (const review of pendingReviews) {
    if (!isBankTransactionSms(review.rawMessage)) {
      await db.runAsync("UPDATE sms_review_queue SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING'", review.id);
    }
  }
}
