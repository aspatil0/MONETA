package com.moneta.notifications

import android.content.ComponentName
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MonetaNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MonetaNotifications")
    Function("isNotificationAccessEnabled") {
      val context = appContext.reactContext ?: return@Function false
      val enabled = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners") ?: return@Function false
      enabled.split(":").contains(ComponentName(context, MonetaNotificationListenerService::class.java).flattenToString())
    }

    AsyncFunction("openNotificationAccessSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      context.startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      null
    }

    AsyncFunction("getPendingNotifications") {
      MonetaNotificationStore.read(appContext.reactContext)
    }

    AsyncFunction("clearPendingNotification") { notificationId: String ->
      MonetaNotificationStore.remove(appContext.reactContext, notificationId)
      null
    }
  }
}
