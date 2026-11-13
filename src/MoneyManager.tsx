import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import {
  archiveAccount,
  clearAllData,
  confirmSmsReview,
  createAccount,
  createCategory,
  createDebt,
  createSubscription,
  createTransaction,
  getAutoApproveSms,
  getPrivacyAccepted,
  loadCategories,
  loadDebts,
  loadSmsReviews,
  loadSnapshot,
  loadSubscriptions,
  recordDebtPayment,
  rejectSmsReview,
  reverseTransaction,
  setAutoApproveSms,
  setPrivacyAccepted,
  setSubscriptionActive,
} from './database';
import {
  calculateAccountBalance,
  calculateFinancialSummary,
  formatCurrency,
  getAccountBalanceInfo,
} from './store';
import { parsePaise, toDateKey } from './finance';
import {
  setupNotificationChannels,
  requestNotificationPermissions,
  sendSubscriptionReminderNotification,
} from './notificationManager';
import {
  clearPendingNotification,
  drainPendingNotifications,
  isNotificationAccessEnabled,
  isNotificationListenerAvailable,
  openNotificationAccessSettings,
} from './notificationBridge';
import { ingestBankSms, rejectInvalidSmsReviews, POPULAR_BANKS, findMatchingAccount } from './sms';
import {
  createBankStatementPdfHtml,
  createTransactionsPdfHtml,
} from './transactionExport';
import { createBackupFile, restoreBackupFile } from './backup';
import type {
  Account,
  AccountType,
  Debt,
  DebtDirection,
  SmsReview,
  Subscription,
  Transaction,
  TransactionType,
} from './types';
import { theme, getCategoryMeta } from './theme';

type MoneyTab = 'Overview' | 'Transactions' | 'Accounts';
type BottomTab = 'Money' | 'Debts' | 'Subscriptions' | 'Settings';
type AccountForm = {
  bankName: string;
  nickname: string;
  openingBalance: string;
  type: AccountType;
  lastFour: string;
  openingDate: string;
};
type TransactionForm = {
  title: string;
  type: TransactionType;
  amount: string;
  accountId: string;
  category: string;
  date: string;
  notes: string;
};
type DebtForm = {
  personName: string;
  direction: DebtDirection;
  amount: string;
  dueDate: string;
  notes: string;
};
type SubscriptionForm = {
  name: string;
  provider: string;
  amount: string;
  billingCycle: Subscription['billingCycle'];
  nextBillingDate: string;
  category: string;
  notes: string;
};
type SmsEditInput = {
  accountId: number;
  title: string;
  category: string;
  type: TransactionType;
  amount: number;
  date: string;
  reportedBalance: number | null;
};

export function MoneyManager() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [moneyTab, setMoneyTab] = useState<MoneyTab>('Overview');
  const [bottomTab, setBottomTab] = useState<BottomTab>('Money');
  const [modal, setModal] = useState<
    'account' | 'transaction' | 'debt' | 'payment' | 'subscription' | 'statement' | 'privacy' | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('ALL');
  const [hideBalance, setHideBalance] = useState(false);
  const [showDetailedBreakdown, setShowDetailedBreakdown] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const [accountForm, setAccountForm] = useState<AccountForm>({
    bankName: '',
    nickname: '',
    openingBalance: '',
    type: 'Savings',
    lastFour: '',
    openingDate: toDateKey(new Date()),
  });
  const [transactionForm, setTransactionForm] = useState<TransactionForm>({
    title: '',
    type: 'DEBIT',
    amount: '',
    accountId: '',
    category: '',
    date: toDateKey(new Date()),
    notes: '',
  });
  const [debts, setDebts] = useState<Debt[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedDebt, setSelectedDebt] = useState<Debt | null>(null);
  const [debtForm, setDebtForm] = useState<DebtForm>({
    personName: '',
    direction: 'LENT',
    amount: '',
    dueDate: '',
    notes: '',
  });
  const [paymentAmount, setPaymentAmount] = useState('');
  const [subscriptionForm, setSubscriptionForm] = useState<SubscriptionForm>({
    name: '',
    provider: '',
    amount: '',
    billingCycle: 'MONTHLY',
    nextBillingDate: toDateKey(new Date()),
    category: '',
    notes: '',
  });
  const [smsReviews, setSmsReviews] = useState<SmsReview[]>([]);
  const [autoApproveSms, setAutoApproveSmsState] = useState(false);
  const [selectedReview, setSelectedReview] = useState<SmsReview | null>(null);
  const [notificationAccess, setNotificationAccess] = useState(false);
  const [selectedStatement, setSelectedStatement] = useState<Account | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [privacyAccepted, setPrivacyAcceptedState] = useState<boolean | null>(null);

  const refresh = React.useCallback(async () => {
    const snapshot = await loadSnapshot(db);
    setAccounts(snapshot.accounts);
    setTransactions(snapshot.transactions);
    setDebts(await loadDebts(db));
    setSubscriptions(await loadSubscriptions(db));
    await rejectInvalidSmsReviews(db);
    setSmsReviews(await loadSmsReviews(db));
    setAutoApproveSmsState(await getAutoApproveSms(db));
    setCategories(await loadCategories(db));
    setPrivacyAcceptedState(await getPrivacyAccepted(db));
  }, [db]);

  const handleAddCategory = async (catName: string) => {
    try {
      await createCategory(db, catName);
      const updated = await loadCategories(db);
      setCategories(updated);
    } catch {
      // Ignored if duplicate or invalid
    }
  };

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      if (!ignore) {
        await refresh();
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!isNotificationListenerAvailable()) return;
    let active = true;
    const processedNativeIds = new Set<string>();
    const poll = async () => {
      try {
        const pending = await drainPendingNotifications();
        const newPending = pending.filter((n) => !processedNativeIds.has(n.id));
        for (const notification of newPending) {
          if (!active) return;
          processedNativeIds.add(notification.id);
          await ingestBankSms(
            db,
            `${notification.title} ${notification.text}`,
            accounts,
            new Date(notification.receivedAt)
          );
          await clearPendingNotification(notification.id);
        }
        if (newPending.length) await refresh();
        setNotificationAccess(await isNotificationAccessEnabled());
      } catch (error) {
        if (active) {
          setMessage(
            error instanceof Error
              ? `Notification listener error: ${error.message}`
              : 'Notification listener error.'
          );
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [db, accounts, refresh]);

  useEffect(() => {
    void setupNotificationChannels().catch(() => {});
    void requestNotificationPermissions().catch(() => {});

    let responseSub: Notifications.Subscription | undefined;
    let receivedSub: Notifications.Subscription | undefined;

    try {
      responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const reviewId = response.notification.request.content.data?.reviewId as number | undefined;
        if (reviewId) {
          loadSmsReviews(db)
            .then((revs) => {
              const match = revs.find((r) => r.id === reviewId);
              if (match) {
                setSelectedReview(match);
              }
            })
            .catch(() => {});
        }
      });
    } catch {
      // Ignored if notifications not supported
    }

    try {
      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        void refresh();
        const reviewId = notification.request.content.data?.reviewId as number | undefined;
        if (reviewId) {
          loadSmsReviews(db)
            .then((revs) => {
              const match = revs.find((r) => r.id === reviewId);
              if (match) {
                setSelectedReview(match);
              }
            })
            .catch(() => {});
        }
      });
    } catch {
      // Ignored if notifications not supported
    }

    return () => {
      responseSub?.remove();
      receivedSub?.remove();
    };
  }, [db, refresh]);

  // ── Subscription Reminder Notifications ──────────────────────────────────
  // Check subscriptions every hour. Notify if due date is 2 days or 1 day away.
  useEffect(() => {
    const notifiedThisSession = new Set<string>();

    const checkSubscriptionReminders = async () => {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const sub of subscriptions) {
          if (!sub.active) continue;
          const due = new Date(sub.nextBillingDate);
          due.setHours(0, 0, 0, 0);
          const diffMs = due.getTime() - today.getTime();
          const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
          // Notify at exactly 2 days and 1 day before due date
          if (diffDays === 2 || diffDays === 1) {
            const key = `${sub.id}_${sub.nextBillingDate}_${diffDays}`;
            if (!notifiedThisSession.has(key)) {
              notifiedThisSession.add(key);
              await sendSubscriptionReminderNotification({
                subscriptionName: sub.name,
                amount: sub.amount,
                daysUntilDue: diffDays,
                subscriptionId: sub.id,
              });
            }
          }
        }
      } catch {
        // Silent fail — reminders are best-effort
      }
    };

    // Run immediately and then every 60 minutes
    void checkSubscriptionReminders();
    const interval = setInterval(() => void checkSubscriptionReminders(), 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [subscriptions]);

  const simulateTestPayment = async (customMessage?: string) => {
    const txnRef = Math.floor(100000 + Math.random() * 900000);
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const testSms =
      customMessage ||
      `Rs 50.00 debited from Union Bank A/c XX4321 at ${timeStr} via UPI to Tea Stall Ref UPI${txnRef}. Avl Bal Rs 44,950.00`;
    try {
      const parsed = await ingestBankSms(db, testSms, accounts, now, true);
      await refresh();
      const revs = await loadSmsReviews(db);
      const target = revs.find((r) => r.id === parsed.id) || revs[0];
      if (target) {
        setSelectedReview(target);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Could not simulate SMS';
      Alert.alert('Simulation Error', errMsg);
    }
  };

  const summary = calculateFinancialSummary(accounts, transactions);
  const activeAccounts = accounts.filter((account) => !account.archived);
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      if (selectedAccountId !== 'ALL' && String(transaction.accountId) !== selectedAccountId) {
        return false;
      }
      const query = search.trim().toLowerCase();
      if (!query) return true;
      const bank = accountById.get(transaction.accountId)?.bankName.toLowerCase() ?? '';
      return (
        transaction.title.toLowerCase().includes(query) ||
        transaction.category.toLowerCase().includes(query) ||
        bank.includes(query)
      );
    });
  }, [transactions, selectedAccountId, search, accountById]);

  function openTransactionForm(prefilledType?: TransactionType) {
    setMessage(null);
    if (activeAccounts.length === 0) {
      setMoneyTab('Accounts');
      setMessage('Add a bank account first. Then you can link transactions to it.');
      return;
    }
    setTransactionForm((prev) => ({
      ...prev,
      type: prefilledType ?? prev.type,
      accountId: prev.accountId || String(activeAccounts[0].id),
      date: toDateKey(new Date()),
    }));
    setModal('transaction');
  }

  async function exportTransactions() {
    if (transactions.length === 0) {
      setMessage('Add a transaction before downloading the statement.');
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({
        html: createTransactionsPdfHtml(accounts, transactions),
      });
      if (await Sharing.isAvailableAsync()) {
        try {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: '.pdf' });
          return;
        } catch {
          // fallback to print dialog
        }
      }
      await Print.printAsync({ uri });
    } catch (error) {
      setMessage(
        error instanceof Error ? `Unable to create PDF: ${error.message}` : 'Unable to create PDF statement.'
      );
    }
  }

  async function exportBankStatement(account: Account) {
    try {
      const { uri } = await Print.printToFileAsync({
        html: createBankStatementPdfHtml(account, transactions),
      });
      if (await Sharing.isAvailableAsync()) {
        try {
          await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: '.pdf' });
          return;
        } catch {
          // fallback to print dialog
        }
      }
      await Print.printAsync({ uri });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Unable to create ${account.bankName} statement PDF: ${error.message}`
          : 'Unable to create bank statement PDF.'
      );
    }
  }

  async function saveAccount() {
    const openingBalance = parsePaise(accountForm.openingBalance);
    if (!accountForm.bankName.trim() || openingBalance === null) {
      return setMessage('Enter a bank name and a valid opening balance.');
    }
    await createAccount(db, { ...accountForm, openingBalance });
    await refresh();
    setAccountForm({
      bankName: '',
      nickname: '',
      openingBalance: '',
      type: 'Savings',
      lastFour: '',
      openingDate: toDateKey(new Date()),
    });
    setModal(null);
  }

  async function exportBackup() {
    try {
      const uri = await createBackupFile(db);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json' });
        setMessage('Backup file is ready. Save it somewhere safe.');
      } else {
        setMessage('Backup created, but sharing is not available on this device.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? `Unable to create backup: ${error.message}` : 'Unable to create backup.');
    }
  }

  async function importBackup() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      Alert.alert(
        'Restore backup?',
        'This will replace all current MONETA data on this device.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => void restoreSelectedBackup(result.assets[0].uri),
          },
        ]
      );
    } catch (error) {
      setMessage(error instanceof Error ? `Unable to select backup: ${error.message}` : 'Unable to select backup.');
    }
  }

  async function restoreSelectedBackup(uri: string) {
    try {
      await restoreBackupFile(db, uri);
      await refresh();
      setMessage('Backup restored successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? `Unable to restore backup: ${error.message}` : 'Unable to restore backup.');
    }
  }

  async function handleClearAllData() {
    Alert.alert(
      'Clear All Application Data?',
      'This will permanently delete all bank accounts, transactions, debts, subscriptions, and logs from this device. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Data',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearAllData(db);
              await refresh();
              setPrivacyAcceptedState(false);
              setMessage('All application data cleared successfully.');
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Failed to clear data.'
              );
            }
          },
        },
      ]
    );
  }

  async function handleReverseTransaction(transaction: Transaction) {
    Alert.alert(
      'Reverse Transaction?',
      `This will create an opposite ${transaction.type === 'CREDIT' ? 'DEBIT' : 'CREDIT'} entry to offset "${transaction.title}" of ${formatCurrency(transaction.amount)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reverse',
          style: 'destructive',
          onPress: async () => {
            try {
              await reverseTransaction(db, transaction.id);
              await refresh();
              setSelectedTransaction(null);
              setMessage('Transaction reversed successfully.');
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : 'Failed to reverse transaction.'
              );
            }
          },
        },
      ]
    );
  }

  async function executeSaveTransaction(amount: number) {
    await createTransaction(db, {
      ...transactionForm,
      amount,
      accountId: Number(transactionForm.accountId),
      notes: transactionForm.notes,
    });
    await refresh();
    setTransactionForm({
      title: '',
      type: 'DEBIT',
      amount: '',
      accountId: '',
      category: '',
      date: toDateKey(new Date()),
      notes: '',
    });
    setModal(null);
  }

  async function saveTransaction() {
    const amount = parsePaise(transactionForm.amount);
    if (
      !transactionForm.title.trim() ||
      !transactionForm.category.trim() ||
      amount === null ||
      !transactionForm.accountId
    ) {
      return setMessage('Transaction name, amount, account, and category are required.');
    }

    const selectedAcc = accounts.find((a) => String(a.id) === transactionForm.accountId);
    if (selectedAcc && transactionForm.type === 'DEBIT') {
      const balInfo = getAccountBalanceInfo(selectedAcc, transactions);
      if (amount > balInfo.rawBalance) {
        Alert.alert(
          '⚠️ Insufficient Balance Warning',
          `This expense of ${formatCurrency(amount)} exceeds the available balance in ${selectedAcc.bankName} (${formatCurrency(balInfo.displayBalance)}). If recorded, the balance will be marked at ₹0.00.\n\nDo you want to proceed?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Record Transaction',
              style: 'destructive',
              onPress: () => void executeSaveTransaction(amount),
            },
          ]
        );
        return;
      }
    }

    await executeSaveTransaction(amount);
  }

  async function saveDebt() {
    const amount = parsePaise(debtForm.amount);
    if (!debtForm.personName.trim() || amount === null) {
      return setMessage('Person and a valid amount are required.');
    }
    await createDebt(db, { ...debtForm, amount });
    await refresh();
    setDebtForm({ personName: '', direction: 'LENT', amount: '', dueDate: '', notes: '' });
    setModal(null);
  }

  async function savePayment() {
    if (!selectedDebt) return;
    const amount = parsePaise(paymentAmount);
    if (amount === null) return setMessage('Enter a valid payment amount.');
    try {
      await recordDebtPayment(db, selectedDebt.id, amount, toDateKey(new Date()), '');
      await refresh();
      setPaymentAmount('');
      setSelectedDebt(null);
      setModal(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save debt payment.');
    }
  }

  async function saveSubscription() {
    const amount = parsePaise(subscriptionForm.amount);
    if (!subscriptionForm.name.trim() || amount === null || !subscriptionForm.category.trim()) {
      return setMessage('Name, amount, and category are required.');
    }
    await createSubscription(db, { ...subscriptionForm, amount });
    await refresh();
    setSubscriptionForm({
      name: '',
      provider: '',
      amount: '',
      billingCycle: 'MONTHLY',
      nextBillingDate: toDateKey(new Date()),
      category: '',
      notes: '',
    });
    setModal(null);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />

      {/* Compact Top Bar */}
      <View style={styles.compactTopBar}>
        <View style={styles.compactBrand}>
          <Image
            source={require('../assets/logo.png')}
            style={styles.compactLogoImage}
            resizeMode="contain"
          />
          <Text style={styles.compactBrandName}>MONETA</Text>
        </View>
        <View style={styles.headerRightActions}>
          <Pressable
            onPress={() => setHideBalance((prev) => !prev)}
            style={styles.headerIconButton}
            accessibilityLabel="Toggle privacy"
          >
            <Ionicons
              name={hideBalance ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={theme.colors.textPrimary}
            />
          </Pressable>
          <Pressable
            onPress={() => setBottomTab('Settings')}
            style={styles.avatarPill}
            accessibilityLabel="Go to Settings"
          >
            <Text style={styles.avatarText}>MP</Text>
          </Pressable>
        </View>
      </View>

      {/* Main Screen Body based on BottomTab */}
      <View style={styles.mainContainer}>
        {bottomTab === 'Money' ? (
          <>
            {/* Segmented Top Filter Tabs (Overview / Transactions / Accounts) */}
            <View style={styles.topTabsWrapper}>
              <View style={styles.topTabsTrack}>
                {(['Overview', 'Transactions', 'Accounts'] as const).map((tab) => {
                  const isActive = moneyTab === tab;
                  return (
                    <Pressable
                      key={tab}
                      onPress={() => setMoneyTab(tab)}
                      style={[styles.topTabPill, isActive && styles.activeTopTabPill]}
                    >
                      <Text
                        style={[styles.topTabText, isActive && styles.activeTopTabText]}
                      >
                        {tab}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ScrollView
              contentContainerStyle={[styles.contentScroll, { paddingBottom: 110 + insets.bottom }]}
              showsVerticalScrollIndicator={false}
            >
              {moneyTab === 'Overview' && (
                <Overview
                  accounts={activeAccounts}
                  transactions={transactions}
                  summary={summary}
                  accountById={accountById}
                  range={range}
                  setRange={setRange}
                  hideBalance={hideBalance}
                  onToggleHideBalance={() => setHideBalance((prev) => !prev)}
                  onTransactions={() => setMoneyTab('Transactions')}
                  onAccounts={() => setMoneyTab('Accounts')}
                  onAddTransaction={() => openTransactionForm()}
                  onExportStatement={() => void exportTransactions()}
                  onViewDetailedBreakdown={() => setShowDetailedBreakdown(true)}
                  onSelectTransaction={(t) => setSelectedTransaction(t)}
                  onAddAccount={() => {
                    setMessage(null);
                    setModal('account');
                  }}
                  onViewAccountStatement={(account) => {
                    setSelectedStatement(account);
                    setModal('statement');
                  }}
                  pendingReviews={smsReviews}
                  onReviewPending={(rev) => setSelectedReview(rev)}
                  onSimulateTest={() => void simulateTestPayment()}
                />
              )}

              {moneyTab === 'Transactions' && (
                <TransactionsView
                  transactions={filteredTransactions}
                  accountById={accountById}
                  accounts={activeAccounts}
                  selectedAccountId={selectedAccountId}
                  setSelectedAccountId={setSelectedAccountId}
                  search={search}
                  setSearch={setSearch}
                  onAdd={() => openTransactionForm()}
                  onExport={() => void exportTransactions()}
                  onSelectTransaction={(t) => setSelectedTransaction(t)}
                />
              )}

              {moneyTab === 'Accounts' && (
                <AccountsView
                  accounts={accounts}
                  transactions={transactions}
                  onAdd={() => {
                    setMessage(null);
                    setModal('account');
                  }}
                  onArchive={async (id) => {
                    await archiveAccount(db, id);
                    await refresh();
                  }}
                  onStatement={(account) => {
                    setSelectedStatement(account);
                    setModal('statement');
                  }}
                />
              )}
            </ScrollView>
          </>
        ) : bottomTab === 'Debts' ? (
          <ScrollView
            contentContainerStyle={[styles.moduleContent, { paddingBottom: 110 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
          >
            <DebtsView
              debts={debts}
              onAdd={() => setModal('debt')}
              onPayment={(debt) => {
                setSelectedDebt(debt);
                setModal('payment');
              }}
            />
          </ScrollView>
        ) : bottomTab === 'Subscriptions' ? (
          <ScrollView
            contentContainerStyle={[styles.moduleContent, { paddingBottom: 110 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
          >
            <SubscriptionsView
              subscriptions={subscriptions}
              onAdd={() => setModal('subscription')}
              onToggle={(sub) =>
                void setSubscriptionActive(db, sub.id, !sub.active).then(refresh)
              }
            />
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.moduleContent, { paddingBottom: 110 + insets.bottom }]}
            showsVerticalScrollIndicator={false}
          >
            <SettingsView
              reviews={smsReviews}
              autoApprove={autoApproveSms}
              notificationAccess={notificationAccess}
              onOpenPrivacyPolicy={() => setModal('privacy')}
              onNavigate={(tab, moneySubTab) => {
                setBottomTab(tab);
                if (moneySubTab) setMoneyTab(moneySubTab);
              }}
              onOpenNotificationSettings={async () => {
                try {
                  await openNotificationAccessSettings();
                } catch (error) {
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : 'Notification support is unavailable in this build.'
                  );
                }
              }}
              onAutoApprove={async (enabled) => {
                await setAutoApproveSms(db, enabled);
                setAutoApproveSmsState(enabled);
              }}
              onBackup={exportBackup}
              onRestore={importBackup}
              onClearAllData={handleClearAllData}
              onConfirm={async (review) => {
                if (!review.accountId || !review.transactionType || !review.amount) {
                  return setMessage('Edit this review before confirming.');
                }
                await confirmSmsReview(db, review.id, {
                  accountId: review.accountId,
                  title: review.merchant || 'Bank SMS transaction',
                  category: 'General',
                  type: review.transactionType,
                  amount: review.amount,
                  date: review.transactionDate,
                  reportedBalance: review.reportedBalance,
                });
                try {
                  await Notifications.dismissAllNotificationsAsync();
                } catch {
                  // Ignored
                }
                await refresh();
              }}
              onReject={async (review) => {
                await rejectSmsReview(db, review.id);
                try {
                  await Notifications.dismissAllNotificationsAsync();
                } catch {
                  // Ignored
                }
                await refresh();
              }}
              onEdit={setSelectedReview}
            />
          </ScrollView>
        )}
      </View>

      {/* Floating Bottom Navigation Dock (Matching Reference Image 2: Dark dock with circular active button) */}
      <View style={[styles.bottomDockContainer, { paddingBottom: Math.max(16, insets.bottom + 6) }]}>
        <View style={styles.dockSurface}>
          {(
            [
              { key: 'Money', icon: 'wallet-outline', iconActive: 'wallet' },
              { key: 'Debts', icon: 'swap-horizontal-outline', iconActive: 'swap-horizontal' },
              { key: 'Subscriptions', icon: 'repeat-outline', iconActive: 'repeat' },
              { key: 'Settings', icon: 'settings-outline', iconActive: 'settings' },
            ] as const
          ).map((item) => {
            const isActive = bottomTab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setBottomTab(item.key)}
                style={[styles.dockIconCircle, isActive && styles.activeDockCircle]}
                accessibilityLabel={item.key}
              >
                <Ionicons
                  name={isActive ? item.iconActive : item.icon}
                  size={24}
                  color={isActive ? '#111827' : '#9CA3AF'}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Error or Notice Toast Banner */}
      {message && (
        <Pressable onPress={() => setMessage(null)} style={styles.toastBanner}>
          <Ionicons name="information-circle" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>{message}</Text>
          <Ionicons name="close" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />
        </Pressable>
      )}

      {/* Onboarding Privacy Policy Gate */}
      <Modal
        visible={privacyAccepted === false}
        transparent
        animationType="slide"
        onRequestClose={() => {
          // Mandatory confirmation on first launch
        }}
      >
        <PrivacyPolicyModal
          isOnboarding={true}
          onApprove={async () => {
            await setPrivacyAccepted(db, true);
            setPrivacyAcceptedState(true);
          }}
          onClose={() => {}}
        />
      </Modal>

      {/* Modals */}
      <Modal
        visible={
          modal !== null ||
          selectedReview !== null ||
          selectedStatement !== null ||
          showDetailedBreakdown ||
          selectedTransaction !== null
        }
        transparent
        animationType="slide"
        onRequestClose={() => {
          setModal(null);
          setSelectedReview(null);
          setSelectedStatement(null);
          setShowDetailedBreakdown(false);
          setSelectedTransaction(null);
        }}
      >
        {selectedTransaction ? (
          <TransactionDetailModal
            transaction={selectedTransaction}
            account={accountById.get(selectedTransaction.accountId)}
            onReverse={() => void handleReverseTransaction(selectedTransaction)}
            onClose={() => setSelectedTransaction(null)}
          />
        ) : showDetailedBreakdown ? (
          <DetailedBreakdownModal
            summary={summary}
            accountsCount={activeAccounts.length}
            transactions={transactions}
            onClose={() => setShowDetailedBreakdown(false)}
          />
        ) : modal === 'account' ? (
          <AccountModal
            form={accountForm}
            setForm={setAccountForm}
            onSave={() => void saveAccount()}
            onClose={() => setModal(null)}
          />
        ) : modal === 'transaction' ? (
          <TransactionModal
            form={transactionForm}
            setForm={setTransactionForm}
            accounts={activeAccounts}
            transactions={transactions}
            categories={categories}
            onAddCategory={handleAddCategory}
            onSave={() => void saveTransaction()}
            onClose={() => setModal(null)}
          />
        ) : modal === 'debt' ? (
          <DebtModal
            form={debtForm}
            setForm={setDebtForm}
            onSave={() => void saveDebt()}
            onClose={() => setModal(null)}
          />
        ) : modal === 'payment' ? (
          <PaymentModal
            debt={selectedDebt}
            amount={paymentAmount}
            setAmount={setPaymentAmount}
            onSave={() => void savePayment()}
            onClose={() => setModal(null)}
          />
        ) : modal === 'subscription' ? (
          <SubscriptionModal
            form={subscriptionForm}
            setForm={setSubscriptionForm}
            onSave={() => void saveSubscription()}
            onClose={() => setModal(null)}
          />
        ) : modal === 'statement' && selectedStatement ? (
          <StatementModal
            account={selectedStatement}
            transactions={transactions}
            onExport={() => void exportBankStatement(selectedStatement)}
            onClose={() => {
              setModal(null);
              setSelectedStatement(null);
            }}
          />
        ) : modal === 'privacy' ? (
          <PrivacyPolicyModal
            isOnboarding={false}
            onApprove={async () => {
              await setPrivacyAccepted(db, true);
              setPrivacyAcceptedState(true);
              setModal(null);
            }}
            onClose={() => setModal(null)}
          />
        ) : selectedReview ? (
          <SmsEditModal
            review={selectedReview}
            accounts={activeAccounts}
            categories={categories}
            onSave={async (input) => {
              await confirmSmsReview(db, selectedReview.id, input);
              setSelectedReview(null);
              try {
                await Notifications.dismissAllNotificationsAsync();
              } catch {
                // Ignored
              }
              await refresh();
            }}
            onReject={async () => {
              await rejectSmsReview(db, selectedReview.id);
              setSelectedReview(null);
              try {
                await Notifications.dismissAllNotificationsAsync();
              } catch {
                // Ignored
              }
              await refresh();
            }}
            onClose={() => setSelectedReview(null)}
          />
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

/* =========================================================================
   OVERVIEW SCREEN
   ========================================================================= */

function Overview({
  accounts,
  transactions,
  summary,
  accountById,
  range,
  setRange,
  hideBalance,
  onToggleHideBalance,
  onTransactions,
  onAccounts,
  onAddTransaction,
  onExportStatement,
  onViewDetailedBreakdown,
  onSelectTransaction,
  onAddAccount,
  onViewAccountStatement,
  pendingReviews,
  onReviewPending,
  onSimulateTest,
}: {
  accounts: Account[];
  transactions: Transaction[];
  summary: ReturnType<typeof calculateFinancialSummary>;
  accountById: Map<number, Account>;
  range: 'weekly' | 'monthly';
  setRange: (r: 'weekly' | 'monthly') => void;
  hideBalance: boolean;
  pendingReviews?: SmsReview[];
  onToggleHideBalance: () => void;
  onTransactions: () => void;
  onAccounts: () => void;
  onAddTransaction: () => void;
  onExportStatement: () => void;
  onViewDetailedBreakdown: () => void;
  onSelectTransaction: (t: Transaction) => void;
  onAddAccount: () => void;
  onViewAccountStatement: (account: Account) => void;
  onReviewPending?: (review: SmsReview) => void;
  onSimulateTest?: () => void;
}) {
  const today = new Date();

  // Weekly: 7 days
  const weeklyBars = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = toDateKey(date);
    const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' });
    const dayNumber = String(date.getDate());
    const amount = transactions
      .filter((item) => item.date === key && item.type === 'DEBIT')
      .reduce((sum, item) => sum + item.amount, 0);
    return { key, label: dayLabel, subLabel: dayNumber, amount };
  });

  // Monthly: 4 Weeks
  const monthlyBars = Array.from({ length: 4 }, (_, index) => {
    const endDaysAgo = (3 - index) * 7;
    const startDaysAgo = endDaysAgo + 6;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - startDaysAgo);
    const endDate = new Date(today);
    endDate.setDate(today.getDate() - endDaysAgo);

    const startKey = toDateKey(startDate);
    const endKey = toDateKey(endDate);

    const amount = transactions
      .filter((item) => item.date >= startKey && item.date <= endKey && item.type === 'DEBIT')
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      key: `week-${index + 1}`,
      label: `Wk ${index + 1}`,
      subLabel: `${startDate.getDate()}/${startDate.getMonth() + 1}`,
      amount,
    };
  });

  const activeBars = range === 'weekly' ? weeklyBars : monthlyBars;
  const maxBar = Math.max(...activeBars.map((b) => b.amount), 1);

  const currentMonthKey = toDateKey(today).slice(0, 7);
  const topCategories = useMemo(() => {
    const map = new Map<string, { category: string; amount: number; count: number }>();
    for (const tx of transactions) {
      if (tx.reversedTransactionId || tx.type !== 'DEBIT' || !tx.date.startsWith(currentMonthKey)) {
        continue;
      }
      const cat = tx.category.trim() || 'General';
      const existing = map.get(cat) || { category: cat, amount: 0, count: 0 };
      existing.amount += tx.amount;
      existing.count += 1;
      map.set(cat, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [transactions, currentMonthKey]);

  return (
    <View style={styles.overviewContainer}>
      {/* 1. HERO BALANCE CARD */}
      <LinearGradient
        colors={[theme.colors.heroLime, '#E3F55F']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <View style={styles.heroTopRow}>
          <View style={styles.currencyBadge}>
            <Text style={styles.currencyBadgeText}>INR · ₹</Text>
          </View>
          <View style={styles.heroSubRow}>
            <Text style={styles.heroRateText}>
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} active
            </Text>
            <Pressable onPress={onToggleHideBalance} style={styles.heroEyeButton}>
              <Ionicons
                name={hideBalance ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={theme.colors.heroText}
              />
            </Pressable>
          </View>
        </View>

        <View style={styles.heroBalanceBlock}>
          <Text style={styles.heroBalanceLabel}>TOTAL AVAILABLE BALANCE</Text>
          <Text style={styles.heroBalanceText}>
            {hideBalance ? '₹ • • • • • •' : formatCurrency(summary.totalBalance)}
          </Text>
        </View>

        <View style={styles.heroFooter}>
          <View style={styles.heroGrowthPill}>
            <Ionicons name="trending-up" size={14} color="#059669" />
            <Text style={styles.heroGrowthText}>
              {summary.monthlySavings >= 0 ? '+' : ''}
              {formatCurrency(summary.monthlySavings)} net this month
            </Text>
          </View>

          <View style={styles.cardLogoCluster}>
            <View style={[styles.cardCircle, { backgroundColor: '#F97316' }]} />
            <View style={[styles.cardCircle, { backgroundColor: '#EAB308', marginLeft: -8 }]} />
            {accounts[0]?.lastFour ? (
              <Text style={styles.cardDigitsText}>•••• {accounts[0].lastFour}</Text>
            ) : null}
          </View>
        </View>
      </LinearGradient>

      {/* 1b. PENDING PAYMENT DETECTION BANNER */}
      {pendingReviews && pendingReviews.length > 0 && onReviewPending && (
        <View style={styles.smsReviewBanner}>
          <View style={styles.smsReviewBannerIcon}>
            <Ionicons name="notifications" size={18} color="#B45309" />
          </View>
          <View style={{ flex: 1, marginHorizontal: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.smsReviewBannerTitle}>
                Mark Entry: {formatCurrency(pendingReviews[0].amount ?? 0)}
              </Text>
              <View style={styles.smsLiveDot} />
            </View>
            <Text style={styles.smsReviewBannerSubtitle} numberOfLines={1}>
              {pendingReviews[0].merchant || 'UPI Payment'} · {pendingReviews[0].detectedBank || 'Bank'}
            </Text>
          </View>
          <Pressable
            onPress={() => onReviewPending(pendingReviews[0])}
            style={styles.smsReviewBannerButton}
          >
            <Text style={styles.smsReviewBannerButtonText}>Review</Text>
            <Ionicons name="arrow-forward" size={13} color="#FFFFFF" style={{ marginLeft: 3 }} />
          </Pressable>
        </View>
      )}

      {/* 2. TWO PRIMARY ACTION BUTTONS (Requirement 2) */}
      <View style={styles.twoButtonRow}>
        <Pressable onPress={onAddTransaction} style={styles.primaryActionButton}>
          <Ionicons name="add-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.primaryActionButtonText}>New Transaction</Text>
        </Pressable>

        <Pressable onPress={onExportStatement} style={styles.secondaryActionButton}>
          <Ionicons name="document-text-outline" size={18} color={theme.colors.textPrimary} style={{ marginRight: 8 }} />
          <Text style={styles.secondaryActionButtonText}>Statement</Text>
        </Pressable>
      </View>

      {/* 3. TODAY'S SPENDING CARD (Requirement 3) */}
      <View style={styles.todaySpendingCard}>
        <View style={styles.todayCardTopRow}>
          <View style={styles.todayIconBadge}>
            <Ionicons name="arrow-down-circle" size={20} color={theme.colors.debitRed} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.todayCardTitle}>TODAY&apos;S SPENDING</Text>
            <Text style={styles.todayCardSubtitle}>Real-time ledger outflow</Text>
          </View>
          <View style={styles.liveIndicatorBadge}>
            <View style={styles.livePulseDot} />
            <Text style={styles.liveIndicatorText}>Live</Text>
          </View>
        </View>

        <View style={styles.todayAmountRow}>
          <Text style={styles.todayAmountValue}>
            {formatCurrency(summary.todaySpending)}
          </Text>
        </View>

        <Pressable onPress={onViewDetailedBreakdown} style={styles.viewDetailsButton}>
          <Text style={styles.viewDetailsButtonText}>View Detailed Breakdown</Text>
          <Ionicons name="arrow-forward" size={16} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      {/* 4. DAILY SPENDING ACTIVITY CHART (Requirement 4) */}
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.cardSectionTitle}>Spending Activity</Text>
            <Text style={styles.cardSectionHint}>
              {range === 'weekly' ? 'Past 7 days outflow' : 'Weekly aggregation this month'}
            </Text>
          </View>
          <View style={styles.rangeSelector}>
            {(['weekly', 'monthly'] as const).map((item) => (
              <Pressable
                key={item}
                onPress={() => setRange(item)}
                style={[styles.rangePill, range === item && styles.activeRangePill]}
              >
                <Text style={[styles.rangePillText, range === item && styles.activeRangePillText]}>
                  {item === 'weekly' ? 'Weekly' : 'Monthly'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.barsContainer}>
          {activeBars.map((bar) => {
            const heightPercent = Math.max(8, Math.round((bar.amount / maxBar) * 90));
            return (
              <View key={bar.key} style={styles.barItem}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: heightPercent },
                      bar.amount > 0 && styles.barFillActive,
                    ]}
                  />
                </View>
                <Text style={styles.barDateText}>{bar.subLabel}</Text>
                <Text style={styles.barDayText}>{bar.label}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* 4b. TOP CATEGORIES THIS MONTH */}
      {topCategories.length > 0 && (
        <View style={styles.overviewCategoryCard}>
          <View style={styles.overviewCategoryHeader}>
            <View>
              <Text style={styles.cardSectionTitle}>Category Breakdown</Text>
              <Text style={styles.cardSectionHint}>This month&apos;s spending distribution</Text>
            </View>
            <Pressable onPress={onViewDetailedBreakdown} style={styles.overviewCategoryLink}>
              <Text style={styles.overviewCategoryLinkText}>View All</Text>
              <Ionicons name="chevron-forward" size={14} color={theme.colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.overviewCategoryList}>
            {topCategories.slice(0, 3).map((item) => {
              const meta = getCategoryMeta(item.category, 'DEBIT');
              const percent = summary.monthlySpending > 0 ? (item.amount / summary.monthlySpending) * 100 : 0;
              return (
                <View key={item.category} style={styles.overviewCategoryItem}>
                  <View style={[styles.overviewCategoryIcon, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.overviewCategoryRow}>
                      <Text style={styles.overviewCategoryName}>{item.category}</Text>
                      <Text style={styles.overviewCategoryAmount}>{formatCurrency(item.amount)}</Text>
                    </View>
                    <View style={styles.categoryProgressBarTrack}>
                      <View
                        style={[
                          styles.categoryProgressBarFill,
                          {
                            width: `${Math.min(100, Math.max(5, percent))}%`,
                            backgroundColor: meta.color,
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 5. BANK ACCOUNTS ROW */}
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionHeading}>Bank Accounts</Text>
          <Text style={styles.sectionSubheading}>{accounts.length} active ledgers</Text>
        </View>
        <Pressable onPress={onAccounts} style={styles.sectionLinkButton}>
          <Text style={styles.sectionLinkText}>See All</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalCardScroll}>
        {accounts.map((account) => {
          const balInfo = getAccountBalanceInfo(account, transactions);
          return (
            <Pressable
              key={account.id}
              onPress={() => onViewAccountStatement(account)}
              style={[styles.bankMiniCard, balInfo.isInsufficient && styles.bankMiniCardWarning]}
            >
              <View style={styles.bankMiniTop}>
                <View
                  style={[
                    styles.bankMiniIconCircle,
                    balInfo.isInsufficient && { backgroundColor: '#FEE2E2' },
                  ]}
                >
                  <Ionicons
                    name={balInfo.isInsufficient ? 'alert-circle' : 'business'}
                    size={16}
                    color={balInfo.isInsufficient ? theme.colors.debitRed : theme.colors.creditGreen}
                  />
                </View>
                {account.lastFour && (
                  <Text style={styles.bankLastFour}>•••• {account.lastFour}</Text>
                )}
              </View>
              <Text style={styles.bankMiniName} numberOfLines={1}>
                {account.bankName}
              </Text>
              <Text style={styles.bankMiniType}>{account.type}</Text>
              <Text
                style={[
                  styles.bankMiniBalance,
                  balInfo.isInsufficient && { color: theme.colors.debitRed },
                ]}
              >
                {formatCurrency(balInfo.displayBalance)}
              </Text>
              {balInfo.isInsufficient && (
                <View style={styles.insufficientPill}>
                  <Ionicons name="warning" size={9} color="#DC2626" style={{ marginRight: 2 }} />
                  <Text style={styles.insufficientPillText}>Insufficient</Text>
                </View>
              )}
            </Pressable>
          );
        })}

        <Pressable onPress={onAddAccount} style={styles.addBankPillCard}>
          <View style={styles.addBankIconCircle}>
            <Ionicons name="add" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.addBankTitle}>Add Bank</Text>
          <Text style={styles.addBankSubtitle}>New Account</Text>
        </Pressable>
      </ScrollView>

      {/* 6. RECENT TRANSACTIONS */}
      <View style={[styles.sectionHeaderRow, { marginTop: 14 }]}>
        <View>
          <Text style={styles.sectionHeading}>Recent Transactions</Text>
          <Text style={styles.sectionSubheading}>Latest activity</Text>
        </View>
        <Pressable onPress={onTransactions} style={styles.sectionLinkButton}>
          <Text style={styles.sectionLinkText}>See All</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.colors.textPrimary} />
        </Pressable>
      </View>

      {transactions.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="No transactions yet"
          text="Tap New Transaction to record your first income or expense."
        />
      ) : (
        <View style={styles.transactionsList}>
          {transactions.slice(0, 5).map((t) => (
            <Pressable key={t.id} onPress={() => onSelectTransaction(t)}>
              <TransactionCard
                transaction={t}
                account={accountById.get(t.accountId)}
              />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/* =========================================================================
   DETAILED BREAKDOWN MODAL
   ========================================================================= */

function DetailedBreakdownModal({
  summary,
  accountsCount,
  transactions,
  onClose,
}: {
  summary: ReturnType<typeof calculateFinancialSummary>;
  accountsCount: number;
  transactions: Transaction[];
  onClose: () => void;
}) {
  const currentMonthKey = toDateKey(new Date()).slice(0, 7);
  const categorySpendingList = useMemo(() => {
    const map = new Map<string, { category: string; amount: number; count: number }>();
    for (const tx of transactions) {
      if (tx.reversedTransactionId || tx.type !== 'DEBIT' || !tx.date.startsWith(currentMonthKey)) {
        continue;
      }
      const cat = tx.category.trim() || 'General';
      const existing = map.get(cat) || { category: cat, amount: 0, count: 0 };
      existing.amount += tx.amount;
      existing.count += 1;
      map.set(cat, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [transactions, currentMonthKey]);

  return (
    <ModalWrapper title="Financial Breakdown" onClose={onClose}>
      <View style={styles.metricGrid}>
        <MetricCard
          label="Today's Spent"
          value={formatCurrency(summary.todaySpending)}
          icon="arrow-down-circle"
          color={theme.colors.debitRed}
          bg={theme.colors.debitRedLight}
        />
        <MetricCard
          label="Monthly Spent"
          value={formatCurrency(summary.monthlySpending)}
          icon="cart"
          color={theme.colors.debitRed}
          bg={theme.colors.debitRedLight}
        />
        <MetricCard
          label="Monthly Income"
          value={formatCurrency(summary.monthlyIncome)}
          icon="arrow-up-circle"
          color={theme.colors.creditGreen}
          bg={theme.colors.creditGreenLight}
        />
        <MetricCard
          label="Remaining Balance"
          value={formatCurrency(summary.totalBalance)}
          icon="wallet"
          color={theme.colors.creditGreen}
          bg={theme.colors.creditGreenLight}
        />
      </View>

      <View style={styles.breakdownDetailsList}>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Total Bank Balance</Text>
          <Text style={styles.breakdownDetailValue}>{formatCurrency(summary.totalBalance)}</Text>
        </View>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Active Bank Accounts</Text>
          <Text style={styles.breakdownDetailValue}>{accountsCount} active ledgers</Text>
        </View>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Monthly Inflow / Outflow Net</Text>
          <Text
            style={[
              styles.breakdownDetailValue,
              { color: summary.monthlySavings >= 0 ? theme.colors.creditGreen : theme.colors.debitRed },
            ]}
          >
            {summary.monthlySavings >= 0 ? '+' : ''}
            {formatCurrency(summary.monthlySavings)}
          </Text>
        </View>
      </View>

      {/* Category-wise Spending Analysis for this Month */}
      <View style={styles.categoryAnalysisSection}>
        <View style={styles.categoryAnalysisHeader}>
          <View>
            <Text style={styles.categoryAnalysisTitle}>Monthly Spending by Category</Text>
            <Text style={styles.categoryAnalysisSubtitle}>
              {categorySpendingList.length} {categorySpendingList.length === 1 ? 'category' : 'categories'} active this month
            </Text>
          </View>
          <View style={styles.categoryTotalBadge}>
            <Text style={styles.categoryTotalBadgeText}>
              {formatCurrency(summary.monthlySpending)}
            </Text>
          </View>
        </View>

        {categorySpendingList.length === 0 ? (
          <View style={styles.categoryEmptyBox}>
            <Ionicons name="pie-chart-outline" size={28} color={theme.colors.textMuted} />
            <Text style={styles.categoryEmptyText}>No expenses recorded for this month</Text>
          </View>
        ) : (
          categorySpendingList.map((item) => {
            const meta = getCategoryMeta(item.category, 'DEBIT');
            const percent = summary.monthlySpending > 0 ? (item.amount / summary.monthlySpending) * 100 : 0;
            return (
              <View key={item.category} style={styles.categorySpendRow}>
                <View style={[styles.categorySpendIcon, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <View style={styles.categorySpendInfo}>
                  <View style={styles.categorySpendTopLine}>
                    <Text style={styles.categorySpendName} numberOfLines={1}>{item.category}</Text>
                    <Text style={styles.categorySpendAmount}>{formatCurrency(item.amount)}</Text>
                  </View>
                  <View style={styles.categorySpendMetaLine}>
                    <Text style={styles.categorySpendCount}>{item.count} {item.count === 1 ? 'transaction' : 'transactions'}</Text>
                    <Text style={styles.categorySpendPercent}>{percent.toFixed(1)}%</Text>
                  </View>
                  <View style={styles.categoryProgressBarTrack}>
                    <View
                      style={[
                        styles.categoryProgressBarFill,
                        {
                          width: `${Math.min(100, Math.max(4, percent))}%`,
                          backgroundColor: meta.color,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ModalWrapper>
  );
}

/* =========================================================================
   TRANSACTION DETAIL MODAL
   ========================================================================= */

function TransactionDetailModal({
  transaction,
  account,
  onReverse,
  onClose,
}: {
  transaction: Transaction;
  account?: Account;
  onReverse: () => void;
  onClose: () => void;
}) {
  const isCredit = transaction.type === 'CREDIT';
  const meta = getCategoryMeta(transaction.category, transaction.type);

  return (
    <ModalWrapper title="Transaction Details" onClose={onClose}>
      <View style={styles.txDetailTop}>
        <View style={[styles.txDetailIconCircle, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon} size={28} color={meta.color} />
        </View>
        <Text style={styles.txDetailTitle}>{transaction.title}</Text>
        <Text
          style={[
            styles.txDetailAmount,
            { color: isCredit ? theme.colors.creditGreen : theme.colors.debitRed },
          ]}
        >
          {isCredit ? '+' : '-'}
          {formatCurrency(transaction.amount)}
        </Text>
        <View
          style={[
            styles.txDetailTypeBadge,
            { backgroundColor: isCredit ? theme.colors.creditGreenLight : theme.colors.debitRedLight },
          ]}
        >
          <Text
            style={[
              styles.txDetailTypeBadgeText,
              { color: isCredit ? theme.colors.creditGreen : theme.colors.debitRed },
            ]}
          >
            {isCredit ? 'CREDIT / INFLOW' : 'DEBIT / OUTFLOW'}
          </Text>
        </View>
      </View>

      <View style={styles.breakdownDetailsList}>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Bank Account</Text>
          <Text style={styles.breakdownDetailValue}>
            {account?.bankName ?? 'Unknown Bank'} {account?.lastFour ? `(•••• ${account.lastFour})` : ''}
          </Text>
        </View>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Category</Text>
          <Text style={styles.breakdownDetailValue}>{transaction.category}</Text>
        </View>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Date</Text>
          <Text style={styles.breakdownDetailValue}>{transaction.date}</Text>
        </View>
        <View style={styles.breakdownDetailRow}>
          <Text style={styles.breakdownDetailLabel}>Record Source</Text>
          <Text style={styles.breakdownDetailValue}>{transaction.source}</Text>
        </View>
        {transaction.notes ? (
          <View style={styles.breakdownDetailRow}>
            <Text style={styles.breakdownDetailLabel}>Notes</Text>
            <Text style={styles.breakdownDetailValue}>{transaction.notes}</Text>
          </View>
        ) : null}
        {transaction.reversedTransactionId ? (
          <View style={styles.breakdownDetailRow}>
            <Text style={styles.breakdownDetailLabel}>Status</Text>
            <Text style={[styles.breakdownDetailValue, { color: theme.colors.warningOrange }]}>
              Reversed
            </Text>
          </View>
        ) : null}
      </View>

      {!transaction.reversedTransactionId && (
        <Pressable onPress={onReverse} style={styles.reverseTxButton}>
          <Ionicons name="arrow-undo-outline" size={16} color={theme.colors.debitRed} style={{ marginRight: 6 }} />
          <Text style={styles.reverseTxButtonText}>Reverse This Transaction</Text>
        </Pressable>
      )}
    </ModalWrapper>
  );
}

/* =========================================================================
   TRANSACTIONS VIEW
   ========================================================================= */

function TransactionsView({
  transactions,
  accountById,
  accounts,
  selectedAccountId,
  setSelectedAccountId,
  search,
  setSearch,
  onAdd,
  onExport,
  onSelectTransaction,
}: {
  transactions: Transaction[];
  accountById: Map<number, Account>;
  accounts: Account[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  search: string;
  setSearch: (s: string) => void;
  onAdd: () => void;
  onExport: () => void;
  onSelectTransaction: (t: Transaction) => void;
}) {
  const todayKey = toDateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);

  const grouped = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    const groups: { [key: string]: Transaction[] } = {};
    for (const item of sorted) {
      if (!groups[item.date]) groups[item.date] = [];
      groups[item.date].push(item);
    }
    return Object.entries(groups).map(([date, items]) => {
      let label = date;
      if (date === todayKey) label = 'Today';
      else if (date === yesterdayKey) label = 'Yesterday';
      else {
        const parts = date.split('-');
        if (parts.length === 3) {
          const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
          label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
        }
      }
      return { date, label, items };
    });
  }, [transactions, todayKey, yesterdayKey]);

  return (
    <View style={styles.transactionsView}>
      <View style={styles.transactionsHeaderRow}>
        <View>
          <Text style={styles.screenTitle}>Transactions</Text>
          <Text style={styles.screenSubtitle}>
            {transactions.length} recorded {transactions.length === 1 ? 'entry' : 'entries'}
          </Text>
        </View>

        <View style={styles.headerButtonGroup}>
          <Pressable onPress={onExport} style={styles.secondaryHeaderButton}>
            <Ionicons name="document-text-outline" size={16} color={theme.colors.textPrimary} />
            <Text style={styles.secondaryHeaderButtonText}>PDF</Text>
          </Pressable>

          <Pressable onPress={onAdd} style={styles.primaryHeaderButton}>
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.primaryHeaderButtonText}>Add</Text>
          </Pressable>
        </View>
      </View>

      {/* Account Filter Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.accountFilterScroll}
        contentContainerStyle={{ paddingHorizontal: 2 }}
      >
        <Pressable
          onPress={() => setSelectedAccountId('ALL')}
          style={[
            styles.accountFilterPill,
            selectedAccountId === 'ALL' && styles.activeAccountFilterPill,
          ]}
        >
          <Ionicons
            name="card"
            size={14}
            color={selectedAccountId === 'ALL' ? '#FFFFFF' : theme.colors.textPrimary}
          />
          <Text
            style={[
              styles.accountFilterPillText,
              selectedAccountId === 'ALL' && styles.activeAccountFilterPillText,
            ]}
          >
            All Accounts
          </Text>
        </Pressable>

        {accounts.map((acc) => {
          const isSelected = selectedAccountId === String(acc.id);
          return (
            <Pressable
              key={acc.id}
              onPress={() => setSelectedAccountId(String(acc.id))}
              style={[
                styles.accountFilterPill,
                isSelected && styles.activeAccountFilterPill,
              ]}
            >
              <View style={[styles.tinyDot, { backgroundColor: isSelected ? '#FACC15' : '#D97706' }]} />
              <Text
                style={[
                  styles.accountFilterPillText,
                  isSelected && styles.activeAccountFilterPillText,
                ]}
              >
                {acc.bankName} {acc.lastFour ? `•••• ${acc.lastFour}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color={theme.colors.textMuted} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by merchant, bank or category"
          placeholderTextColor={theme.colors.textMuted}
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Grouped Transaction List */}
      {grouped.length === 0 ? (
        <EmptyState
          icon="search-outline"
          title="No transactions found"
          text="Try changing your search terms or account filter."
        />
      ) : (
        grouped.map((group) => (
          <View key={group.date} style={styles.dateGroupContainer}>
            <Text style={styles.dateGroupHeader}>{group.label}</Text>
            <View style={styles.groupCardCluster}>
              {group.items.map((t) => (
                <Pressable key={t.id} onPress={() => onSelectTransaction(t)}>
                  <TransactionCard
                    transaction={t}
                    account={accountById.get(t.accountId)}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/* =========================================================================
   TRANSACTION CARD COMPONENT
   ========================================================================= */

function TransactionCard({
  transaction,
  account,
}: {
  transaction: Transaction;
  account?: Account;
}) {
  const isCredit = transaction.type === 'CREDIT';
  const meta = getCategoryMeta(transaction.category, transaction.type);

  return (
    <View style={styles.transactionCard}>
      <View style={[styles.transactionAvatarCircle, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={20} color={meta.color} />
      </View>

      <View style={styles.transactionMiddle}>
        <Text style={styles.transactionTitle} numberOfLines={1}>
          {transaction.title}
        </Text>
        <View style={styles.transactionSubtitleRow}>
          <Text style={styles.transactionSubtitle} numberOfLines={1}>
            {account?.bankName ?? 'Unknown Bank'} · {transaction.category}
          </Text>
          <View style={styles.timeTag}>
            <Ionicons name="time-outline" size={11} color={theme.colors.textMuted} />
            <Text style={styles.timeTagText}>
              {isCredit ? 'Received' : 'Paid'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.transactionRight}>
        <Text
          style={[
            styles.transactionAmountText,
            { color: isCredit ? theme.colors.creditGreen : theme.colors.debitRed },
          ]}
        >
          {isCredit ? '+' : '-'}
          {formatCurrency(transaction.amount)}
        </Text>
      </View>
    </View>
  );
}

/* =========================================================================
   ACCOUNTS VIEW (Digital Wallet Cards)
   ========================================================================= */

function AccountsView({
  accounts,
  transactions,
  onAdd,
  onArchive,
  onStatement,
}: {
  accounts: Account[];
  transactions: Transaction[];
  onAdd: () => void;
  onArchive: (id: number) => void;
  onStatement: (account: Account) => void;
}) {
  const activeCount = accounts.filter((a) => !a.archived).length;

  return (
    <View style={styles.accountsView}>
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.screenTitle}>Bank Accounts</Text>
          <Text style={styles.screenSubtitle}>
            {activeCount} active · {accounts.length - activeCount} archived
          </Text>
        </View>

        <Pressable onPress={onAdd} style={styles.primaryHeaderButton}>
          <Ionicons name="add" size={18} color="#FFFFFF" />
          <Text style={styles.primaryHeaderButtonText}>Add Account</Text>
        </Pressable>
      </View>

      {accounts.map((account) => {
        const accountTransactions = transactions.filter((t) => t.accountId === account.id);
        const credits = accountTransactions
          .filter((t) => t.type === 'CREDIT')
          .reduce((sum, t) => sum + t.amount, 0);
        const debits = accountTransactions
          .filter((t) => t.type === 'DEBIT')
          .reduce((sum, t) => sum + t.amount, 0);
        const balInfo = getAccountBalanceInfo(account, transactions);

        return (
          <View
            key={account.id}
            style={[styles.accountFullCard, account.archived && styles.archivedCard]}
          >
            {/* Digital Card View */}
            <LinearGradient
              colors={['#1E2028', '#111216']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.accountCardSurface}
            >
              <View style={styles.accountCardTopBar}>
                <View style={styles.cardChipIcon}>
                  <Ionicons name="hardware-chip-outline" size={24} color="#D1D5DB" />
                </View>
                <View style={styles.cardLogoCluster}>
                  <View style={[styles.cardCircle, { backgroundColor: '#F97316' }]} />
                  <View style={[styles.cardCircle, { backgroundColor: '#EAB308', marginLeft: -8 }]} />
                </View>
              </View>

              <View style={styles.accountCardNumberRow}>
                <Text style={styles.accountCardMaskedNumber}>
                  ••••  ••••  ••••  {account.lastFour || '••••'}
                </Text>
              </View>

              <View style={styles.accountCardBottomBar}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardHolderLabel}>BANK & NICKNAME</Text>
                  <Text style={styles.cardBankTitle} numberOfLines={1}>
                    {account.bankName} {account.nickname ? `(${account.nickname})` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                  <Text style={styles.cardBalanceLabel}>AVAILABLE BALANCE</Text>
                  <Text
                    style={[
                      styles.cardBalanceValue,
                      balInfo.isInsufficient && { color: '#F87171' },
                    ]}
                  >
                    {formatCurrency(balInfo.displayBalance)}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            {balInfo.isInsufficient && (
              <View style={styles.insufficientWarningBanner}>
                <Ionicons name="warning" size={16} color="#DC2626" style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.insufficientWarningBannerTitle}>
                    ⚠️ Insufficient Account Balance
                  </Text>
                  <Text style={styles.insufficientWarningBannerSub}>
                    Available balance has reached ₹0.00. Please deposit funds or credit this account.
                  </Text>
                </View>
              </View>
            )}

            {/* Inflow / Outflow Stats */}
            <View style={styles.accountStatsRow}>
              <View style={styles.statPill}>
                <Ionicons name="arrow-down-circle" size={14} color={theme.colors.creditGreen} />
                <Text style={styles.statLabel}>Inflow: {formatCurrency(credits)}</Text>
              </View>
              <View style={styles.statPill}>
                <Ionicons name="arrow-up-circle" size={14} color={theme.colors.debitRed} />
                <Text style={styles.statLabel}>Outflow: {formatCurrency(debits)}</Text>
              </View>
            </View>

            {/* Actions */}
            <View style={styles.accountCardActions}>
              <Pressable
                onPress={() => onStatement(account)}
                style={styles.accountStatementButton}
              >
                <Ionicons name="document-text-outline" size={16} color={theme.colors.textPrimary} />
                <Text style={styles.accountStatementButtonText}>View Statement</Text>
              </Pressable>

              {!account.archived && (
                <Pressable
                  onPress={() => onArchive(account.id)}
                  style={styles.archiveAccountButton}
                >
                  <Text style={styles.archiveAccountText}>Archive</Text>
                </Pressable>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* =========================================================================
   DEBTS VIEW (With Status Filter Pills)
   ========================================================================= */

function DebtsView({
  debts,
  onAdd,
  onPayment,
}: {
  debts: Debt[];
  onAdd: () => void;
  onPayment: (d: Debt) => void;
}) {
  const [debtFilter, setDebtFilter] = useState<'ALL' | 'OPEN' | 'SETTLED'>('ALL');

  const lent = debts
    .filter((d) => d.direction === 'LENT' && d.status === 'OPEN')
    .reduce((sum, d) => sum + d.originalAmount - d.settledAmount, 0);
  const borrowed = debts
    .filter((d) => d.direction === 'BORROWED' && d.status === 'OPEN')
    .reduce((sum, d) => sum + d.originalAmount - d.settledAmount, 0);

  const filteredDebts = debts.filter((d) => {
    if (debtFilter === 'OPEN') return d.status === 'OPEN';
    if (debtFilter === 'SETTLED') return d.status === 'SETTLED';
    return true;
  });

  return (
    <View style={styles.moduleContainer}>
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.screenTitle}>Debts & Loans</Text>
          <Text style={styles.screenSubtitle}>Private ledger stored on device</Text>
        </View>

        <Pressable onPress={onAdd} style={styles.primaryHeaderButton}>
          <Ionicons name="add" size={18} color="#FFFFFF" />
          <Text style={styles.primaryHeaderButtonText}>Add</Text>
        </Pressable>
      </View>

      <View style={styles.metricGrid}>
        <View style={[styles.debtSummaryCard, { borderColor: '#A7F3D0' }]}>
          <View style={styles.debtSummaryIconRow}>
            <View style={[styles.debtSummaryIcon, { backgroundColor: '#D1FAE5' }]}>
              <Ionicons name="arrow-down-circle" size={18} color={theme.colors.creditGreen} />
            </View>
            <Text style={styles.debtSummaryLabel}>You are owed</Text>
          </View>
          <Text style={[styles.debtSummaryValue, { color: theme.colors.creditGreen }]}>
            {formatCurrency(lent)}
          </Text>
        </View>

        <View style={[styles.debtSummaryCard, { borderColor: '#FECDD3' }]}>
          <View style={styles.debtSummaryIconRow}>
            <View style={[styles.debtSummaryIcon, { backgroundColor: '#FFE4E6' }]}>
              <Ionicons name="arrow-up-circle" size={18} color={theme.colors.debitRed} />
            </View>
            <Text style={styles.debtSummaryLabel}>You owe</Text>
          </View>
          <Text style={[styles.debtSummaryValue, { color: theme.colors.debitRed }]}>
            {formatCurrency(borrowed)}
          </Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.subFilterRow}>
        {(['ALL', 'OPEN', 'SETTLED'] as const).map((filter) => {
          const isSel = debtFilter === filter;
          return (
            <Pressable
              key={filter}
              onPress={() => setDebtFilter(filter)}
              style={[styles.subFilterPill, isSel && styles.subFilterPillActive]}
            >
              <Text style={[styles.subFilterText, isSel && styles.subFilterTextActive]}>
                {filter === 'ALL' ? 'All Records' : filter === 'OPEN' ? 'Pending' : 'Settled'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {filteredDebts.length === 0 ? (
        <EmptyState
          icon="swap-horizontal-outline"
          title="No debts found"
          text="Track money you lend to friends or borrow with clear settlement records."
        />
      ) : (
        filteredDebts.map((debt) => {
          const outstanding = debt.originalAmount - debt.settledAmount;
          const isLent = debt.direction === 'LENT';

          return (
            <View key={debt.id} style={styles.debtCard}>
              <View style={styles.debtCardHeader}>
                <View style={styles.debtAvatar}>
                  <Text style={styles.debtAvatarText}>
                    {debt.personName.slice(0, 2).toUpperCase()}
                  </Text>
                </View>

                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.debtPersonName}>{debt.personName}</Text>
                  <Text style={styles.debtDirectionText}>
                    {isLent ? 'Lent to contact' : 'Borrowed from contact'}
                    {debt.dueDate ? ` · Due ${debt.dueDate}` : ''}
                  </Text>
                </View>

                <View
                  style={[
                    styles.statusBadge,
                    debt.status === 'SETTLED'
                      ? styles.statusBadgeSettled
                      : styles.statusBadgeOpen,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      debt.status === 'SETTLED'
                        ? styles.statusBadgeTextSettled
                        : styles.statusBadgeTextOpen,
                    ]}
                  >
                    {debt.status}
                  </Text>
                </View>
              </View>

              <View style={styles.debtAmountRow}>
                <Text style={styles.debtAmountLabel}>Outstanding Balance</Text>
                <Text
                  style={[
                    styles.debtAmountValue,
                    { color: isLent ? theme.colors.creditGreen : theme.colors.debitRed },
                  ]}
                >
                  {formatCurrency(outstanding)}
                </Text>
              </View>

              {debt.status === 'OPEN' && (
                <Pressable
                  onPress={() => onPayment(debt)}
                  style={styles.recordPaymentButton}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.recordPaymentButtonText}>Record Payment</Text>
                </Pressable>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

/* =========================================================================
   SUBSCRIPTIONS VIEW (With Status Filter Pills)
   ========================================================================= */

function SubscriptionsView({
  subscriptions,
  onAdd,
  onToggle,
}: {
  subscriptions: Subscription[];
  onAdd: () => void;
  onToggle: (s: Subscription) => void;
}) {
  const [subFilter, setSubFilter] = useState<'ALL' | 'ACTIVE' | 'PAUSED'>('ALL');

  const monthlyEstimate = subscriptions
    .filter((s) => s.active)
    .reduce((sum, s) => {
      const multiplier =
        s.billingCycle === 'WEEKLY'
          ? 4
          : s.billingCycle === 'MONTHLY'
          ? 1
          : s.billingCycle === 'QUARTERLY'
          ? 1 / 3
          : 1 / 12;
      return sum + s.amount * multiplier;
    }, 0);

  const filteredSubs = subscriptions.filter((s) => {
    if (subFilter === 'ACTIVE') return s.active;
    if (subFilter === 'PAUSED') return !s.active;
    return true;
  });

  return (
    <View style={styles.moduleContainer}>
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.screenTitle}>Subscriptions</Text>
          <Text style={styles.screenSubtitle}>Recurring bills and memberships</Text>
        </View>

        <Pressable onPress={onAdd} style={styles.primaryHeaderButton}>
          <Ionicons name="add" size={18} color="#FFFFFF" />
          <Text style={styles.primaryHeaderButtonText}>Add</Text>
        </Pressable>
      </View>

      <View style={styles.subscriptionProjectionCard}>
        <View style={styles.subProjectionIcon}>
          <Ionicons name="calendar-outline" size={24} color="#6366F1" />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.subProjectionLabel}>Estimated Monthly Commitment</Text>
          <Text style={styles.subProjectionValue}>
            {formatCurrency(Math.round(monthlyEstimate))}
          </Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.subFilterRow}>
        {(['ALL', 'ACTIVE', 'PAUSED'] as const).map((filter) => {
          const isSel = subFilter === filter;
          return (
            <Pressable
              key={filter}
              onPress={() => setSubFilter(filter)}
              style={[styles.subFilterPill, isSel && styles.subFilterPillActive]}
            >
              <Text style={[styles.subFilterText, isSel && styles.subFilterTextActive]}>
                {filter === 'ALL' ? 'All Subs' : filter === 'ACTIVE' ? 'Active' : 'Paused'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {filteredSubs.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No subscriptions found"
          text="Add your Netflix, Spotify, gym or cloud services to track recurring renewals."
        />
      ) : (
        filteredSubs.map((sub) => {
          const meta = getCategoryMeta(sub.category);
          return (
            <View
              key={sub.id}
              style={[styles.subscriptionCard, !sub.active && styles.archivedCard]}
            >
              <View style={styles.subTopRow}>
                <View style={[styles.subAvatar, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} />
                </View>

                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.subName}>{sub.name}</Text>
                  <Text style={styles.subDetails}>
                    {sub.provider || sub.category} · {sub.billingCycle.toLowerCase()}
                  </Text>
                </View>

                <View style={styles.subAmountWrap}>
                  <Text style={styles.subAmount}>{formatCurrency(sub.amount)}</Text>
                </View>
              </View>

              <View style={styles.subFooterRow}>
                <View style={styles.subRenewalWrap}>
                  <Ionicons name="alarm-outline" size={13} color={theme.colors.textMuted} />
                  <Text style={styles.subRenewalText}>Renews {sub.nextBillingDate}</Text>
                </View>

                <Pressable
                  onPress={() => onToggle(sub)}
                  style={[
                    styles.subTogglePill,
                    sub.active ? styles.subTogglePillActive : styles.subTogglePillPaused,
                  ]}
                >
                  <Text
                    style={[
                      styles.subToggleText,
                      sub.active ? styles.subToggleTextActive : styles.subToggleTextPaused,
                    ]}
                  >
                    {sub.active ? 'Active' : 'Paused'}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

/* =========================================================================
   SETTINGS & SMS REVIEWS VIEW (With Clear All Data Action)
   ========================================================================= */

function SettingsView({
  reviews,
  autoApprove,
  notificationAccess,
  onNavigate,
  onOpenPrivacyPolicy,
  onOpenNotificationSettings,
  onAutoApprove,
  onBackup,
  onRestore,
  onClearAllData,
  onConfirm,
  onReject,
  onEdit,
}: {
  reviews: SmsReview[];
  autoApprove: boolean;
  notificationAccess: boolean;
  onNavigate: (tab: BottomTab, moneySubTab?: MoneyTab) => void;
  onOpenPrivacyPolicy: () => void;
  onOpenNotificationSettings: () => void;
  onAutoApprove: (v: boolean) => Promise<void>;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
  onClearAllData: () => void;
  onConfirm: (r: SmsReview) => Promise<void>;
  onReject: (r: SmsReview) => Promise<void>;
  onEdit: (r: SmsReview) => void;
}) {
  return (
    <View style={styles.moduleContainer}>
      <Text style={styles.screenTitle}>Settings</Text>
      <Text style={styles.screenSubtitle}>Preferences & local-first data controls</Text>

      {/* 1. Quick Navigation Hub */}
      <View style={[styles.sectionHeaderRow, { marginTop: 14 }]}>
        <Text style={styles.sectionHeading}>Quick Navigation</Text>
      </View>

      <View style={styles.navHubCard}>
        {[
          {
            key: 'Overview',
            label: 'Overview & Analytics',
            sub: 'Available balances, spending stats & cards',
            icon: 'pie-chart-outline',
            color: '#059669',
            bg: '#ECFDF5',
            onPress: () => onNavigate('Money', 'Overview'),
          },
          {
            key: 'Transactions',
            label: 'All Transactions',
            sub: 'Search ledger history & statement download',
            icon: 'receipt-outline',
            color: '#2563EB',
            bg: '#EFF6FF',
            onPress: () => onNavigate('Money', 'Transactions'),
          },
          {
            key: 'Accounts',
            label: 'Bank Accounts & Cards',
            sub: 'Manage bank ledgers & account details',
            icon: 'card-outline',
            color: '#D97706',
            bg: '#FEF3C7',
            onPress: () => onNavigate('Money', 'Accounts'),
          },
          {
            key: 'Debts',
            label: 'Debts & Loans',
            sub: 'Track money lent and borrowed with due dates',
            icon: 'swap-horizontal-outline',
            color: '#7C3AED',
            bg: '#FAF5FF',
            onPress: () => onNavigate('Debts'),
          },
          {
            key: 'Subscriptions',
            label: 'Recurring Subscriptions',
            sub: 'Track active memberships & monthly bills',
            icon: 'repeat-outline',
            color: '#E11D48',
            bg: '#FFF1F2',
            onPress: () => onNavigate('Subscriptions'),
          },
        ].map((item, idx) => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            style={[styles.navHubRow, idx > 0 && styles.navHubRowBorder]}
          >
            <View style={[styles.navHubIconCircle, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={item.color} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.navHubTitle}>{item.label}</Text>
              <Text style={styles.navHubSub}>{item.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </Pressable>
        ))}
      </View>

      {/* 2. Notification Access & Automated Detection */}
      <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
        <Text style={styles.sectionHeading}>SMS & Notification Engine</Text>
      </View>

      <View style={styles.settingsGroupCard}>
        <View style={styles.settingsHeaderRow}>
          <View style={[styles.settingsIconWrap, { backgroundColor: notificationAccess ? '#ECFDF5' : '#FEF3C7' }]}>
            <Ionicons
              name={notificationAccess ? 'notifications' : 'notifications-outline'}
              size={20}
              color={notificationAccess ? '#059669' : '#D97706'}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.settingsItemTitle}>Notification Listener</Text>
              <View style={[styles.settingStatusBadge, { backgroundColor: notificationAccess ? '#ECFDF5' : '#F3F4F6' }]}>
                <Text style={[styles.settingStatusBadgeText, { color: notificationAccess ? '#059669' : '#6B7280' }]}>
                  {notificationAccess ? 'Active' : 'Disabled'}
                </Text>
              </View>
            </View>
            <Text style={styles.settingsItemSubtitle}>
              {notificationAccess
                ? 'Moneta is receiving supported bank & UPI payment alerts.'
                : 'Grant access to auto-detect incoming bank SMS messages.'}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={onOpenNotificationSettings}
          style={[
            styles.settingsActionButton,
            notificationAccess && styles.settingsActionButtonSecondary,
          ]}
        >
          <Ionicons
            name={notificationAccess ? 'settings-outline' : 'shield-checkmark-outline'}
            size={16}
            color={notificationAccess ? theme.colors.textPrimary : '#FFFFFF'}
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              styles.settingsActionButtonText,
              notificationAccess && styles.settingsActionButtonSecondaryText,
            ]}
          >
            {notificationAccess ? 'Open System Settings' : 'Enable Notification Access'}
          </Text>
        </Pressable>
      </View>

      {/* 3. Auto-Approve Switch Card */}
      <View style={styles.settingsGroupCard}>
        <View style={styles.settingsToggleRow}>
          <View style={[styles.settingsIconWrap, { backgroundColor: '#F3F4F6' }]}>
            <Ionicons name="sparkles-outline" size={20} color={theme.colors.textPrimary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12, marginRight: 10 }}>
            <Text style={styles.settingsItemTitle}>Auto-Approve High Confidence</Text>
            <Text style={styles.settingsItemSubtitle}>
              Automatically record SMS alerts when merchant and bank match accurately.
            </Text>
          </View>
          <Pressable
            onPress={() => void onAutoApprove(!autoApprove)}
            style={[styles.modernSwitch, autoApprove && styles.modernSwitchOn]}
          >
            <View
              style={[
                styles.modernSwitchThumb,
                autoApprove && styles.modernSwitchThumbOn,
              ]}
            />
          </Pressable>
        </View>
      </View>

      {/* 4. Review Queue */}
      <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
        <Text style={styles.sectionHeading}>
          Review Queue {reviews.length > 0 ? `(${reviews.length})` : ''}
        </Text>
      </View>

      {reviews.length === 0 ? (
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="Review queue is clear"
          text="Incoming bank transactions waiting for confirmation will appear here."
        />
      ) : (
        reviews.map((r) => (
          <SmsReviewCard
            key={r.id}
            review={r}
            onConfirm={() => onConfirm(r)}
            onReject={() => onReject(r)}
            onEdit={() => onEdit(r)}
          />
        ))
      )}

      {/* 5. Data & Privacy */}
      <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
        <Text style={styles.sectionHeading}>Data &amp; Privacy</Text>
      </View>

      <View style={styles.settingsGroupCard}>
        <Pressable onPress={onOpenPrivacyPolicy} style={styles.settingsRowPressable}>
          <View style={[styles.settingsIconWrap, { backgroundColor: '#F3F4F6' }]}>
            <Ionicons name="document-text-outline" size={20} color={theme.colors.textPrimary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.settingsItemTitle}>Terms &amp; Privacy Policy</Text>
            <Text style={styles.settingsItemSubtitle}>
              Terms of service, local storage, and privacy details
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>

        <View style={styles.settingsRowSeparator} />

        <View style={styles.settingsHeaderRow}>
          <View style={[styles.settingsIconWrap, { backgroundColor: '#F3F4F6' }]}>
            <Ionicons name="shield-checkmark-outline" size={20} color={theme.colors.textPrimary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.settingsItemTitle}>Local Storage Only</Text>
            <Text style={styles.settingsItemSubtitle}>
              Your financial records stay on this phone. Export or restore backups anytime.
            </Text>
          </View>
        </View>

        <View style={styles.backupButtonsRow}>
          <Pressable onPress={() => void onBackup()} style={styles.backupActionButton}>
            <Ionicons name="cloud-upload-outline" size={16} color={theme.colors.textPrimary} style={{ marginRight: 6 }} />
            <Text style={styles.backupActionText}>Export Backup</Text>
          </Pressable>

          <Pressable onPress={() => void onRestore()} style={styles.backupActionButton}>
            <Ionicons name="cloud-download-outline" size={16} color={theme.colors.textPrimary} style={{ marginRight: 6 }} />
            <Text style={styles.backupActionText}>Restore Backup</Text>
          </Pressable>
        </View>
      </View>

      {/* 6. Danger Zone: Clear All Data */}
      <View style={[styles.sectionHeaderRow, { marginTop: 20 }]}>
        <Text style={styles.sectionHeading}>Reset &amp; Clear</Text>
      </View>

      <View style={[styles.settingsGroupCard, { borderColor: '#FECDD3' }]}>
        <View style={styles.settingsHeaderRow}>
          <View style={[styles.settingsIconWrap, { backgroundColor: '#FFE4E6' }]}>
            <Ionicons name="trash-outline" size={20} color={theme.colors.debitRed} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.settingsItemTitle}>Clear All Application Data</Text>
            <Text style={styles.settingsItemSubtitle}>
              Permanently erase all bank accounts, transactions, debts, subscriptions, and logs from this device.
            </Text>
          </View>
        </View>

        <Pressable onPress={onClearAllData} style={styles.clearDataButton}>
          <Ionicons name="trash" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.clearDataButtonText}>Clear All Data</Text>
        </Pressable>
      </View>

      {/* 7. Footer */}
      <View style={styles.settingsFooterContainer}>
        <Image
          source={require('../assets/logo.png')}
          style={styles.settingsFooterLogo}
          resizeMode="contain"
        />
        <Text style={styles.settingsFooterBrand}>Moneta</Text>
        <Text style={styles.settingsFooterVersion}>Version 1.0.0</Text>
        <Pressable onPress={onOpenPrivacyPolicy} style={styles.settingsFooterPrivacyLink}>
          <Text style={styles.settingsFooterPrivacyText}>Terms of Service &amp; Privacy</Text>
        </Pressable>
        <Text style={styles.settingsFooterCredit}>
          Created by <Text style={styles.settingsFooterAuthor}>Adityaraj Patil</Text>
        </Text>
      </View>
    </View>
  );
}

/* =========================================================================
   SMS REVIEW CARD
   ========================================================================= */

function SmsReviewCard({
  review,
  onConfirm,
  onReject,
  onEdit,
}: {
  review: SmsReview;
  onConfirm: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const isHigh = review.confidence === 'HIGH';
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.reviewTitle}>{review.merchant || 'Bank Transaction'}</Text>
          <Text style={styles.reviewSubtitle}>
            {review.detectedBank || 'Unknown Bank'}{' '}
            {review.accountLastFour ? `· •••• ${review.accountLastFour}` : ''}
          </Text>
        </View>
        <View
          style={[
            styles.confidencePill,
            isHigh ? styles.confidenceHigh : styles.confidenceMed,
          ]}
        >
          <Text
            style={[
              styles.confidenceText,
              isHigh ? styles.confidenceTextHigh : styles.confidenceTextMed,
            ]}
          >
            {review.confidence}
          </Text>
        </View>
      </View>

      <Text style={styles.reviewAmount}>
        {review.transactionType || 'TRANSACTION'}{' '}
        {review.amount !== null ? formatCurrency(review.amount) : 'AMOUNT NEEDED'}
      </Text>

      <View style={styles.rawMessageContainer}>
        <Text style={styles.rawMessageText} numberOfLines={3}>
          {review.rawMessage}
        </Text>
      </View>

      <View style={styles.reviewActionsRow}>
        <Pressable onPress={onConfirm} style={styles.confirmReviewButton}>
          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
          <Text style={styles.confirmReviewText}>Confirm</Text>
        </Pressable>

        <Pressable onPress={onEdit} style={styles.editReviewButton}>
          <Ionicons name="pencil" size={14} color={theme.colors.textPrimary} />
          <Text style={styles.editReviewText}>Edit</Text>
        </Pressable>

        <Pressable onPress={onReject} style={styles.rejectReviewButton}>
          <Text style={styles.rejectReviewText}>Reject</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* =========================================================================
   MODAL SHEET WRAPPER & SUB-MODALS
   ========================================================================= */

function ModalWrapper({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={styles.modalDismissOverlay} onPress={onClose} />
      <View style={styles.modalSheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Pressable onPress={onClose} style={styles.modalCloseButton}>
            <Ionicons name="close" size={20} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {children}
        </ScrollView>
      </View>
    </View>
  );
}

function AccountModal({
  form,
  setForm,
  onSave,
  onClose,
}: {
  form: AccountForm;
  setForm: (f: AccountForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <ModalWrapper title="Add Bank Account" onClose={onClose}>
      <Text style={styles.formFieldLabel}>Select Your Bank (20+ Popular Banks)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bankChipsScroll}>
        {POPULAR_BANKS.map((b) => {
          const isSelected = form.bankName.toLowerCase() === b.name.toLowerCase();
          return (
            <Pressable
              key={b.name}
              onPress={() => {
                setForm({
                  ...form,
                  bankName: b.name,
                  nickname: form.nickname || `${b.shortName} Account`,
                });
              }}
              style={[styles.bankChoiceChip, isSelected && styles.bankChoiceChipActive]}
            >
              <View style={[styles.bankChoiceBadge, isSelected && styles.bankChoiceBadgeActive]}>
                <Text style={[styles.bankChoiceBadgeText, isSelected && styles.bankChoiceBadgeTextActive]}>
                  {b.code}
                </Text>
              </View>
              <Text style={[styles.bankChoiceChipText, isSelected && styles.bankChoiceChipTextActive]}>
                {b.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <InputField
        label="Bank Name *"
        value={form.bankName}
        onChangeText={(bankName) => setForm({ ...form, bankName })}
        placeholder="Select above or type custom bank name"
      />
      <InputField
        label="Account Nickname"
        value={form.nickname}
        onChangeText={(nickname) => setForm({ ...form, nickname })}
        placeholder="e.g. Primary Savings, Salary A/C"
      />
      <InputField
        label="Opening Balance *"
        value={form.openingBalance}
        onChangeText={(openingBalance) => setForm({ ...form, openingBalance })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <ChoiceSelector
        label="Account Type"
        value={form.type}
        options={['Savings', 'Current', 'Cash', 'Other']}
        onChange={(type) => setForm({ ...form, type: type as AccountType })}
      />
      <InputField
        label="Last Four Digits (e.g. 5894)"
        value={form.lastFour}
        onChangeText={(lastFour) => setForm({ ...form, lastFour })}
        placeholder="e.g. 5894 (Helps auto-match SMS alerts)"
        keyboardType="number-pad"
      />
      <InputField
        label="Opening Date"
        value={form.openingDate}
        onChangeText={(openingDate) => setForm({ ...form, openingDate })}
        placeholder="YYYY-MM-DD"
      />
      <PrimarySubmitButton label="Create Account" onPress={onSave} />
    </ModalWrapper>
  );
}

function TransactionModal({
  form,
  setForm,
  accounts,
  transactions,
  categories,
  onAddCategory,
  onSave,
  onClose,
}: {
  form: TransactionForm;
  setForm: (f: TransactionForm) => void;
  accounts: Account[];
  transactions: Transaction[];
  categories: string[];
  onAddCategory: (name: string) => Promise<void>;
  onSave: () => void;
  onClose: () => void;
}) {
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');

  const selectedAccount = useMemo(
    () => accounts.find((a) => String(a.id) === form.accountId),
    [accounts, form.accountId]
  );

  const selectedBalInfo = useMemo(
    () => (selectedAccount ? getAccountBalanceInfo(selectedAccount, transactions) : null),
    [selectedAccount, transactions]
  );

  const isDebitOverdraw =
    form.type === 'DEBIT' &&
    selectedBalInfo !== null &&
    form.amount.trim().length > 0 &&
    (parsePaise(form.amount) ?? 0) > selectedBalInfo.rawBalance;

  const displayCategories = categories.length > 0 ? categories : [
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
  ];

  const handleAddNewCat = async () => {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    await onAddCategory(trimmed);
    setForm({ ...form, category: trimmed });
    setNewCatInput('');
    setShowAddCustom(false);
  };

  return (
    <ModalWrapper title="Add Transaction" onClose={onClose}>
      <View style={styles.typeSegmentContainer}>
        {(['DEBIT', 'CREDIT'] as const).map((type) => {
          const isSelected = form.type === type;
          const isDeb = type === 'DEBIT';
          return (
            <Pressable
              key={type}
              onPress={() => setForm({ ...form, type })}
              style={[
                styles.typeSegmentPill,
                isSelected && (isDeb ? styles.typeSegmentDebit : styles.typeSegmentCredit),
              ]}
            >
              <Ionicons
                name={isDeb ? 'arrow-up-circle' : 'arrow-down-circle'}
                size={18}
                color={isSelected ? '#FFFFFF' : theme.colors.textMuted}
                style={{ marginRight: 6 }}
              />
              <Text
                style={[
                  styles.typeSegmentText,
                  isSelected && styles.typeSegmentTextSelected,
                ]}
              >
                {isDeb ? 'Expense (Debit)' : 'Income (Credit)'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <InputField
        label="Title / Merchant *"
        value={form.title}
        onChangeText={(title) => setForm({ ...form, title })}
        placeholder="e.g. Grocery, Nike, Salary"
      />

      <InputField
        label="Amount *"
        value={form.amount}
        onChangeText={(amount) => setForm({ ...form, amount })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />

      {isDebitOverdraw && selectedBalInfo && (
        <View style={styles.insufficientWarningBox}>
          <Ionicons name="warning-outline" size={16} color="#DC2626" style={{ marginRight: 6 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.insufficientWarningTitle}>⚠️ Insufficient Balance Warning</Text>
            <Text style={styles.insufficientWarningText}>
              This debit exceeds the current balance ({formatCurrency(selectedBalInfo.displayBalance)}) for {selectedAccount?.bankName}. Account display balance will floor at ₹0.00.
            </Text>
          </View>
        </View>
      )}

      <View style={styles.linkedBankHeaderRow}>
        <Text style={styles.formFieldLabel}>Linked Bank Account *</Text>
        {selectedBalInfo && (
          <Text
            style={[
              styles.linkedBankBalanceHint,
              selectedBalInfo.isInsufficient && { color: theme.colors.debitRed },
            ]}
          >
            Avail: {formatCurrency(selectedBalInfo.displayBalance)}
          </Text>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalPillRow}>
        {accounts.map((acc) => {
          const isSelected = form.accountId === String(acc.id);
          return (
            <Pressable
              key={acc.id}
              onPress={() => setForm({ ...form, accountId: String(acc.id) })}
              style={[styles.selectChoicePill, isSelected && styles.selectChoicePillActive]}
            >
              <Text
                style={[
                  styles.selectChoicePillText,
                  isSelected && styles.selectChoicePillTextActive,
                ]}
              >
                {acc.bankName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Category Section with Chips & Custom Add */}
      <View style={styles.categoryPickerSection}>
        <View style={styles.categoryHeaderRow}>
          <Text style={styles.formFieldLabel}>Category *</Text>
          {form.category ? (
            <View style={styles.categorySelectedTag}>
              <View
                style={[
                  styles.categoryTagIconCircle,
                  { backgroundColor: getCategoryMeta(form.category, form.type).bg },
                ]}
              >
                <Ionicons
                  name={getCategoryMeta(form.category, form.type).icon}
                  size={11}
                  color={getCategoryMeta(form.category, form.type).color}
                />
              </View>
              <Text style={styles.categorySelectedTagText}>{form.category}</Text>
            </View>
          ) : (
            <Text style={styles.categorySelectHint}>Select or add</Text>
          )}
        </View>

        {/* Existing Category Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryChipsScroll}
          contentContainerStyle={styles.categoryChipsScrollContent}
        >
          {displayCategories.map((cat) => {
            const isSelected = form.category.toLowerCase() === cat.toLowerCase();
            const meta = getCategoryMeta(cat, form.type);
            return (
              <Pressable
                key={cat}
                onPress={() => setForm({ ...form, category: cat })}
                style={[
                  styles.categoryPill,
                  isSelected && styles.categoryPillSelected,
                ]}
              >
                <View
                  style={[
                    styles.categoryPillIconWrap,
                    { backgroundColor: isSelected ? '#FFFFFF' : meta.bg },
                  ]}
                >
                  <Ionicons
                    name={meta.icon}
                    size={13}
                    color={isSelected ? theme.colors.darkCard : meta.color}
                  />
                </View>
                <Text
                  style={[
                    styles.categoryPillText,
                    isSelected && styles.categoryPillTextSelected,
                  ]}
                >
                  {cat}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => setShowAddCustom((prev) => !prev)}
            style={[
              styles.categoryAddChip,
              showAddCustom && styles.categoryAddChipActive,
            ]}
          >
            <Ionicons
              name={showAddCustom ? 'close' : 'add'}
              size={14}
              color={showAddCustom ? '#FFFFFF' : theme.colors.textPrimary}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.categoryAddChipText,
                showAddCustom && styles.categoryAddChipTextActive,
              ]}
            >
              {showAddCustom ? 'Close' : 'New'}
            </Text>
          </Pressable>
        </ScrollView>

        {/* Inline Add Custom Category Box */}
        {showAddCustom && (
          <View style={styles.inlineAddCategoryBox}>
            <TextInput
              style={styles.inlineAddCategoryInput}
              value={newCatInput}
              onChangeText={setNewCatInput}
              placeholder="e.g. Milk, Auto, Coffee, Gym"
              placeholderTextColor={theme.colors.textMuted}
              returnKeyType="done"
              onSubmitEditing={() => void handleAddNewCat()}
            />
            <Pressable
              onPress={() => void handleAddNewCat()}
              disabled={!newCatInput.trim()}
              style={[
                styles.inlineAddCategoryButton,
                !newCatInput.trim() && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.inlineAddCategoryButtonText}>Add & Select</Text>
            </Pressable>
          </View>
        )}

        <InputField
          label="Category Name (Selected or Custom)"
          value={form.category}
          onChangeText={(category) => setForm({ ...form, category })}
          placeholder="e.g. Auto, Milk, Food, Bills"
        />
      </View>

      <InputField
        label="Date"
        value={form.date}
        onChangeText={(date) => setForm({ ...form, date })}
        placeholder="YYYY-MM-DD"
      />

      <InputField
        label="Notes"
        value={form.notes}
        onChangeText={(notes) => setForm({ ...form, notes })}
        placeholder="Optional details"
      />

      <PrimarySubmitButton label="Save Transaction" onPress={onSave} />
    </ModalWrapper>
  );
}

function DebtModal({
  form,
  setForm,
  onSave,
  onClose,
}: {
  form: DebtForm;
  setForm: (f: DebtForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <ModalWrapper title="Add Debt / Loan" onClose={onClose}>
      <ChoiceSelector
        label="Direction"
        value={form.direction}
        options={['LENT', 'BORROWED']}
        onChange={(d) => setForm({ ...form, direction: d as DebtDirection })}
      />
      <InputField
        label="Person or Organization *"
        value={form.personName}
        onChangeText={(personName) => setForm({ ...form, personName })}
        placeholder="e.g. Alex, Rahul"
      />
      <InputField
        label="Amount *"
        value={form.amount}
        onChangeText={(amount) => setForm({ ...form, amount })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <InputField
        label="Due Date"
        value={form.dueDate}
        onChangeText={(dueDate) => setForm({ ...form, dueDate })}
        placeholder="YYYY-MM-DD (optional)"
      />
      <InputField
        label="Notes"
        value={form.notes}
        onChangeText={(notes) => setForm({ ...form, notes })}
        placeholder="Optional notes"
      />
      <PrimarySubmitButton label="Record Debt" onPress={onSave} />
    </ModalWrapper>
  );
}

function PaymentModal({
  debt,
  amount,
  setAmount,
  onSave,
  onClose,
}: {
  debt: Debt | null;
  amount: string;
  setAmount: (a: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const remaining = debt ? debt.originalAmount - debt.settledAmount : 0;
  return (
    <ModalWrapper title={`Payment · ${debt?.personName ?? ''}`} onClose={onClose}>
      <View style={styles.modalInfoBanner}>
        <Text style={styles.modalInfoLabel}>Remaining Outstanding</Text>
        <Text style={styles.modalInfoValue}>{formatCurrency(remaining)}</Text>
      </View>
      <InputField
        label="Payment Amount *"
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <PrimarySubmitButton label="Record Payment" onPress={onSave} />
    </ModalWrapper>
  );
}

function SubscriptionModal({
  form,
  setForm,
  onSave,
  onClose,
}: {
  form: SubscriptionForm;
  setForm: (f: SubscriptionForm) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <ModalWrapper title="Add Subscription" onClose={onClose}>
      <InputField
        label="Service Name *"
        value={form.name}
        onChangeText={(name) => setForm({ ...form, name })}
        placeholder="e.g. Netflix, Spotify, Gym"
      />
      <InputField
        label="Provider"
        value={form.provider}
        onChangeText={(provider) => setForm({ ...form, provider })}
        placeholder="e.g. Google Play, Apple"
      />
      <InputField
        label="Amount *"
        value={form.amount}
        onChangeText={(amount) => setForm({ ...form, amount })}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />
      <ChoiceSelector
        label="Billing Cycle"
        value={form.billingCycle}
        options={['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']}
        onChange={(cycle) =>
          setForm({ ...form, billingCycle: cycle as Subscription['billingCycle'] })
        }
      />
      <InputField
        label="Next Billing Date *"
        value={form.nextBillingDate}
        onChangeText={(nextBillingDate) => setForm({ ...form, nextBillingDate })}
        placeholder="YYYY-MM-DD"
      />
      <InputField
        label="Category *"
        value={form.category}
        onChangeText={(category) => setForm({ ...form, category })}
        placeholder="e.g. Entertainment, Cloud"
      />
      <InputField
        label="Notes"
        value={form.notes}
        onChangeText={(notes) => setForm({ ...form, notes })}
        placeholder="Optional notes"
      />
      <PrimarySubmitButton label="Save Subscription" onPress={onSave} />
    </ModalWrapper>
  );
}

function StatementModal({
  account,
  transactions,
  onExport,
  onClose,
}: {
  account: Account;
  transactions: Transaction[];
  onExport: () => void;
  onClose: () => void;
}) {
  const accountTransactions = transactions
    .filter((t) => t.accountId === account.id && !t.reversedTransactionId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  const statementRows = accountTransactions.reduce<
    { transaction: Transaction; balanceBefore: number; remaining: number }[]
  >((rows, transaction) => {
    const balanceBefore = rows.length === 0 ? account.openingBalance : rows[rows.length - 1].remaining;
    const remaining =
      balanceBefore + (transaction.type === 'CREDIT' ? transaction.amount : -transaction.amount);
    return [...rows, { transaction, balanceBefore, remaining }];
  }, []);

  const currentBalance = statementRows[statementRows.length - 1]?.remaining ?? account.openingBalance;

  return (
    <ModalWrapper title={`${account.bankName} Statement`} onClose={onClose}>
      <View style={styles.statementActionRow}>
        <View>
          <Text style={styles.statementSub}>Opening Balance</Text>
          <Text style={styles.statementSubValue}>{formatCurrency(account.openingBalance)}</Text>
        </View>
        <Pressable onPress={onExport} style={styles.pdfDownloadButton}>
          <Ionicons name="download-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.pdfDownloadButtonText}>PDF</Text>
        </Pressable>
      </View>

      <ScrollView style={{ maxHeight: 380, marginVertical: 12 }}>
        {statementRows.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="No ledger records"
            text="Transactions linked to this bank will appear in this statement."
          />
        ) : (
          statementRows.map(({ transaction, balanceBefore, remaining }) => {
            const isCr = transaction.type === 'CREDIT';
            return (
              <View key={transaction.id} style={styles.statementRowCard}>
                <View style={styles.statementRowTop}>
                  <Text style={styles.statementRowDate}>{transaction.date}</Text>
                  <Text
                    style={[
                      styles.statementRowType,
                      { color: isCr ? theme.colors.creditGreen : theme.colors.debitRed },
                    ]}
                  >
                    {isCr ? '+ CREDIT' : '- DEBIT'}
                  </Text>
                </View>

                <View style={styles.statementRowMiddle}>
                  <Text style={styles.statementRowTitle}>{transaction.title}</Text>
                  <Text
                    style={[
                      styles.statementRowAmount,
                      { color: isCr ? theme.colors.creditGreen : theme.colors.debitRed },
                    ]}
                  >
                    {formatCurrency(transaction.amount)}
                  </Text>
                </View>

                <View style={styles.statementRowBottom}>
                  <Text style={styles.statementRowSub}>Before: {formatCurrency(balanceBefore)}</Text>
                  <Text style={styles.statementRowSub}>Remaining: {formatCurrency(remaining)}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={styles.statementClosingBlock}>
        <Text style={styles.statementClosingLabel}>Calculated Balance</Text>
        <Text style={styles.statementClosingNumber}>{formatCurrency(currentBalance)}</Text>
      </View>
    </ModalWrapper>
  );
}

function SmsEditModal({
  review,
  accounts,
  categories,
  onSave,
  onReject,
  onClose,
}: {
  review: SmsReview;
  accounts: Account[];
  categories: string[];
  onSave: (input: SmsEditInput) => Promise<void>;
  onReject: () => Promise<void>;
  onClose: () => void;
}) {
  const initialAccountId = useMemo(() => {
    if (review.accountId) return String(review.accountId);
    const matched = findMatchingAccount(
      accounts,
      {
        accountLastFour: review.accountLastFour,
        detectedBank: review.detectedBank,
      },
      review.rawMessage
    );
    if (matched) return String(matched.id);
    return accounts[0] ? String(accounts[0].id) : '';
  }, [review, accounts]);

  const [accountId, setAccountId] = useState(initialAccountId);
  const [title, setTitle] = useState(
    review.merchant || (review.transactionType === 'DEBIT' ? 'UPI Payment' : 'UPI Credit')
  );
  const [category, setCategory] = useState('Food');
  const [amount, setAmount] = useState(
    review.amount === null ? '' : (review.amount / 100).toFixed(2)
  );
  const [type, setType] = useState<TransactionType>(review.transactionType || 'DEBIT');

  const displayCategories = categories.length > 0 ? categories : [
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
    'General',
  ];

  const isDeb = type === 'DEBIT';

  return (
    <ModalWrapper title="Mark Transaction Entry" onClose={onClose}>
      {/* Detected Payment Hero Card */}
      <View style={styles.smsDetectedBannerCard}>
        <View style={styles.smsDetectedTopRow}>
          <Pressable
            onPress={() => setType((prev) => (prev === 'DEBIT' ? 'CREDIT' : 'DEBIT'))}
            style={[styles.smsDetectedTypePill, isDeb ? styles.typeSegmentDebit : styles.typeSegmentCredit]}
          >
            <Ionicons
              name={isDeb ? 'arrow-up-circle' : 'arrow-down-circle'}
              size={14}
              color="#FFFFFF"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.smsDetectedTypeText}>
              {isDeb ? 'Debit (Spent) ⇄' : 'Credit (Received) ⇄'}
            </Text>
          </Pressable>
          {review.detectedBank ? (
            <View style={styles.smsDetectedBankBadge}>
              <Ionicons name="business" size={12} color={theme.colors.textPrimary} style={{ marginRight: 4 }} />
              <Text style={styles.smsDetectedBankText}>{review.detectedBank}</Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.smsDetectedAmountText, { color: isDeb ? theme.colors.debitRed : theme.colors.creditGreen }]}>
          {formatCurrency(review.amount ?? 0)}
        </Text>

        <View style={styles.smsDetectedRawBox}>
          <Ionicons name="chatbox-ellipses-outline" size={14} color={theme.colors.textMuted} style={{ marginRight: 6 }} />
          <Text style={styles.smsDetectedRawSnippet} numberOfLines={2}>
            {review.rawMessage}
          </Text>
        </View>
      </View>

      {/* Title / Merchant */}
      <InputField
        label="Title / Merchant *"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Milk, Tea Stall, Grocery, Swiggy"
      />

      {/* Amount */}
      <InputField
        label="Amount *"
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
        prefix="₹"
      />

      {/* Bank Account Selector */}
      <Text style={styles.formFieldLabel}>Linked Bank Account *</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalPillRow}>
        {accounts.map((acc) => {
          const isSelected = accountId === String(acc.id);
          return (
            <Pressable
              key={acc.id}
              onPress={() => setAccountId(String(acc.id))}
              style={[styles.selectChoicePill, isSelected && styles.selectChoicePillActive]}
            >
              <Text
                style={[
                  styles.selectChoicePillText,
                  isSelected && styles.selectChoicePillTextActive,
                ]}
              >
                {acc.bankName} {acc.lastFour ? `(••${acc.lastFour})` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Category Chips Selector */}
      <Text style={styles.formFieldLabel}>Category *</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoryChipsScroll}
        contentContainerStyle={styles.categoryChipsScrollContent}
      >
        {displayCategories.map((cat) => {
          const isSelected = category.toLowerCase() === cat.toLowerCase();
          const meta = getCategoryMeta(cat, type);
          return (
            <Pressable
              key={cat}
              onPress={() => setCategory(cat)}
              style={[
                styles.categoryPill,
                isSelected && styles.categoryPillSelected,
              ]}
            >
              <View
                style={[
                  styles.categoryPillIconWrap,
                  { backgroundColor: isSelected ? '#FFFFFF' : meta.bg },
                ]}
              >
                <Ionicons
                  name={meta.icon}
                  size={13}
                  color={isSelected ? theme.colors.darkCard : meta.color}
                />
              </View>
              <Text
                style={[
                  styles.categoryPillText,
                  isSelected && styles.categoryPillTextSelected,
                ]}
              >
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <InputField
        label="Category Name"
        value={category}
        onChangeText={setCategory}
        placeholder="e.g. Food, Milk, Auto, Shopping"
      />

      {/* Action Buttons: Yes, Save Entry or Reject */}
      <View style={styles.smsActionButtonsContainer}>
        <Pressable
          onPress={() => {
            const parsed = parsePaise(amount);
            if (!accountId || parsed === null) return;
            void onSave({
              accountId: Number(accountId),
              title: title.trim() || 'UPI Transaction',
              category: category.trim() || 'General',
              type,
              amount: parsed,
              date: review.transactionDate,
              reportedBalance: review.reportedBalance,
            });
          }}
          style={styles.smsConfirmSaveButton}
        >
          <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
          <Text style={styles.smsConfirmSaveButtonText}>Yes, Save Entry</Text>
        </Pressable>

        <Pressable
          onPress={() => void onReject()}
          style={styles.smsRejectDismissButton}
        >
          <Ionicons name="close-circle-outline" size={18} color={theme.colors.debitRed} style={{ marginRight: 6 }} />
          <Text style={styles.smsRejectDismissButtonText}>Reject</Text>
        </Pressable>
      </View>
    </ModalWrapper>
  );
}

/* =========================================================================
   GENERIC UI HELPERS
   ========================================================================= */

function MetricCard({
  label,
  value,
  icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricCardTop}>
        <View style={[styles.metricIconWrap, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <Text style={styles.metricCardLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.metricCardValue, { color }]}>{value}</Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name={icon} size={30} color={theme.colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  prefix,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  keyboardType?: 'decimal-pad' | 'number-pad';
  prefix?: string;
}) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.formFieldLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        {prefix ? <Text style={styles.inputPrefixText}>{prefix}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          keyboardType={keyboardType}
          style={styles.fieldInput}
        />
      </View>
    </View>
  );
}

function ChoiceSelector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.formFieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalPillRow}>
        {options.map((option) => {
          const isSelected = value === option;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              style={[styles.selectChoicePill, isSelected && styles.selectChoicePillActive]}
            >
              <Text
                style={[
                  styles.selectChoicePillText,
                  isSelected && styles.selectChoicePillTextActive,
                ]}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PrivacyPolicyModal({
  isOnboarding = false,
  onApprove,
  onClose,
}: {
  isOnboarding?: boolean;
  onApprove: () => void;
  onClose: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [activeTab, setActiveTab] = useState<'TERMS' | 'PRIVACY'>('TERMS');

  return (
    <View style={styles.modalBackdrop}>
      {!isOnboarding && <Pressable style={styles.modalDismissOverlay} onPress={onClose} />}
      <View style={[styles.modalSheet, { maxHeight: '92%' }]}>
        <View style={styles.sheetHandle} />

        {/* Modal Top Bar */}
        <View style={styles.modalHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.modalTitle}>Terms &amp; Privacy</Text>
            <Text style={styles.modalSubtitle}>How Moneta works and protects your data</Text>
          </View>
          {!isOnboarding && (
            <Pressable onPress={onClose} style={styles.modalCloseButton} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={theme.colors.textPrimary} />
            </Pressable>
          )}
        </View>

        {/* Segmented Switcher */}
        <View style={styles.legalTabTrack}>
          <Pressable
            onPress={() => setActiveTab('TERMS')}
            style={[styles.legalTabPill, activeTab === 'TERMS' && styles.legalTabPillActive]}
          >
            <Text style={[styles.legalTabText, activeTab === 'TERMS' && styles.legalTabTextActive]}>
              Terms of Service
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('PRIVACY')}
            style={[styles.legalTabPill, activeTab === 'PRIVACY' && styles.legalTabPillActive]}
          >
            <Text style={[styles.legalTabText, activeTab === 'PRIVACY' && styles.legalTabTextActive]}>
              Privacy Policy
            </Text>
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 6 }}
        >
          {activeTab === 'TERMS' ? (
            <View style={styles.legalContentBlock}>
              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>1. Overview</Text>
                <Text style={styles.legalBodyText}>
                  Moneta is an offline-first personal financial manager built to help you track expenses, bank balances, debts, and subscriptions directly on your phone.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>2. Use of the App</Text>
                <Text style={styles.legalBodyText}>
                  The app is intended for personal bookkeeping. All transactions, accounts, and categorizations are managed by you. Moneta does not process monetary transfers or connect directly with banking networks.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>3. Transaction Alerts</Text>
                <Text style={styles.legalBodyText}>
                  With your permission, Moneta parses incoming transactional notifications on this device to help you quickly log purchases. You retain full control to confirm, adjust, or discard any suggestion.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>4. Data Ownership &amp; Backups</Text>
                <Text style={styles.legalBodyText}>
                  You own 100% of your records. You can export a JSON backup or generate PDF statements whenever needed. Choosing &ldquo;Clear All Data&rdquo; permanently wipes all records from your device.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>5. Disclaimer</Text>
                <Text style={styles.legalBodyText}>
                  Moneta is provided for personal tracking purposes. We recommend referencing official bank statements for statutory, accounting, or tax filings.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.legalContentBlock}>
              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>1. Local Storage Only</Text>
                <Text style={styles.legalBodyText}>
                  All financial entries, account numbers, and categories are stored exclusively in an SQLite database on your device. We run no remote database servers or cloud accounts.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>2. Zero Network Data Transmission</Text>
                <Text style={styles.legalBodyText}>
                  Moneta functions completely offline. Your financial information is never uploaded, tracked, or sent across the internet.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>3. Device Permissions</Text>
                <Text style={styles.legalBodyText}>
                  &bull; <Text style={styles.boldText}>Notifications</Text>: Used strictly to remind you of due subscriptions and prompt review for detected transactions.{"\n"}
                  &bull; <Text style={styles.boldText}>Notification Listener</Text>: Used solely to parse bank transaction SMS notifications on your device. Personal conversations, OTPs, and passwords are never read or stored.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>4. No Ads, No Trackers</Text>
                <Text style={styles.legalBodyText}>
                  Moneta contains zero advertising banners, zero tracking SDKs, and zero analytics telemetry. We do not sell or monetize user data in any form.
                </Text>
              </View>

              <View style={styles.legalSection}>
                <Text style={styles.legalSectionTitle}>5. Total Data Control</Text>
                <Text style={styles.legalBodyText}>
                  You can export your database or erase all stored records at any moment in Settings with immediate effect.
                </Text>
              </View>
            </View>
          )}

          {/* Action / Confirmation footer */}
          {isOnboarding ? (
            <View style={styles.legalConsentWrap}>
              <Pressable
                onPress={() => setAgreed((prev) => !prev)}
                style={[
                  styles.legalCheckboxCard,
                  agreed && styles.legalCheckboxCardActive,
                ]}
              >
                <View style={[styles.legalCheckbox, agreed && styles.legalCheckboxChecked]}>
                  {agreed && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                </View>
                <Text style={styles.legalCheckboxLabel}>
                  I agree to the Terms of Service &amp; Privacy Policy
                </Text>
              </Pressable>

              <Pressable
                onPress={onApprove}
                disabled={!agreed}
                style={[
                  styles.legalPrimaryButton,
                  !agreed && styles.legalPrimaryButtonDisabled,
                ]}
              >
                <Text style={styles.legalPrimaryButtonText}>Get Started</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: 18 }}>
              <Pressable onPress={onClose} style={styles.legalPrimaryButton}>
                <Text style={styles.legalPrimaryButtonText}>Done</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function PrimarySubmitButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.primarySubmitButton}>
      <Text style={styles.primarySubmitButtonText}>{label}</Text>
    </Pressable>
  );
}

/* =========================================================================
   STYLESHEET
   ========================================================================= */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },

  // Top App Bar
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  compactTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  compactBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compactLogoImage: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  compactBrandName: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: theme.colors.textPrimary,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandLogoImage: {
    width: 38,
    height: 38,
    borderRadius: 12,
  },
  brandIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: theme.colors.heroLime,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: theme.colors.textMuted,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: theme.colors.textPrimary,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#111216',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Main Container & Top Tabs
  mainContainer: {
    flex: 1,
  },
  topTabsWrapper: {
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  topTabsTrack: {
    flexDirection: 'row',
    backgroundColor: '#E5ECE7',
    borderRadius: 999,
    padding: 3,
  },
  topTabPill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  activeTopTabPill: {
    backgroundColor: '#FFFFFF',
    ...theme.shadows.subtle,
  },
  topTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  activeTopTabText: {
    color: theme.colors.textPrimary,
    fontWeight: '800',
  },

  contentScroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  moduleContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  // Overview Layout
  overviewContainer: {
    flex: 1,
  },

  // Hero Card
  heroCard: {
    borderRadius: 28,
    padding: 22,
    marginBottom: 16,
    ...theme.shadows.hero,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currencyBadge: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  currencyBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.heroText,
    letterSpacing: 0.5,
  },
  heroSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroRateText: {
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.heroSubtext,
  },
  heroEyeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBalanceBlock: {
    marginVertical: 18,
  },
  heroBalanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: theme.colors.heroSubtext,
    marginBottom: 6,
  },
  heroBalanceText: {
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1,
    color: theme.colors.heroText,
  },
  heroFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  heroGrowthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    gap: 5,
  },
  heroGrowthText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#065F46',
  },
  cardLogoCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    opacity: 0.85,
  },
  cardDigitsText: {
    marginLeft: 8,
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.heroText,
  },

  // Two Primary Action Buttons (Requirement 2)
  twoButtonRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  primaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111216',
    borderRadius: 18,
    paddingVertical: 14,
    ...theme.shadows.subtle,
  },
  primaryActionButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  secondaryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 14,
    ...theme.shadows.subtle,
  },
  secondaryActionButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },

  // Today's Spending Card (Requirement 3)
  todaySpendingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  todayCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  todayIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.colors.debitRedLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCardTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: theme.colors.textMuted,
    letterSpacing: 0.8,
  },
  todayCardSubtitle: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  liveIndicatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  livePulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveIndicatorText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#047857',
  },
  todayAmountRow: {
    marginVertical: 4,
  },
  todayAmountValue: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    color: theme.colors.debitRed,
  },
  viewDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3F6F4',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  viewDetailsButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },

  // Detailed Breakdown List in Modal
  breakdownDetailsList: {
    marginTop: 14,
    backgroundColor: '#F8FAF9',
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  breakdownDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  breakdownDetailLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  breakdownDetailValue: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },

  // Category Analysis Section in Detailed Breakdown Modal
  categoryAnalysisSection: {
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  categoryAnalysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  categoryAnalysisTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  categoryAnalysisSubtitle: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  categoryTotalBadge: {
    backgroundColor: '#F3F6F4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  categoryTotalBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  categoryEmptyBox: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  categoryEmptyText: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  categorySpendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  categorySpendIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  categorySpendInfo: {
    flex: 1,
  },
  categorySpendTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },
  categorySpendName: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  categorySpendAmount: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.debitRed,
  },
  categorySpendMetaLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  categorySpendCount: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  categorySpendPercent: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  categoryProgressBarTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#F1F4F2',
    overflow: 'hidden',
  },
  categoryProgressBarFill: {
    height: '100%',
    borderRadius: 999,
  },

  // Overview Category Preview Card
  overviewCategoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  overviewCategoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  overviewCategoryLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  overviewCategoryLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  overviewCategoryList: {
    gap: 12,
  },
  overviewCategoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  overviewCategoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewCategoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  overviewCategoryName: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  overviewCategoryAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: theme.colors.debitRed,
  },

  // Category Picker in TransactionModal
  categoryPickerSection: {
    marginBottom: 8,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  categorySelectedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F6F4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  categoryTagIconCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  categorySelectedTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  categorySelectHint: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  categoryChipsScroll: {
    marginBottom: 10,
  },
  categoryChipsScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F8FAF9',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  categoryPillSelected: {
    backgroundColor: '#111216',
    borderColor: '#111216',
  },
  categoryPillIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  categoryPillTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  categoryAddChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  categoryAddChipActive: {
    backgroundColor: '#111216',
    borderColor: '#111216',
  },
  categoryAddChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  categoryAddChipTextActive: {
    color: '#FFFFFF',
  },
  inlineAddCategoryBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAF9',
    borderRadius: 14,
    padding: 6,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  inlineAddCategoryInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: theme.colors.textPrimary,
  },
  inlineAddCategoryButton: {
    backgroundColor: '#111216',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  inlineAddCategoryButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Transaction Detail Modal
  txDetailTop: {
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    marginBottom: 14,
  },
  txDetailIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  txDetailTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  txDetailAmount: {
    fontSize: 30,
    fontWeight: '900',
    marginVertical: 6,
  },
  txDetailTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 4,
  },
  txDetailTypeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  reverseTxButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECDD3',
    backgroundColor: '#FFF1F2',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  reverseTxButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.debitRed,
  },

  // Sub Filter Rows
  subFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  subFilterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  subFilterPillActive: {
    backgroundColor: '#111216',
    borderColor: '#111216',
  },
  subFilterText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  subFilterTextActive: {
    color: '#FFFFFF',
  },

  // Metric Grid
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
  },
  metricCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  metricCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  metricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
    flex: 1,
  },
  metricCardValue: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  // Chart Card (Weekly vs Monthly)
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  cardSectionHint: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  rangeSelector: {
    flexDirection: 'row',
    backgroundColor: '#F3F6F4',
    borderRadius: 999,
    padding: 3,
  },
  rangePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  activeRangePill: {
    backgroundColor: '#111216',
  },
  rangePillText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  activeRangePillText: {
    color: '#FFFFFF',
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 120,
    paddingTop: 10,
  },
  barItem: {
    alignItems: 'center',
    flex: 1,
  },
  barTrack: {
    width: 16,
    height: 90,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F3F6F4',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    backgroundColor: '#CBD5E1',
    borderRadius: 8,
  },
  barFillActive: {
    backgroundColor: theme.colors.debitRed,
  },
  barDateText: {
    fontSize: 9,
    fontWeight: '700',
    color: theme.colors.textMuted,
    marginTop: 6,
  },
  barDayText: {
    fontSize: 9,
    color: theme.colors.textMuted,
  },

  // Headings & Links
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: theme.colors.textPrimary,
  },
  sectionSubheading: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  sectionLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },

  // Bank Mini Cards Row
  horizontalCardScroll: {
    marginBottom: 20,
  },
  bankMiniCard: {
    width: 170,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginRight: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  bankMiniTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bankMiniIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.creditGreenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankLastFour: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  bankMiniName: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  bankMiniType: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
    marginBottom: 8,
  },
  bankMiniBalance: {
    fontSize: 15,
    fontWeight: '900',
    color: theme.colors.textPrimary,
  },
  addBankPillCard: {
    width: 130,
    backgroundColor: '#111216',
    borderRadius: 20,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    ...theme.shadows.subtle,
  },
  addBankIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  addBankTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  addBankSubtitle: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Transactions Screen
  transactionsView: {
    flex: 1,
  },
  transactionsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.6,
    color: theme.colors.textPrimary,
  },
  screenSubtitle: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  headerButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  secondaryHeaderButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  primaryHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#111216',
  },
  primaryHeaderButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  accountFilterScroll: {
    marginBottom: 14,
  },
  accountFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: 8,
  },
  activeAccountFilterPill: {
    backgroundColor: '#111216',
    borderColor: '#111216',
  },
  accountFilterPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  activeAccountFilterPillText: {
    color: '#FFFFFF',
  },
  tinyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 18,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.textPrimary,
    padding: 0,
  },

  // Date Grouping
  dateGroupContainer: {
    marginBottom: 18,
  },
  dateGroupHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textMuted,
    marginBottom: 10,
    marginLeft: 4,
  },
  groupCardCluster: {
    gap: 10,
  },
  transactionsList: {
    gap: 10,
    marginBottom: 20,
  },

  // Transaction Card
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  transactionAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  transactionMiddle: {
    flex: 1,
  },
  transactionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginBottom: 3,
  },
  transactionSubtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  transactionSubtitle: {
    fontSize: 11,
    color: theme.colors.textMuted,
    flexShrink: 1,
  },
  timeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  timeTagText: {
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  transactionRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  transactionAmountText: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.4,
  },

  // Accounts Tab Styles (Digital Wallet Cards)
  accountsView: {
    flex: 1,
  },
  accountFullCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  archivedCard: {
    opacity: 0.6,
  },
  accountCardSurface: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    ...theme.shadows.card,
  },
  accountCardTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardChipIcon: {
    width: 32,
    height: 24,
    justifyContent: 'center',
  },
  accountCardNumberRow: {
    marginVertical: 10,
  },
  accountCardMaskedNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  accountCardBottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  cardHolderLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  cardBankTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 2,
    maxWidth: 160,
  },
  cardBalanceLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  cardBalanceValue: {
    fontSize: 18,
    fontWeight: '900',
    color: theme.colors.heroLime,
    marginTop: 2,
  },
  accountStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 6,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAF9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 5,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  accountCardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 12,
    marginTop: 6,
  },
  accountStatementButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F3F6F4',
  },
  accountStatementButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  archiveAccountButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  archiveAccountText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.debitRed,
  },

  // Debts Tab Styles
  moduleContainer: {
    flex: 1,
  },
  debtSummaryCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    ...theme.shadows.subtle,
  },
  debtSummaryIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  debtSummaryIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  debtSummaryValue: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  debtCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  debtCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  debtAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111216',
    alignItems: 'center',
    justifyContent: 'center',
  },
  debtAvatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  debtPersonName: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  debtDirectionText: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeOpen: {
    backgroundColor: theme.colors.warningOrangeLight,
  },
  statusBadgeSettled: {
    backgroundColor: '#F3F4F6',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusBadgeTextOpen: {
    color: '#B45309',
  },
  statusBadgeTextSettled: {
    color: '#6B7280',
  },
  debtAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  debtAmountLabel: {
    fontSize: 12,
    color: theme.colors.textMuted,
    fontWeight: '600',
  },
  debtAmountValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  recordPaymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#111216',
    borderRadius: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  recordPaymentButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  // Subscriptions Tab Styles
  subscriptionProjectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  subProjectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subProjectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  subProjectionValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1E1B4B',
    marginTop: 2,
  },
  subscriptionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  subTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  subAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subName: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  subDetails: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  subAmountWrap: {
    alignItems: 'flex-end',
  },
  subAmount: {
    fontSize: 16,
    fontWeight: '900',
    color: theme.colors.textPrimary,
  },
  subFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 10,
  },
  subRenewalWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  subRenewalText: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  subTogglePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  subTogglePillActive: {
    backgroundColor: theme.colors.creditGreenLight,
  },
  subTogglePillPaused: {
    backgroundColor: '#F3F4F6',
  },
  subToggleText: {
    fontSize: 11,
    fontWeight: '800',
  },
  subToggleTextActive: {
    color: theme.colors.creditGreen,
  },
  subToggleTextPaused: {
    color: theme.colors.textMuted,
  },

  // Settings Tab Styles
  navHubCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    marginBottom: 16,
    ...theme.shadows.subtle,
  },
  navHubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  navHubRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  navHubIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navHubTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  navHubSub: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 1,
  },
  settingStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  settingStatusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  settingsGroupCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F3F6F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  settingsItemSubtitle: {
    fontSize: 11,
    color: theme.colors.textMuted,
    lineHeight: 16,
    marginTop: 2,
  },
  settingsActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111216',
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  settingsActionButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  settingsActionButtonSecondary: {
    backgroundColor: '#F3F6F4',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  settingsActionButtonSecondaryText: {
    color: theme.colors.textPrimary,
  },
  modernSwitch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    padding: 2,
    justifyContent: 'center',
  },
  modernSwitchOn: {
    backgroundColor: theme.colors.creditGreen,
  },
  modernSwitchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  modernSwitchThumbOn: {
    transform: [{ translateX: 20 }],
  },
  backupButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  backupActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F3F6F4',
  },
  backupActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  clearDataButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.debitRed,
    borderRadius: 14,
    paddingVertical: 13,
    marginTop: 14,
  },
  clearDataButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  settingsFooterContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: 24,
    paddingVertical: 16,
  },
  settingsFooterLogo: {
    width: 44,
    height: 44,
    borderRadius: 14,
    marginBottom: 10,
  },
  settingsFooterBrand: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  settingsFooterCredit: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  settingsFooterAuthor: {
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  settingsFooterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F6F4',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  settingsFooterPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },

  // Review Queue Card
  reviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.subtle,
  },
  reviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reviewTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  reviewSubtitle: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginTop: 2,
  },
  confidencePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  confidenceHigh: {
    backgroundColor: theme.colors.creditGreenLight,
  },
  confidenceMed: {
    backgroundColor: theme.colors.warningOrangeLight,
  },
  confidenceText: {
    fontSize: 9,
    fontWeight: '800',
  },
  confidenceTextHigh: {
    color: theme.colors.creditGreen,
  },
  confidenceTextMed: {
    color: theme.colors.warningOrange,
  },
  reviewAmount: {
    fontSize: 18,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    marginVertical: 8,
  },
  rawMessageContainer: {
    backgroundColor: '#F8FAF9',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  rawMessageText: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    lineHeight: 16,
  },
  reviewActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confirmReviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.creditGreen,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  confirmReviewText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  editReviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F6F4',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  editReviewText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  rejectReviewButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rejectReviewText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.debitRed,
  },

  // SMS Detection & Mark Entry Styles
  smsDetectedBannerCard: {
    backgroundColor: '#F8FAF9',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  smsDetectedTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  smsDetectedTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  smsDetectedTypeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  smsDetectedBankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  smsDetectedBankText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  smsDetectedAmountText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginVertical: 4,
  },
  smsDetectedRawBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    padding: 10,
    borderRadius: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  smsDetectedRawSnippet: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    flex: 1,
    fontStyle: 'italic',
    lineHeight: 15,
  },
  smsActionButtonsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 10,
  },
  smsConfirmSaveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111216',
    paddingVertical: 14,
    borderRadius: 14,
    ...theme.shadows.subtle,
  },
  smsConfirmSaveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  smsRejectDismissButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
  },
  smsRejectDismissButtonText: {
    color: theme.colors.debitRed,
    fontSize: 14,
    fontWeight: '800',
  },

  // Overview Notification Banner
  smsReviewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF9C3',
    borderWidth: 1,
    borderColor: '#FDE047',
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  smsReviewBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF08A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smsReviewBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#713F12',
  },
  smsReviewBannerSubtitle: {
    fontSize: 11,
    color: '#854D0E',
    marginTop: 1,
  },
  smsLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#DC2626',
  },
  smsReviewBannerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111216',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smsReviewBannerButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Test Simulator Buttons
  testButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  testPaymentButton: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111216',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  testPaymentButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  testPaymentSecondaryButton: {
    flex: 1,
    minWidth: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  testPaymentSecondaryButtonText: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },

  // Floating Bottom Navigation Dock (Matching Reference Image 2)
  bottomDockContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  dockSurface: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#111216',
    borderRadius: 36,
    paddingVertical: 6,
    paddingHorizontal: 14,
    width: '100%',
    maxWidth: 380,
    ...theme.shadows.dock,
  },
  dockIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDockCircle: {
    backgroundColor: theme.colors.heroLime,
  },

  // Toast Notification
  toastBanner: {
    position: 'absolute',
    bottom: 94,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111216',
    borderRadius: 16,
    padding: 14,
    ...theme.shadows.card,
  },
  toastText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F3F6F4',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  emptyText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  modalDismissOverlay: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 22,
    paddingTop: 12,
    maxHeight: '92%',
    ...theme.shadows.card,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
    color: theme.colors.textPrimary,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F6F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldContainer: {
    marginBottom: 14,
  },
  formFieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAF9',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  inputPrefixText: {
    fontSize: 15,
    fontWeight: '800',
    color: theme.colors.textPrimary,
    marginRight: 6,
  },
  fieldInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  horizontalPillRow: {
    marginBottom: 14,
  },
  selectChoicePill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#F3F6F4',
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectChoicePillActive: {
    backgroundColor: '#111216',
  },
  selectChoicePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  selectChoicePillTextActive: {
    color: '#FFFFFF',
  },
  primarySubmitButton: {
    backgroundColor: '#111216',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 8,
    ...theme.shadows.subtle,
  },
  primarySubmitButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  typeSegmentContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  typeSegmentPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#F3F6F4',
  },
  typeSegmentDebit: {
    backgroundColor: theme.colors.debitRed,
  },
  typeSegmentCredit: {
    backgroundColor: theme.colors.creditGreen,
  },
  typeSegmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textMuted,
  },
  typeSegmentTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  modalInfoBanner: {
    backgroundColor: '#F3F6F4',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  modalInfoLabel: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  modalInfoValue: {
    fontSize: 20,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    marginTop: 2,
  },

  // Statement Modal Specific
  statementActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAF9',
    borderRadius: 16,
    padding: 14,
  },
  statementSub: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  statementSubValue: {
    fontSize: 16,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  pdfDownloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111216',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  pdfDownloadButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statementRowCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8,
  },
  statementRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statementRowDate: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  statementRowType: {
    fontSize: 10,
    fontWeight: '800',
  },
  statementRowMiddle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statementRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  statementRowAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  statementRowBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    marginTop: 8,
    paddingTop: 6,
  },
  statementRowSub: {
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  statementClosingBlock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 14,
    marginTop: 6,
  },
  statementClosingLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  statementClosingNumber: {
    fontSize: 20,
    fontWeight: '900',
    color: theme.colors.textPrimary,
  },

  // Settings - Data & Privacy Row
  settingsRowPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  settingsRowSeparator: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 14,
  },
  settingsFooterVersion: {
    fontSize: 11,
    color: theme.colors.textMuted,
    marginBottom: 6,
  },
  settingsFooterPrivacyLink: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  settingsFooterPrivacyText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },

  // Modal Subtitle
  modalSubtitle: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 2,
  },

  // Terms & Privacy Tabs
  legalTabTrack: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 3,
    marginTop: 12,
    marginBottom: 16,
  },
  legalTabPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalTabPillActive: {
    backgroundColor: '#FFFFFF',
    ...theme.shadows.subtle,
  },
  legalTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  legalTabTextActive: {
    color: theme.colors.textPrimary,
    fontWeight: '700',
  },

  // Content Blocks
  legalContentBlock: {
    gap: 16,
  },
  legalSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  legalSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  legalBodyText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4B5563',
  },
  boldText: {
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },

  // Onboarding Consent Checkbox & Primary Button
  legalConsentWrap: {
    marginTop: 18,
    gap: 12,
  },
  legalCheckboxCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  legalCheckboxCardActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#059669',
  },
  legalCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9CA3AF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  legalCheckboxChecked: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  legalCheckboxLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    flex: 1,
  },
  legalPrimaryButton: {
    backgroundColor: '#111827',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legalPrimaryButtonDisabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.6,
  },
  legalPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  bankChipsScroll: {
    marginBottom: 14,
  },
  bankChoiceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  bankChoiceChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  bankChoiceBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
  },
  bankChoiceBadgeActive: {
    backgroundColor: '#374151',
  },
  bankChoiceBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#374151',
  },
  bankChoiceBadgeTextActive: {
    color: '#F9FAFB',
  },
  bankChoiceChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1F2937',
  },
  bankChoiceChipTextActive: {
    color: '#FFFFFF',
  },
  bankMiniCardWarning: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF5F5',
  },
  insufficientPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  insufficientPillText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#DC2626',
  },
  insufficientWarningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  insufficientWarningBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 2,
  },
  insufficientWarningBannerSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#991B1B',
    lineHeight: 15,
  },
  linkedBankHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  linkedBankBalanceHint: {
    fontSize: 11,
    fontWeight: '700',
    color: '#059669',
  },
  insufficientWarningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 10,
    marginTop: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  insufficientWarningTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
    marginBottom: 2,
  },
  insufficientWarningText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#991B1B',
    lineHeight: 15,
  },
});
