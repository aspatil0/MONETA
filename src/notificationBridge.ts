import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type NativeNotification = {
  id: string;
  packageName: string;
  title: string;
  text: string;
  receivedAt: number;
};

type MonetaNotificationsModule = {
  isNotificationAccessEnabled: () => boolean;
  openNotificationAccessSettings: () => Promise<void>;
  getPendingNotifications: () => Promise<NativeNotification[]>;
  clearPendingNotification: (id: string) => Promise<void>;
};

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<MonetaNotificationsModule>('MonetaNotifications')
  : null;

export function isNotificationListenerAvailable() {
  return nativeModule !== null;
}

export async function isNotificationAccessEnabled() {
  return nativeModule?.isNotificationAccessEnabled() ?? false;
}

export async function openNotificationAccessSettings() {
  if (!nativeModule) throw new Error('Notification support is not included in this build. Reinstall the MONETA development build.');
  await nativeModule.openNotificationAccessSettings();
}

export async function drainPendingNotifications() {
  return nativeModule?.getPendingNotifications() ?? [];
}

export async function clearPendingNotification(id: string) {
  if (nativeModule) await nativeModule.clearPendingNotification(id);
}
