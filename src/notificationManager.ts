import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants, { ExecutionEnvironment } from 'expo-constants';

// Configure notification behavior for foreground notifications
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
      priority: Notifications.AndroidNotificationPriority?.HIGH,
    }),
  });
} catch {
  // Ignored if notification handler configuration fails
}

function isRunningInExpoGo(): boolean {
  return (
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
    (Constants as { appOwnership?: string }).appOwnership === 'expo'
  );
}

export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Expo Go does not support notification channel management on Android SDK 53+
  if (isRunningInExpoGo()) {
    return;
  }

  try {
    await Notifications.setNotificationChannelAsync('moneta_transactions', {
      name: 'Bank Transactions',
      importance: 5,
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    }).catch(() => {});
    await Notifications.setNotificationChannelAsync('moneta_subscriptions', {
      name: 'Subscription Reminders',
      importance: 4,
      sound: 'default',
      enableVibrate: true,
      showBadge: false,
    }).catch(() => {});
  } catch {
    // Ignored in Expo Go or environments where channels are restricted
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync().catch(() => ({
      status: 'undetermined' as Notifications.PermissionStatus,
    }));
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const res = await Notifications.requestPermissionsAsync().catch(() => ({
        status: 'denied' as Notifications.PermissionStatus,
      }));
      finalStatus = res.status;
    }
    return finalStatus === 'granted';
  } catch {
    return false;
  }
}

// In-memory set to track which reviewIds have already had a notification sent.
// This prevents the same SMS review from firing multiple pop-ups.
const sentNotificationReviewIds = new Set<number>();

export function clearSentNotificationId(reviewId: number) {
  sentNotificationReviewIds.delete(reviewId);
}

export async function sendTransactionNotification({
  amount,
  title,
  bank,
  reviewId,
}: {
  amount: number; // in paise
  title?: string | null;
  bank?: string | null;
  reviewId?: number | null;
}): Promise<void> {
  // Deduplicate: skip if we already sent a notification for this reviewId
  if (reviewId !== null && reviewId !== undefined && sentNotificationReviewIds.has(reviewId)) {
    return;
  }

  // Persist dedup: check if notification already presented (survives app restart)
  if (reviewId !== null && reviewId !== undefined) {
    try {
      const presented = await Notifications.getPresentedNotificationsAsync();
      const alreadyPresented = presented.some(
        (n) => (n.request.content.data as Record<string, unknown>)?.reviewId === reviewId
      );
      if (alreadyPresented) {
        sentNotificationReviewIds.add(reviewId);
        return;
      }
    } catch {
      // Best-effort only
    }
  }

  const formatted = `₹${(amount / 100).toFixed(2)}`;
  const notifTitle = `Mark entry for ${formatted}`;
  const bankOrMerchant = [title, bank].filter(Boolean).join(' · ');
  const body = bankOrMerchant
    ? `Detected via ${bankOrMerchant}. Tap to choose category & confirm.`
    : 'New payment detected. Tap to confirm bank and category.';

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: notifTitle,
        body,
        data: { reviewId: reviewId ?? null },
        // Use channel for Android
        ...(Platform.OS === 'android' ? { channelId: 'moneta_transactions' } : {}),
      },
      trigger: null,
    }).catch(() => {});

    // Mark this reviewId as notified so we don't fire again
    if (reviewId !== null && reviewId !== undefined) {
      sentNotificationReviewIds.add(reviewId);
    }
  } catch {
    // Ignored in environments where background notifications are restricted
  }
}

export async function sendSubscriptionReminderNotification({
  subscriptionName,
  amount,
  daysUntilDue,
  subscriptionId,
}: {
  subscriptionName: string;
  amount: number; // in paise
  daysUntilDue: number;
  subscriptionId: number;
}): Promise<void> {
  const formatted = `₹${(amount / 100).toFixed(2)}`;
  const dayWord = daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`;
  const notifTitle = `📅 ${subscriptionName} due ${dayWord}`;
  const body = `Your ${subscriptionName} subscription of ${formatted} is due ${dayWord}. Make sure you have enough balance!`;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: notifTitle,
        body,
        data: { subscriptionId },
        ...(Platform.OS === 'android' ? { channelId: 'moneta_subscriptions' } : {}),
      },
      trigger: null,
    }).catch(() => {});
  } catch {
    // Ignored in environments where background notifications are restricted
  }
}

