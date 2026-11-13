import type { Account, Transaction } from './types';
import { formatCurrency } from './store';

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export function createTransactionsPdfHtml(accounts: Account[], transactions: Transaction[]) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const rows = [...transactions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((transaction) => {
      const accountName = accountById.get(transaction.accountId)?.bankName ?? 'Unknown bank';
      const direction = transaction.type === 'CREDIT' ? 'CR' : 'DR';
      const reason = transaction.category ? `${transaction.title} · ${transaction.category}` : transaction.title;
      return `<tr>
        <td>${escapeHtml(transaction.date)}</td>
        <td>${escapeHtml(accountName)}</td>
        <td>${escapeHtml(reason)}${transaction.notes ? `<br><small>${escapeHtml(transaction.notes)}</small>` : ''}</td>
        <td class="${direction === 'CR' ? 'credit' : 'debit'}">${direction}</td>
        <td class="amount">${escapeHtml(formatCurrency(transaction.amount))}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page { margin: 28px; }
          body { font-family: Arial, sans-serif; color: #171717; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .generated { color: #777; font-size: 11px; margin-bottom: 20px; }
          table { border-collapse: collapse; width: 100%; font-size: 10px; }
          th { background: #171717; color: #fff; text-align: left; }
          th, td { border: 1px solid #ddd; padding: 8px 6px; vertical-align: top; }
          .credit { color: #26865B; font-weight: bold; }
          .debit { color: #D94B3D; font-weight: bold; }
          .amount { text-align: right; white-space: nowrap; }
          small { color: #777; }
        </style>
      </head>
      <body>
        <h1>Moneta Transaction Statement</h1>
        <div class="generated">All transactions · Generated ${escapeHtml(new Date().toLocaleDateString('en-IN'))}</div>
        ${rows ? `<table><thead><tr><th>Date</th><th>Bank</th><th>Reason</th><th>Type</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No transactions recorded.</p>'}
      </body>
    </html>`;
}

export function createBankStatementPdfHtml(account: Account, transactions: Transaction[]) {
  const accountTransactions = transactions
    .filter((transaction) => transaction.accountId === account.id && !transaction.reversedTransactionId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  let runningBalance = account.openingBalance;
  const rows = accountTransactions.map((transaction) => {
    const beforeBalance = runningBalance;
    runningBalance += transaction.type === 'CREDIT' ? transaction.amount : -transaction.amount;
    const direction = transaction.type === 'CREDIT' ? 'CR' : 'DR';
    return `<tr>
      <td>${escapeHtml(transaction.date)}</td>
      <td>${escapeHtml(transaction.title)}${transaction.category ? `<br><small>${escapeHtml(transaction.category)}</small>` : ''}</td>
      <td class="amount">${escapeHtml(formatCurrency(transaction.amount))}</td>
      <td class="amount">${escapeHtml(formatCurrency(beforeBalance))}</td>
      <td class="amount">${escapeHtml(formatCurrency(runningBalance))}</td>
      <td class="${direction === 'CR' ? 'credit' : 'debit'}">${direction}</td>
    </tr>`;
  }).join('');

  return `<!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          @page { margin: 28px; }
          body { font-family: Arial, sans-serif; color: #171717; }
          h1 { font-size: 22px; margin-bottom: 4px; }
          .meta { color: #777; font-size: 11px; margin-bottom: 8px; }
          .opening { font-size: 14px; font-weight: bold; margin: 18px 0; }
          table { border-collapse: collapse; width: 100%; font-size: 9px; }
          th { background: #171717; color: #fff; text-align: left; }
          th, td { border: 1px solid #ddd; padding: 7px 5px; vertical-align: top; }
          .credit { color: #26865B; font-weight: bold; }
          .debit { color: #D94B3D; font-weight: bold; }
          .amount { text-align: right; white-space: nowrap; }
          small { color: #777; }
          .closing { border-top: 2px solid #171717; margin-top: 18px; padding-top: 10px; font-weight: bold; text-align: right; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(account.bankName)} Bank Statement</h1>
        <div class="meta">${escapeHtml(account.nickname || account.type)} · Generated ${escapeHtml(new Date().toLocaleDateString('en-IN'))}</div>
        <div class="opening">Opening balance: ${escapeHtml(formatCurrency(account.openingBalance))}</div>
        ${rows ? `<table><thead><tr><th>Date</th><th>Transaction</th><th>Amount</th><th>Before balance</th><th>After balance</th><th>DR/CR</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>No transactions recorded for this account.</p>'}
        <div class="closing">Closing balance: ${escapeHtml(formatCurrency(runningBalance))}</div>
      </body>
    </html>`;
}
