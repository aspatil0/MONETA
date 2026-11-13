package com.moneta.notifications

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class MonetaNotificationListenerService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    val extras = sbn.notification.extras
    val title = extras?.getCharSequence("android.title")?.toString() ?: ""
    val text = buildNotificationText(extras)
    if (title.isBlank() && text.isBlank()) return
    val message = "$title $text"
    if (!isRelevantPackage(sbn.packageName) && !isFinancialNotification(message)) return
    if (!isBankTransaction(message)) return
    MonetaNotificationStore.append(this, sbn.packageName, title, text)
  }

  private fun buildNotificationText(extras: android.os.Bundle?): String {
    if (extras == null) return ""
    val parts = mutableListOf<String>()
    extras.getCharSequence("android.text")?.toString()?.let(parts::add)
    extras.getCharSequence("android.bigText")?.toString()?.let(parts::add)
    extras.getCharSequence("android.subText")?.toString()?.let(parts::add)
    extras.getCharSequenceArray("android.textLines")?.forEach { parts.add(it.toString()) }
    return parts.filter { it.isNotBlank() }.distinct().joinToString(" ")
  }

  private fun isRelevantPackage(packageName: String) =
    packageName.contains("google.android.apps.nbu.paisa.user") ||
      packageName.contains("phonepe") ||
      packageName.contains("paytm") ||
      packageName.contains("mobikwik") ||
      packageName.contains("bank") ||
      packageName.contains("messaging") ||
      packageName.contains("messages") ||
      packageName.contains("sms") ||
      packageName.contains("mms")

  private fun isFinancialNotification(value: String): Boolean {
    val normalized = value.lowercase()
    return normalized.contains("upi") ||
      normalized.contains("debited") ||
      normalized.contains("credited") ||
      normalized.contains("received") ||
      normalized.contains("spent") ||
      normalized.contains("withdrawn") ||
      normalized.contains("paid") ||
      normalized.contains("rs.") ||
      normalized.contains("inr") ||
      normalized.contains("₹")
  }

  private fun isBankTransaction(value: String): Boolean {
    val normalized = value.lowercase()
    val hasAmount = Regex("""(?:rs\.?|inr|₹)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?""").containsMatchIn(normalized)
    val hasTransactionAction = Regex("""\b(debited|debit|spent|withdrawn|paid|sent|transferred|credited|credit|received|deposited)\b""").containsMatchIn(normalized)
    val hasPaymentEvidence = Regex("""\b(upi|bank|boi|sbi|hdfc|icici|axis|kotak|pnb|canara|union|paytm|phonepe|gpay|a/c|account|acct|avl\.?\s*bal(?:ance)?|available\s+balance|transaction|txn|ref(?:erence)?|utr|neft|imps|card)\b""").containsMatchIn(normalized)
    return hasAmount && hasTransactionAction && hasPaymentEvidence
  }
}
