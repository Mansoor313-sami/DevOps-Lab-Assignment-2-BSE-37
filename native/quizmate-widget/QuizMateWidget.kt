package com.sami.quizmate.widget

import android.content.Context
import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
/* cornerRadius lives in the appwidget artifact, not in glance.layout -
   it is implemented with RemoteViews outline clipping, which only exists
   on API 31+. Below that it is a silent no-op, which is why the widget's
   real rounding comes from the shape drawables in res/drawable; these
   modifier calls only round the two small solid-colour bars. */
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
/* defaultWeight() is a member of RowScope/ColumnScope, not a top-level
   function, so it is never imported - it resolves from the enclosing
   Row/Column receiver. A composable that wants to use it at its own root
   must declare that receiver itself, as StatTile does below. */
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.sami.quizmate.R
import kotlinx.coroutines.delay
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

class QuizMateWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = QuizMateWidget()
}

/* WIDGET PALETTE
   A widget draws through RemoteViews, not a live Compose tree, so there
   is no elevation API, no backdrop blur, and no gradient modifier. Depth
   here comes from three things instead: a gradient canvas drawable, a
   translucent "glass" card drawable layered over it, and this flat
   colour set for foregrounds. `bgRes`/`glassRes`/`tileRes` point at the
   per-theme drawables in res/drawable - see that folder's README for why
   the theme cannot simply be res/drawable-night. */
private data class WidgetPalette(
  val bgRes: Int,
  val glassRes: Int,
  val tileRes: Int,
  val text: Color,
  val muted: Color,
  val faint: Color,
  val accent: Color,
  val success: Color,
  val warning: Color,
  val danger: Color,
)

/* Everything any size tier might draw, read out of SharedPreferences
   exactly once per composition and passed down - the size-specific
   composables never touch prefs themselves, so they cannot drift out of
   sync with one another. */
private data class WidgetSnapshot(
  val signedIn: Boolean,
  val nextClassName: String,
  val nextClassTime: String,
  val hasNextClassAttendance: Boolean,
  val nextClassAttendance: Int,
  val displayPercent: Int,
  val hasOverallAttendance: Boolean,
  val overallAttendance: Int,
  val pendingTasks: Int,
  val remainingClasses: Int,
  val upcomingExams: Int,
  val nextExamTitle: String,
  val updatedAtLabel: String,
  val storedMode: String,
  val refreshing: Boolean,
  val refreshGlyph: String,
)

class QuizMateWidget : GlanceAppWidget() {
  companion object {
    const val PREFS = "quizmate_widget"
    const val DATA_KEY = "snapshot"
    const val UPDATED_KEY = "updated_at"
    const val THEME_KEY = "theme_mode"
    const val REFRESHING_KEY = "refreshing"
    const val REFRESH_FRAME_KEY = "refresh_frame"

    /* The attendance percentage actually being drawn right now, which
       can lag behind the real value in `snapshot` while it sweeps toward
       it a few points per frame. See WidgetBridgeModule for the driver -
       an AppWidget has no animation API, so "animating" here means
       pushing several real, cheap RemoteViews updates in quick
       succession and letting the eye do the rest. */
    const val ANIM_PERCENT_KEY = "anim_percent"

    /* One control cycles the whole set rather than three separate
       buttons, so the bottom toolbar stays at exactly three elements. */
    val THEME_CYCLE = listOf("auto", "dark", "dim", "light")

    /* One entry per Android home-screen grid tier (dp from the usual
       70dp-per-cell-minus-30dp-gutter formula). Glance measures the real
       placement and renders whichever is the closest match, exposed to
       the composition through LocalSize.current. */
    val SIZE_SMALL = DpSize(110.dp, 40.dp) // 2x1
    val SIZE_MEDIUM = DpSize(250.dp, 40.dp) // 4x1
    val SIZE_LARGE = DpSize(250.dp, 110.dp) // 4x2 - the primary target
    val SIZE_XLARGE = DpSize(320.dp, 110.dp) // 5x2
    val SIZE_XLARGE_TALL = DpSize(320.dp, 180.dp) // 5x3
  }

  override val sizeMode: SizeMode = SizeMode.Responsive(
    setOf(SIZE_SMALL, SIZE_MEDIUM, SIZE_LARGE, SIZE_XLARGE, SIZE_XLARGE_TALL),
  )

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent { WidgetContent() }
  }

  @Composable
  private fun WidgetContent() {
    val context = androidx.glance.LocalContext.current
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val data = runCatching { JSONObject(prefs.getString(DATA_KEY, "{}") ?: "{}") }
      .getOrElse { JSONObject() }

    /* The app's own widget-appearance setting still writes the older
       "system" spelling for follow-the-phone, so treat it as "auto"
       rather than silently falling back and ignoring the user's choice. */
    val storedMode = prefs.getString(THEME_KEY, "auto").orEmpty().let {
      when {
        it == "system" -> "auto"
        THEME_CYCLE.contains(it) -> it
        else -> "auto"
      }
    }
    val palette = paletteFor(resolveMode(context, storedMode))

    val hasNextClassAttendance = data.optBoolean("hasNextClassAttendance", false)
    val nextClassAttendance =
      if (hasNextClassAttendance) data.optInt("nextClassAttendance", 0).coerceIn(0, 100) else 0

    val snapshot = WidgetSnapshot(
      signedIn = data.optBoolean("isSignedIn", false),
      nextClassName = data.optString("nextClassName").trim(),
      nextClassTime = data.optString("nextClassTime").trim(),
      hasNextClassAttendance = hasNextClassAttendance,
      nextClassAttendance = nextClassAttendance,
      displayPercent = if (hasNextClassAttendance) {
        prefs.getInt(ANIM_PERCENT_KEY, nextClassAttendance).coerceIn(0, 100)
      } else 0,
      hasOverallAttendance = data.optBoolean("hasAttendanceData", false),
      overallAttendance = data.optInt("overallAttendance", 0).coerceIn(0, 100),
      pendingTasks = data.optInt("pendingTaskCount", 0),
      remainingClasses = data.optInt("remainingClassCount", 0),
      upcomingExams = data.optInt("upcomingExamCount", 0),
      nextExamTitle = data.optString("soonestExamTitle").trim(),
      updatedAtLabel = updatedLabel(prefs.getLong(UPDATED_KEY, 0L)),
      storedMode = storedMode,
      refreshing = prefs.getBoolean(REFRESHING_KEY, false),
      refreshGlyph = REFRESH_FRAMES[
        prefs.getInt(REFRESH_FRAME_KEY, 0).coerceIn(0, REFRESH_FRAMES.lastIndex)
      ],
    )

    val size = LocalSize.current

    when {
      size.height < 70.dp && size.width < 180.dp -> CompactContent(snapshot, palette)
      size.height < 70.dp -> StripContent(snapshot, palette)
      else -> StandardContent(snapshot, palette, tall = size.height >= 150.dp)
    }
  }

  /* 2x1 - a single headline figure. Anything more would clip. */
  @Composable
  private fun CompactContent(snapshot: WidgetSnapshot, palette: WidgetPalette) {
    val percent = headlinePercent(snapshot)

    Row(
      modifier = GlanceModifier.fillMaxSize()
        .background(ImageProvider(palette.bgRes))
        .padding(horizontal = 12.dp, vertical = 8.dp),
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Column(modifier = GlanceModifier.defaultWeight()) {
        Text(
          "QuizMate",
          maxLines = 1,
          style = TextStyle(color = provider(palette.muted), fontSize = 10.sp, fontWeight = FontWeight.Bold),
        )
        Text(
          if (percent == null) "—" else "$percent%",
          maxLines = 1,
          style = TextStyle(
            color = provider(percent?.let { toneFor(it, palette) } ?: palette.muted),
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
          ),
        )
      }
      RefreshControl(snapshot, palette, compact = true)
    }
  }

  /* 4x1 - one row: headline attendance, then the three counts. */
  @Composable
  private fun StripContent(snapshot: WidgetSnapshot, palette: WidgetPalette) {
    val percent = headlinePercent(snapshot)

    Row(
      modifier = GlanceModifier.fillMaxSize()
        .background(ImageProvider(palette.bgRes))
        .padding(horizontal = 14.dp, vertical = 8.dp),
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Column {
        Text(
          "QuizMate",
          maxLines = 1,
          style = TextStyle(color = provider(palette.muted), fontSize = 10.sp, fontWeight = FontWeight.Bold),
        )
        Text(
          if (percent == null) "—" else "$percent%",
          maxLines = 1,
          style = TextStyle(
            color = provider(percent?.let { toneFor(it, palette) } ?: palette.muted),
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
          ),
        )
      }

      Spacer(modifier = GlanceModifier.defaultWeight())

      InlineCount("◴", snapshot.pendingTasks, palette)
      Spacer(modifier = GlanceModifier.width(12.dp))
      InlineCount("◫", snapshot.remainingClasses, palette)
      Spacer(modifier = GlanceModifier.width(12.dp))
      InlineCount("✎", snapshot.upcomingExams, palette)

      Spacer(modifier = GlanceModifier.width(10.dp))
      RefreshControl(snapshot, palette, compact = true)
    }
  }

  /* 4x2 and larger - the primary design. Header, attendance hero, the
     three counts, then the toolbar. `tall` adds the exam detail line and
     more generous spacing once there is a third grid row to fill. */
  @Composable
  private fun StandardContent(
    snapshot: WidgetSnapshot,
    palette: WidgetPalette,
    tall: Boolean,
  ) {
    Column(
      modifier = GlanceModifier.fillMaxSize()
        .background(ImageProvider(palette.bgRes))
        .padding(horizontal = 14.dp, vertical = 12.dp),
      verticalAlignment = Alignment.Vertical.Top,
    ) {
      Header(palette)

      Spacer(modifier = GlanceModifier.height(if (tall) 12.dp else 9.dp))

      AttendanceHero(snapshot, palette, tall = tall)

      Spacer(modifier = GlanceModifier.height(if (tall) 10.dp else 8.dp))

      Row(modifier = GlanceModifier.fillMaxWidth()) {
        StatTile("◴", snapshot.pendingTasks.toString(), "Tasks", palette, tall)
        Spacer(modifier = GlanceModifier.width(8.dp))
        StatTile("◫", snapshot.remainingClasses.toString(), "Classes", palette, tall)
        Spacer(modifier = GlanceModifier.width(8.dp))
        StatTile("✎", snapshot.upcomingExams.toString(), "Exams", palette, tall)
      }

      if (tall && snapshot.nextExamTitle.isNotBlank()) {
        Spacer(modifier = GlanceModifier.height(9.dp))
        Row(
          modifier = GlanceModifier.fillMaxWidth()
            .background(ImageProvider(palette.glassRes))
            .padding(horizontal = 12.dp, vertical = 9.dp),
          verticalAlignment = Alignment.Vertical.CenterVertically,
        ) {
          Text("✎", style = TextStyle(color = provider(palette.accent), fontSize = 12.sp))
          Spacer(modifier = GlanceModifier.width(8.dp))
          Text(
            snapshot.nextExamTitle,
            modifier = GlanceModifier.defaultWeight(),
            maxLines = 1,
            style = TextStyle(color = provider(palette.text), fontSize = 12.sp, fontWeight = FontWeight.Medium),
          )
        }
      }

      Spacer(modifier = GlanceModifier.defaultWeight())
      Spacer(modifier = GlanceModifier.height(8.dp))

      Toolbar(snapshot, palette)
    }
  }

  @Composable
  private fun Header(palette: WidgetPalette) {
    Row(
      modifier = GlanceModifier.fillMaxWidth(),
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Box(
        modifier = GlanceModifier.width(5.dp).height(18.dp)
          .background(provider(palette.accent))
          .cornerRadius(3.dp),
      ) {}
      Spacer(modifier = GlanceModifier.width(9.dp))
      Text(
        "QuizMate",
        style = TextStyle(color = provider(palette.text), fontSize = 19.sp, fontWeight = FontWeight.Bold),
      )
    }
  }

  /* The one saturated surface in the widget, so the figure a student
     most needs - how their attendance stands for the class they are
     about to walk into - is unambiguously the primary element. */
  @Composable
  private fun AttendanceHero(
    snapshot: WidgetSnapshot,
    palette: WidgetPalette,
    tall: Boolean,
  ) {
    val percent = headlinePercent(snapshot)
    val forNextClass = snapshot.hasNextClassAttendance

    Column(
      modifier = GlanceModifier.fillMaxWidth()
        .background(ImageProvider(R.drawable.widget_hero))
        .padding(horizontal = 14.dp, vertical = if (tall) 13.dp else 11.dp),
    ) {
      Row(
        modifier = GlanceModifier.fillMaxWidth(),
        verticalAlignment = Alignment.Vertical.CenterVertically,
      ) {
        Column(modifier = GlanceModifier.defaultWeight()) {
          Text(
            when {
              !snapshot.signedIn -> "Attendance"
              forNextClass -> "Next class"
              percent != null -> "Overall attendance"
              else -> "Attendance"
            },
            maxLines = 1,
            style = TextStyle(color = provider(HERO_MUTED), fontSize = 11.sp, fontWeight = FontWeight.Medium),
          )
          Spacer(modifier = GlanceModifier.height(2.dp))
          Text(
            when {
              !snapshot.signedIn -> "Open QuizMate to sync"
              forNextClass && snapshot.nextClassName.isNotBlank() ->
                if (snapshot.nextClassTime.isNotBlank()) {
                  "${snapshot.nextClassName} · ${snapshot.nextClassTime}"
                } else {
                  snapshot.nextClassName
                }
              percent != null -> "Across all subjects"
              else -> "No attendance recorded yet"
            },
            maxLines = 1,
            style = TextStyle(color = provider(HERO_TEXT), fontSize = 14.sp, fontWeight = FontWeight.Bold),
          )
        }

        Spacer(modifier = GlanceModifier.width(10.dp))

        Text(
          if (percent == null) "—" else "$percent%",
          style = TextStyle(color = provider(HERO_TEXT), fontSize = if (tall) 30.sp else 26.sp, fontWeight = FontWeight.Bold),
        )
      }

      if (percent != null) {
        Spacer(modifier = GlanceModifier.height(if (tall) 10.dp else 8.dp))
        SegmentedMeter(snapshot.displayPercentOrValue(percent), heroToneFor(percent))
      }
    }
  }

  /* Glance has no fractional-width modifier (Row weighting only splits
     children evenly), so a continuously-sized fill bar is not
     expressible. A segmented meter is the closest achievable thing - and
     filling one more segment per animation frame is also what makes the
     sweep readable rather than a single jump to the new value. */
  @Composable
  private fun SegmentedMeter(percent: Int, tone: Color) {
    val filled = (percent / 100f * METER_SEGMENTS).roundToInt().coerceIn(0, METER_SEGMENTS)

    Row(modifier = GlanceModifier.fillMaxWidth()) {
      for (index in 0 until METER_SEGMENTS) {
        if (index > 0) {
          Spacer(modifier = GlanceModifier.width(3.dp))
        }
        Box(
          modifier = GlanceModifier.defaultWeight().height(6.dp)
            .background(provider(if (index < filled) tone else HERO_TRACK))
            .cornerRadius(3.dp),
        ) {}
      }
    }
  }

  /* RowScope receiver so defaultWeight() below resolves - the three
     tiles share the row evenly. Without the receiver the scope of the
     caller's Row does not reach into this function body. */
  @Composable
  private fun RowScope.StatTile(
    glyph: String,
    value: String,
    label: String,
    palette: WidgetPalette,
    tall: Boolean,
  ) {
    Column(
      modifier = GlanceModifier.defaultWeight()
        .background(ImageProvider(palette.tileRes))
        .padding(horizontal = 10.dp, vertical = if (tall) 10.dp else 8.dp),
    ) {
      Row(verticalAlignment = Alignment.Vertical.CenterVertically) {
        Text(glyph, style = TextStyle(color = provider(palette.accent), fontSize = 11.sp))
        Spacer(modifier = GlanceModifier.width(5.dp))
        Text(
          label,
          maxLines = 1,
          style = TextStyle(color = provider(palette.muted), fontSize = 10.sp, fontWeight = FontWeight.Medium),
        )
      }
      Spacer(modifier = GlanceModifier.height(3.dp))
      Text(
        value,
        style = TextStyle(color = provider(palette.text), fontSize = if (tall) 21.sp else 19.sp, fontWeight = FontWeight.Bold),
      )
    }
  }

  @Composable
  private fun InlineCount(glyph: String, value: Int, palette: WidgetPalette) {
    Column(horizontalAlignment = Alignment.Horizontal.CenterHorizontally) {
      Text(glyph, style = TextStyle(color = provider(palette.accent), fontSize = 10.sp))
      Text(
        value.toString(),
        style = TextStyle(color = provider(palette.text), fontSize = 14.sp, fontWeight = FontWeight.Bold),
      )
    }
  }

  /* Exactly three elements, as specified: mode cycle, updated text,
     refresh. The widget container itself carries no launch action. */
  @Composable
  private fun Toolbar(snapshot: WidgetSnapshot, palette: WidgetPalette) {
    Row(
      modifier = GlanceModifier.fillMaxWidth(),
      verticalAlignment = Alignment.Vertical.CenterVertically,
    ) {
      Text(
        modeGlyph(snapshot.storedMode),
        modifier = GlanceModifier
          .background(ImageProvider(palette.tileRes))
          .clickable(actionRunCallback<CycleThemeAction>())
          .padding(horizontal = 9.dp, vertical = 6.dp),
        style = TextStyle(color = provider(palette.accent), fontSize = 13.sp, fontWeight = FontWeight.Bold),
      )

      Text(
        snapshot.updatedAtLabel,
        modifier = GlanceModifier.defaultWeight().padding(horizontal = 8.dp),
        maxLines = 1,
        style = TextStyle(
          color = provider(palette.faint),
          fontSize = 10.sp,
          textAlign = TextAlign.Center,
        ),
      )

      RefreshControl(snapshot, palette, compact = false)
    }
  }

  @Composable
  private fun RefreshControl(
    snapshot: WidgetSnapshot,
    palette: WidgetPalette,
    compact: Boolean,
  ) {
    Text(
      if (snapshot.refreshing) snapshot.refreshGlyph else "↻",
      modifier = GlanceModifier
        .background(ImageProvider(palette.tileRes))
        .clickable(actionRunCallback<RefreshWidgetAction>())
        .padding(horizontal = 9.dp, vertical = 6.dp),
      style = TextStyle(
        color = provider(if (snapshot.refreshing) palette.accent else palette.muted),
        fontSize = if (compact) 12.sp else 13.sp,
        fontWeight = FontWeight.Bold,
      ),
    )
  }
}

/* Falls back to the all-subjects average when the next class has no
   attendance record of its own (or when there is no next class at all),
   so the hero is only ever blank for an account with no data anywhere. */
private fun headlinePercent(snapshot: WidgetSnapshot): Int? = when {
  !snapshot.signedIn -> null
  snapshot.hasNextClassAttendance -> snapshot.nextClassAttendance
  snapshot.hasOverallAttendance -> snapshot.overallAttendance
  else -> null
}

/* Only the next-class figure is animated - the overall average is a
   fallback and sweeping it would imply a precision it does not have. */
private fun WidgetSnapshot.displayPercentOrValue(percent: Int): Int =
  if (hasNextClassAttendance) displayPercent else percent

private const val METER_SEGMENTS = 12

private val REFRESH_FRAMES = listOf("◜", "◝", "◞", "◟")

/* Foreground colours for the accent hero. Fixed rather than per-theme:
   the hero gradient is the same in every mode, so its text must be too. */
private val HERO_TEXT = Color(0xFFFFFFFF)
private val HERO_MUTED = Color(0xCCFFFFFF)
private val HERO_TRACK = Color(0x40FFFFFF)

/* Lighter than the body palette's equivalents, because these sit on the
   saturated hero gradient rather than on a near-white or near-black
   surface - the darker theme tones would read as muddy against it, and
   the meter would lose the at-a-glance safe/at-risk signal entirely. */
private fun heroToneFor(percent: Int): Color = when {
  percent >= 80 -> Color(0xFF6EE7A8)
  percent >= 60 -> Color(0xFFFCD34D)
  else -> Color(0xFFFCA5A5)
}

class RefreshWidgetAction : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val prefs = context.getSharedPreferences(QuizMateWidget.PREFS, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(QuizMateWidget.REFRESHING_KEY, true).apply()
    // A home-screen widget cannot host a continuous animation - there is
    // no animation API on RemoteViews. Pushing a few real render frames
    // in quick succession is the only way to show motion, and it never
    // wakes or opens the host app.
    repeat(8) { frame ->
      prefs.edit().putInt(QuizMateWidget.REFRESH_FRAME_KEY, frame % 4).apply()
      QuizMateWidget().update(context, glanceId)
      delay(110)
    }
    prefs.edit().putBoolean(QuizMateWidget.REFRESHING_KEY, false)
      .putInt(QuizMateWidget.REFRESH_FRAME_KEY, 0)
      .putLong(QuizMateWidget.UPDATED_KEY, System.currentTimeMillis()).apply()
    QuizMateWidget().update(context, glanceId)
  }
}

/* Advances auto -> dark -> dim -> light -> auto. The intermediate render
   is what gives the switch a visible transition instead of an instant
   swap; without it the change reads as a flicker. */
class CycleThemeAction : ActionCallback {
  override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
    val prefs = context.getSharedPreferences(QuizMateWidget.PREFS, Context.MODE_PRIVATE)
    val current = prefs.getString(QuizMateWidget.THEME_KEY, "auto").orEmpty()
    val normalized = if (current == "system") "auto" else current
    val index = QuizMateWidget.THEME_CYCLE.indexOf(normalized).let { if (it < 0) 0 else it }
    val next = QuizMateWidget.THEME_CYCLE[(index + 1) % QuizMateWidget.THEME_CYCLE.size]

    prefs.edit().putString(QuizMateWidget.THEME_KEY, next).apply()
    QuizMateWidget().update(context, glanceId)
  }
}

private fun provider(color: Color) = ColorProvider(color)

private fun modeGlyph(storedMode: String): String = when (storedMode) {
  "light" -> "☀"
  "dim" -> "◐"
  "dark" -> "☾"
  else -> "◑"
}

/* "auto" is resolved against the system night setting at render time, so
   the widget follows the phone's theme without the app having to push a
   new snapshot when the system flips. */
private fun resolveMode(context: Context, storedMode: String): String {
  if (storedMode != "auto") {
    return storedMode
  }

  val night = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK

  return if (night == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
}

private fun toneFor(percent: Int, palette: WidgetPalette): Color = when {
  percent >= 80 -> palette.success
  percent >= 60 -> palette.warning
  else -> palette.danger
}

private fun paletteFor(mode: String): WidgetPalette = when (mode) {
  "dark" -> WidgetPalette(
    bgRes = R.drawable.widget_bg_dark,
    glassRes = R.drawable.widget_glass_dark,
    tileRes = R.drawable.widget_tile_dark,
    text = Color(0xFFF6F8FF), muted = Color(0xFFAEB8D4), faint = Color(0xFF7D88A6),
    accent = Color(0xFF9F8CFF),
    success = Color(0xFF3ADFA0), warning = Color(0xFFFBBF24), danger = Color(0xFFF87171),
  )
  "dim" -> WidgetPalette(
    bgRes = R.drawable.widget_bg_dim,
    glassRes = R.drawable.widget_glass_dim,
    tileRes = R.drawable.widget_tile_dim,
    text = Color(0xFFF8F9FD), muted = Color(0xFFC3CBDA), faint = Color(0xFF97A1B5),
    accent = Color(0xFFB4A4FF),
    success = Color(0xFF4BD58D), warning = Color(0xFFF7C873), danger = Color(0xFFF2867E),
  )
  else -> WidgetPalette(
    bgRes = R.drawable.widget_bg_light,
    glassRes = R.drawable.widget_glass_light,
    tileRes = R.drawable.widget_tile_light,
    text = Color(0xFF141830), muted = Color(0xFF636B84), faint = Color(0xFF8B93A8),
    accent = Color(0xFF6D4AFF),
    success = Color(0xFF15A661), warning = Color(0xFFD98008), danger = Color(0xFFDC2626),
  )
}

private fun updatedLabel(updatedAt: Long): String {
  if (updatedAt <= 0L) return "Not synced yet"
  val minutes = max(0L, (System.currentTimeMillis() - updatedAt) / 60_000L)
  return when {
    minutes < 1L -> "Updated just now"
    minutes == 1L -> "Updated 1 min ago"
    minutes < 60L -> "Updated $minutes min ago"
    minutes < 120L -> "Updated 1 hr ago"
    minutes < 1_440L -> "Updated ${minutes / 60L} hr ago"
    minutes < 2_880L -> "Updated yesterday"
    else -> "Updated ${minutes / 1_440L} d ago"
  }
}
