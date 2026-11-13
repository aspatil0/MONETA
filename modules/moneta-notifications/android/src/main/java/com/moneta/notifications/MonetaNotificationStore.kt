package com.moneta.notifications

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

object MonetaNotificationStore {
  private const val PREFS = "moneta_notification_store"
  private const val KEY = "pending"

  fun append(context: Context?, packageName: String, title: String, text: String) {
    if (context == null || (title.isBlank() && text.isBlank())) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val items = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
    val item = JSONObject()
      .put("id", UUID.randomUUID().toString())
      .put("packageName", packageName)
      .put("title", title)
      .put("text", text)
      .put("receivedAt", System.currentTimeMillis())
    items.put(item)
    prefs.edit().putString(KEY, items.toString()).apply()
  }

  fun read(context: Context?): List<Map<String, Any>> {
    if (context == null) return emptyList()
    val items = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]")
    return (0 until items.length()).map { index ->
      val item = items.getJSONObject(index)
      mapOf("id" to item.getString("id"), "packageName" to item.optString("packageName"), "title" to item.optString("title"), "text" to item.optString("text"), "receivedAt" to item.optLong("receivedAt"))
    }
  }

  fun remove(context: Context?, id: String) {
    if (context == null) return
    val old = JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]") ?: "[]")
    val next = JSONArray()
    (0 until old.length()).forEach { index ->
      val item = old.getJSONObject(index)
      if (item.optString("id") != id) next.put(item)
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, next.toString()).apply()
  }
}
