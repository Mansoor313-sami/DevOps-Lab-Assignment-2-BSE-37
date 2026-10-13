/**
 * widgetBridge.js
 * ===============
 * The single JS file responsible for keeping the Android home-screen
 * widget in sync with the app's data.
 *
 * How it fits in
 * --------------
 * The widget (Jetpack Glance) cannot access React Native state or
 * AsyncStorage. Instead:
 *
 *   1. The app computes its rich HomeScreen stats on the JS side.
 *   2. After a successful data load, HomeScreen calls `pushWidgetData()`
 *      with a snapshot of those stats.
 *   3. This module serialises the snapshot to JSON and passes it through
 *      the native bridge (WidgetBridgeModule.kt → SharedPreferences).
 *   4. The native widget re-renders immediately using the fresh data.
 *
 * The bridge is Android-only and behind a Platform.OS guard, so the
 * same JS codebase runs on iOS and web without any errors.
 *
 * Shape contract
 * --------------
 * The JSON keys here must match the @SerializedName annotations in
 * WidgetData.kt exactly. Both sides are additive-safe: new fields added
 * to this object are ignored by an older widget, and new fields added
 * to WidgetData.kt get their safe default values if the JS side hasn't
 * sent them yet.
 *
 * Error handling
 * --------------
 * The bridge is best-effort. A failure to update the widget is logged
 * but never propagates up to the caller — it must never interfere with
 * the app's main data flow or UX.
 */

import { NativeModules, Platform } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

export const WIDGET_THEME_PREFERENCE_KEY =
  'quizmate_widget_theme_mode';

export const WIDGET_THEME_MODES = [
  'system',
  'light',
  'dark',
  'dim',
];

/** True when the native bridge module is available on this platform. */
const isAvailable =
  Platform.OS === 'android' &&
  !!NativeModules.QuizMateWidgetBridge;

/**
 * Push a fresh data snapshot to the Android home-screen widget.
 *
 * Call this once after every successful data load (Firebase fetch or
 * pull-to-refresh). Calling it with identical data is harmless — the
 * widget only re-renders if the underlying SharedPreferences value
 * actually changes.
 *
 * @param {object} params - Data sourced from HomeScreen's computed state.
 * @param {object|null} params.currentUser - The signed-in user object.
 * @param {number|null} params.averageAttendance - Overall attendance % (0-100).
 * @param {Array}  params.riskySubjects - Subjects below the threshold.
 * @param {Array}  params.subjects - All active subjects.
 * @param {Array}  params.todayClasses - Classes scheduled for today.
 * @param {object|null} params.nextClass - The next upcoming class (from classes[0]).
 * @param {Array}  params.pending - All pending tasks.
 * @param {Array}  params.overdueTasks - Overdue tasks with .info attached.
 * @param {Array}  params.upcomingTasks - Upcoming tasks with .info attached.
 * @param {object|null} params.nextPaper - The next exam from the date sheet.
 * @param {string} params.paperCountdownLabel - Formatted countdown for nextPaper.
 * @param {Date}   params.now - The current clock value.
 */
export async function pushWidgetData({
  currentUser,
  averageAttendance,
  riskySubjects = [],
  subjects = [],
  attendanceSummary = [],
  todayClasses = [],
  nextClass = null,
  pending = [],
  overdueTasks = [],
  upcomingTasks = [],
  upcomingPapers = [],
  nextPaper = null,
  paperCountdownLabel = '',
  now = new Date(),
}) {
  if (!isAvailable) return;

  try {
    // ── Identity / meta ──────────────────────────────────────────────
    const isSignedIn = !!currentUser?.id;
    const displayName = currentUser?.name || '';
    const semester = currentUser?.semester || '';

    // ── Attendance ───────────────────────────────────────────────────
    const overallAttendance =
      typeof averageAttendance === 'number'
        ? Math.round(Math.max(0, Math.min(100, averageAttendance)))
        : 0;
    const hasAttendanceData =
      typeof averageAttendance === 'number';
    const atRiskCount = riskySubjects.length;
    const subjectCount = subjects.length;

    // ── Today's schedule ─────────────────────────────────────────────
    const todayClassCount = todayClasses.length;

    // Find today's upcoming (not yet started) classes to find "next".
    // todayClasses are sorted by startsAt. nextClass from the classes
    // array is the next class across all days; we prefer to show the
    // next one specifically from today while the day is still active.
    const nowTime = now.getTime();
    const nextTodayClass =
      todayClasses.find((c) => {
        const t = c.startsAt instanceof Date
          ? c.startsAt.getTime()
          : new Date(c.startsAt).getTime();
        return t > nowTime;
      }) || null;

    // Fall back to the global nextClass if today has nothing left.
    const upcomingClass = nextTodayClass || nextClass;

    const nextClassName = upcomingClass?.subjectName || '';
    const nextClassTime = upcomingClass?.timeLabel || '';

    // ── Next class's own attendance ──────────────────────────────────
    // The widget leads with the attendance for the class the student is
    // actually about to walk into, which is far more actionable than the
    // all-subjects average. attendanceSummary entries are the subject
    // object spread together with getAttendanceStats(), so they carry
    // both `id` and `percentage`/`hasRecord`.
    const nextClassStats =
      upcomingClass?.subjectId
        ? attendanceSummary.find(
            (entry) => entry.id === upcomingClass.subjectId
          )
        : null;

    const hasNextClassAttendance =
      !!nextClassStats && nextClassStats.hasRecord === true;

    const nextClassAttendance =
      hasNextClassAttendance
        ? Math.round(
            Math.max(0, Math.min(100, nextClassStats.percentage || 0))
          )
        : 0;

    // Classes still ahead today, so "pending classes" means what is left
    // to attend rather than how many the day contained in total.
    const remainingClassCount =
      todayClasses.filter((item) => {
        const startsAt =
          item.startsAt instanceof Date
            ? item.startsAt.getTime()
            : new Date(item.startsAt).getTime();

        return Number.isFinite(startsAt) && startsAt > nowTime;
      }).length;

    // ── Task deadlines ───────────────────────────────────────────────
    const pendingTaskCount = pending.length;

    // Most urgent = overdue first (most overdue at top), then upcoming.
    const soonestTask =
      overdueTasks.length > 0
        ? overdueTasks[0]
        : upcomingTasks.length > 0
          ? upcomingTasks[0]
          : null;

    const soonestTaskTitle = soonestTask?.title || '';
    const soonestTaskDue = soonestTask?.info?.label || '';
    const soonestTaskUrgency = soonestTask?.info?.tone || '';

    // ── Exams / date sheets ──────────────────────────────────────────
    const upcomingExamCount = Array.isArray(upcomingPapers)
      ? upcomingPapers.length
      : nextPaper ? 1 : 0;
    const soonestExamTitle = nextPaper?.subjectName || '';
    // Use the existing countdown label if the exam is imminent,
    // otherwise use the formatted date label from the paper object.
    const soonestExamDate =
      paperCountdownLabel ||
      (nextPaper
        ? `${nextPaper.dateLabel || ''}${nextPaper.timeLabel ? ` at ${nextPaper.timeLabel}` : ''}`
        : '');
    const soonestExamUrgency = nextPaper
      ? _examUrgency(nextPaper, now)
      : '';

    // ── Summary line ─────────────────────────────────────────────────
    const summaryLine = _buildSummaryLine({
      todayClassCount,
      nextTodayClass,
      pendingTaskCount,
      soonestTaskDue,
    });

    // ── Build payload ────────────────────────────────────────────────
    const payload = {
      displayName,
      semester,
      updatedAt: Date.now(),
      isSignedIn,
      overallAttendance,
      hasAttendanceData,
      atRiskCount,
      subjectCount,
      todayClassCount,
      remainingClassCount,
      nextClassTime,
      nextClassName,
      nextClassAttendance,
      hasNextClassAttendance,
      pendingTaskCount,
      soonestTaskTitle,
      soonestTaskDue,
      soonestTaskUrgency,
      upcomingExamCount,
      soonestExamTitle,
      soonestExamDate,
      soonestExamUrgency,
      summaryLine,
    };

    await NativeModules.QuizMateWidgetBridge.updateWidgetData(
      JSON.stringify(payload)
    );
  } catch (err) {
    // Best-effort: never crash the app for a widget update failure.
    if (__DEV__) {
      console.warn('[WidgetBridge] pushWidgetData failed:', err);
    }
  }
}

/**
 * Clear any error state from the widget (e.g. after a successful
 * data refresh that previously failed). Safe to call speculatively.
 */
export async function clearWidgetError() {
  if (!isAvailable) return;
  try {
    await NativeModules.QuizMateWidgetBridge.clearWidgetError();
  } catch (err) {
    if (__DEV__) {
      console.warn('[WidgetBridge] clearWidgetError failed:', err);
    }
  }
}

/**
 * Retain the last useful snapshot when an app-level data refresh fails.
 * This is deliberately a short, non-sensitive state marker; no Firebase
 * credentials or error details are ever copied into widget storage.
 */
export async function setWidgetError(message = 'offline') {
  if (!isAvailable) return;
  try {
    await NativeModules.QuizMateWidgetBridge.setWidgetError(
      String(message).slice(0, 80)
    );
  } catch (err) {
    if (__DEV__) {
      console.warn('[WidgetBridge] setWidgetError failed:', err);
    }
  }
}

/** Read the device-local appearance choice for the Android widget. */
export async function getWidgetThemePreference() {
  try {
    const saved = await AsyncStorage.getItem(
      WIDGET_THEME_PREFERENCE_KEY
    );

    return WIDGET_THEME_MODES.includes(saved)
      ? saved
      : 'system';
  } catch (err) {
    return 'system';
  }
}

/**
 * Save and immediately apply the widget's local appearance. iOS and web
 * still persist the preference harmlessly; their native call is a no-op.
 */
export async function setWidgetThemePreference(mode) {
  const safeMode = WIDGET_THEME_MODES.includes(mode)
    ? mode
    : 'system';

  await AsyncStorage.setItem(
    WIDGET_THEME_PREFERENCE_KEY,
    safeMode
  );

  if (!isAvailable) return safeMode;

  try {
    await NativeModules.QuizMateWidgetBridge.setThemeMode(safeMode);
  } catch (err) {
    if (__DEV__) {
      console.warn('[WidgetBridge] setWidgetThemePreference failed:', err);
    }
  }

  return safeMode;
}

/* ------------------------------------------------------------------ *
 *  PRIVATE HELPERS                                                   *
 * ------------------------------------------------------------------ */

/**
 * Map an exam's proximity to a JS-style urgency tone so the widget
 * chip colour matches what the Deadline card inside the app shows.
 * Returns one of: "overdue" | "today" | "urgent" | "soon" | "later"
 */
function _examUrgency(paper, now) {
  const examDate = paper?.examDate || paper?.nextDate;

  if (!examDate) return 'later';

  const ms =
    new Date(examDate).getTime() - new Date(now).getTime();

  if (ms < 0) return 'overdue';
  if (ms < 3_600_000) return 'today';           // < 1h
  if (ms < 86_400_000) return 'urgent';         // < 24h
  if (ms < 3 * 86_400_000) return 'urgent';     // < 3 days
  if (ms < 7 * 86_400_000) return 'soon';       // < 7 days
  return 'later';
}

/**
 * Build a one-line contextual summary displayed as a footer on the
 * Large widget layout. Prioritises the most actionable fact.
 */
function _buildSummaryLine({
  todayClassCount,
  nextTodayClass,
  pendingTaskCount,
  soonestTaskDue,
}) {
  if (nextTodayClass) {
    const remaining =
      todayClassCount -
      /* classes after next one */ 0; // we just show total left
    return `${todayClassCount} ${todayClassCount === 1 ? 'class' : 'classes'} today`;
  }

  if (pendingTaskCount > 0 && soonestTaskDue) {
    return `Next deadline: ${soonestTaskDue}`;
  }

  if (pendingTaskCount > 0) {
    return `${pendingTaskCount} pending ${pendingTaskCount === 1 ? 'task' : 'tasks'}`;
  }

  return '';
}
