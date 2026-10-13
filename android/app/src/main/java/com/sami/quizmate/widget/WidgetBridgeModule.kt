package com.sami.quizmate.widget

import android.content.Context
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.NativeModule
import com.facebook.react.uimanager.ViewManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.glance.appwidget.GlanceAppWidgetManager
import org.json.JSONObject

class QuizMateWidgetBridgeModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "QuizMateWidgetBridge"

  @ReactMethod
  fun updateWidgetData(payload: String, promise: Promise) {
    val prefs = context.getSharedPreferences(QuizMateWidget.PREFS, Context.MODE_PRIVATE)

    /* The widget's hero figure is the attendance for the class the
       student is about to walk into, falling back to the all-subjects
       average - so that is the number the sweep animates, not the
       average alone. Keep this in step with headlinePercent() in
       QuizMateWidget.kt or the bar will animate toward a value the
       widget is not actually showing. */
    val json = runCatching { JSONObject(payload) }.getOrElse { JSONObject() }
    val hasNextClassAttendance = json.optBoolean("hasNextClassAttendance", false)
    val targetPercent =
      if (hasNextClassAttendance) json.optInt("nextClassAttendance", 0).coerceIn(0, 100) else 0
    val previousPercent = prefs.getInt(QuizMateWidget.ANIM_PERCENT_KEY, -1)

    prefs.edit()
      .putString(QuizMateWidget.DATA_KEY, payload)
      .putLong(QuizMateWidget.UPDATED_KEY, System.currentTimeMillis())
      .apply()

    updateAnimatingAttendance(previousPercent, targetPercent, hasNextClassAttendance, promise)
  }

  @ReactMethod
  fun setThemeMode(mode: String, promise: Promise) {
    /* The JS side still calls the follow-the-phone option "system";
       the widget's own cycle control calls it "auto". Normalise on the
       way in so both spellings land on the same stored value. */
    val normalized = if (mode == "system") "auto" else mode

    context.getSharedPreferences(QuizMateWidget.PREFS, Context.MODE_PRIVATE)
      .edit().putString(QuizMateWidget.THEME_KEY, normalized).apply()
    update(promise)
  }

  @ReactMethod
  fun clearWidgetError(promise: Promise) = promise.resolve(null)

  @ReactMethod
  fun setWidgetError(message: String, promise: Promise) = promise.resolve(null)

  private fun update(promise: Promise) {
    CoroutineScope(Dispatchers.Default).launch {
      try {
        val widget = QuizMateWidget()
        GlanceAppWidgetManager(context)
          .getGlanceIds(QuizMateWidget::class.java)
          .forEach { glanceId -> widget.update(context, glanceId) }
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("WIDGET_UPDATE_FAILED", error)
      }
    }
  }

  /* Sweeps the widget's attendance meter from whatever it was last
     showing to the freshly synced value instead of snapping to it. A
     plain AppWidget has no animation API to reach for - this re-renders
     the same RemoteViews several times in quick succession, which is the
     only real way to put motion into a home-screen widget. Skipped on
     the very first push a device ever receives (nothing to sweep from)
     and whenever the number has not actually changed, so this never runs
     needless background work. */
  private fun updateAnimatingAttendance(
    fromPercent: Int,
    toPercent: Int,
    hasAttendance: Boolean,
    promise: Promise,
  ) {
    CoroutineScope(Dispatchers.Default).launch {
      try {
        val prefs = context.getSharedPreferences(QuizMateWidget.PREFS, Context.MODE_PRIVATE)
        val widget = QuizMateWidget()
        val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(QuizMateWidget::class.java)

        val start = if (fromPercent < 0) toPercent else fromPercent

        if (hasAttendance && start != toPercent && glanceIds.isNotEmpty()) {
          val steps = 10
          for (step in 1..steps) {
            val eased = start + ((toPercent - start) * step) / steps
            prefs.edit().putInt(QuizMateWidget.ANIM_PERCENT_KEY, eased).apply()
            glanceIds.forEach { glanceId -> widget.update(context, glanceId) }
            delay(45)
          }
        }

        prefs.edit().putInt(QuizMateWidget.ANIM_PERCENT_KEY, toPercent).apply()
        glanceIds.forEach { glanceId -> widget.update(context, glanceId) }

        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("WIDGET_UPDATE_FAILED", error)
      }
    }
  }
}

class QuizMateWidgetPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(QuizMateWidgetBridgeModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
