import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  SafeAreaView,
  StatusBar,
  Platform,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Easing,
  AppState,
  AccessibilityInfo,
  LayoutAnimation,
  UIManager,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import {
  CARD_RADIUS,
  HEADER_TOP_PADDING,
  MAX_CONTENT_WIDTH,
  SCREEN_BOTTOM_PADDING,
  SCREEN_PADDING,
  SHADOW,
  TYPOGRAPHY,
  useResponsive,
} from '../constants/layout';

import {
  useTheme,
} from '../context/ThemeContext';

import {
  useToast,
} from '../context/ToastContext';

import {
  SkeletonBlock,
  SkeletonList,
} from '../components/Skeleton';

import {
  AnimatedBar,
  CountUp,
  ProgressRing,
} from '../components/AnimatedStats';

import {
  FloatingParticles,
  Sheen,
} from '../components/Decor';

import {
  loadAllUserTasks,
  loadUserAttendance,
  loadUserClassSchedules,
  loadUserDateSheets,
} from '../utils/localData';

import {
  onDataChanged,
} from '../utils/dataEvents';

import {
  ATTENDANCE_THRESHOLD,
  buildClassAttendanceRecord,
  getAttendanceDateKey,
  getAttendanceStats,
  getAttendanceTone,
  getClassAttendanceRecord,
  persistAttendance as persistAttendanceWithReminders,
} from '../utils/attendance';

import {
  getAttendanceWindowState,
  getExamState,
  getExamWindow,
  getNextClassOccurrence,
  getScheduleDuration,
  getScheduleTimeOnDate,
  isClassOngoingAt,
  isScheduleOnDate,
} from '../utils/schedules';

/* Feeds the Android home-screen widget. Android-only and fully
   guarded inside the util, so importing it on iOS/web is a no-op. */

import {
  pushWidgetData,
  setWidgetError,
} from '../utils/widgetBridge';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* Firebase is polled slowly because the data rarely changes.
   The clock is ticked separately and quickly, because "is this
   class running now" changes without any data changing. */

const POLL_INTERVAL = 180000;

const CLOCK_TICK = 30000;

const MONTHS = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

const easeNext = (duration = 220) =>
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      duration,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity
    )
  );

/* ------------------------------------------------------------------
   CLASSES
------------------------------------------------------------------ */

const buildClassList = (
  subjects,
  classScheduleMap,
  now = new Date()
) => {

  const all = [];

  subjects.forEach((subject) => {

    const schedules =
      Object.values(
        classScheduleMap[subject.id] || {}
      ).filter((schedule) => schedule.isActive !== false);

    schedules.forEach((schedule) => {
      all.push({
        ...schedule,
        key: `${subject.id}_${schedule.id}`,
        subjectId: subject.id,
        subjectName: subject.name,
        subjectType: subject.type,
        durationMinutes: getScheduleDuration(schedule),
        nextDate: getNextClassOccurrence(schedule, now),
      });
    });
  });

  return all.sort(
    (first, second) =>
      first.nextDate - second.nextDate
  );
};

/* Today's list is built from the weekday, not from the next
   occurrence. A class that finished this morning must still be
   listed today so it can be marked. */

const buildTodayClassList = (
  subjects,
  classScheduleMap,
  now = new Date()
) => {

  const all = [];

  subjects.forEach((subject) => {

    Object.values(classScheduleMap[subject.id] || {})
      .filter(
        (schedule) =>
          schedule.isActive !== false &&
          isScheduleOnDate(schedule, now)
      )
      .forEach((schedule) => {
        all.push({
          ...schedule,
          key: `${subject.id}_${schedule.id}`,
          subjectId: subject.id,
          subjectName: subject.name,
          subjectType: subject.type,
          durationMinutes: getScheduleDuration(schedule),
          startsAt: getScheduleTimeOnDate(schedule, now),
        });
      });
  });

  return all.sort(
    (first, second) => first.startsAt - second.startsAt
  );
};

const isSameDay = (first, second) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

/* ------------------------------------------------------------------
   DEADLINES
------------------------------------------------------------------ */

const parseDeadlineDate = (taskOrDeadline) => {
  const task =
    typeof taskOrDeadline === 'object' && taskOrDeadline
      ? taskOrDeadline
      : null;

  const deadlineAt = task?.deadlineAt;

  if (deadlineAt) {
    const isoDate = new Date(deadlineAt);

    if (!Number.isNaN(isoDate.getTime())) {
      isoDate.setHours(0, 0, 0, 0);
      return isoDate;
    }
  }

  const deadline = task ? task.deadline : taskOrDeadline;

  const parts = (deadline || '').split(' ');

  const monthIndex =
    MONTHS.indexOf(parts[1]);

  const parsed = new Date(
    Number(parts[2]),
    monthIndex,
    Number(parts[0])
  );

  return Number.isNaN(parsed.getTime()) ||
    monthIndex < 0
    ? null
    : parsed;
};

const startOfToday = () => {

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
};

const formatDueTime = (date) =>
  new Date(date).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

/* Classifies a deadline so the badge can show real urgency
   instead of painting everything red. */

/* When a task carries a real due time, "today" is refined into how
   much of today is actually left, so an 11:59 PM deadline does not
   look as urgent at 9 AM as one due in twenty minutes. */

const getExactDueDate = (task) => {

  if (!task || typeof task !== 'object') {
    return null;
  }

  if (task.deadlineAt) {
    const exact = new Date(task.deadlineAt);

    if (!Number.isNaN(exact.getTime())) {
      const hasTimeComponent =
        exact.getHours() !== 0 ||
        exact.getMinutes() !== 0;

      return hasTimeComponent ? exact : null;
    }
  }

  return null;
};

const getDeadlineInfo = (taskOrDeadline, now = new Date()) => {

  const deadline =
    typeof taskOrDeadline === 'object' && taskOrDeadline
      ? taskOrDeadline.deadline
      : taskOrDeadline;

  const parsed = parseDeadlineDate(taskOrDeadline);

  if (!parsed) {
    return {
      daysLeft: null,
      isOverdue: false,
      tone: 'neutral',
      label: deadline || 'No date',
    };
  }

  const today = startOfToday();

  const daysLeft =
    Math.round(
      (parsed.getTime() - today.getTime()) / 86400000
    );

  if (daysLeft < 0) {
    return {
      daysLeft,
      isOverdue: true,
      tone: 'overdue',
      label:
        daysLeft === -1
          ? 'Yesterday'
          : `${Math.abs(daysLeft)} days ago`,
    };
  }

  if (daysLeft === 0) {

    const exact =
      getExactDueDate(taskOrDeadline);

    if (exact) {

      const remaining =
        exact.getTime() - new Date(now).getTime();

      if (remaining <= 0) {
        return {
          daysLeft,
          isOverdue: true,
          tone: 'overdue',
          label: 'Overdue today',
          dueTimeLabel: formatDueTime(exact),
        };
      }

      const minutes = Math.floor(remaining / 60000);

      return {
        daysLeft,
        isOverdue: false,
        tone: 'today',
        label:
          minutes < 60
            ? `Due in ${Math.max(minutes, 1)} min`
            : `Due in ${Math.floor(minutes / 60)}h`,
        dueTimeLabel: formatDueTime(exact),
      };
    }

    return {
      daysLeft,
      isOverdue: false,
      tone: 'today',
      label: 'Today',
    };
  }

  if (daysLeft === 1) {
    return {
      daysLeft,
      isOverdue: false,
      tone: 'urgent',
      label: 'Tomorrow',
    };
  }

  if (daysLeft <= 3) {
    return {
      daysLeft,
      isOverdue: false,
      tone: 'urgent',
      label: `In ${daysLeft} days`,
    };
  }

  if (daysLeft <= 7) {
    return {
      daysLeft,
      isOverdue: false,
      tone: 'soon',
      label: `In ${daysLeft} days`,
    };
  }

  return {
    daysLeft,
    isOverdue: false,
    tone: 'later',
    label: deadline,
  };
};

const getToneColors = (tone, colors, isDarkMode) => {

  const map = {
    overdue: colors.danger,
    today: colors.danger,
    urgent: colors.warning,
    soon: colors.secondary,
    later: colors.textLight,
    neutral: colors.textLight,
  };

  const base = map[tone] || colors.textLight;

  return {
    text: base,
    background: isDarkMode
      ? `${base}26`
      : `${base}1F`,
  };
};

/* ------------------------------------------------------------------
   PAPERS
------------------------------------------------------------------ */

/* A paper that has already started is still the paper you care
   about, so ongoing exams are kept and flagged rather than
   filtered out the moment they begin. */

const findNextPaper = (papers, now = new Date()) => {

  return (
    (papers || [])
      .filter((paper) => paper.isArchived !== true)
      .map((paper) => {
        const window = getExamWindow(paper);

        return window
          ? {
              ...paper,
              nextDate: window.start,
              endsAt: window.end,
              examState: getExamState(paper, now),
            }
          : null;
      })
      .filter(
        (paper) =>
          paper && paper.examState !== 'ended'
      )
      .sort(
        (first, second) =>
          first.nextDate - second.nextDate
      )[0] || null
  );
};

/* Countdowns round down to the unit actually reached, so "in 2
   hours" never appears while 1h 31m is still on the clock. */

const formatCountdown = (date, now = new Date()) => {

  const diff =
    new Date(date).getTime() - new Date(now).getTime();

  if (diff <= 0) {
    return 'Now';
  }

  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return 'In under a minute';
  }

  if (minutes < 60) {
    return `In ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;

  if (hours < 24) {
    return remainderMinutes === 0
      ? `In ${hours}h`
      : `In ${hours}h ${remainderMinutes}m`;
  }

  const days = Math.floor(hours / 24);

  if (days === 1) {
    return 'Tomorrow';
  }

  return `In ${days} days`;
};

/* ------------------------------------------------------------------
   GREETING + STREAK + TIP
------------------------------------------------------------------ */

const getGreeting = (now = new Date()) => {

  const hour = new Date(now).getHours();

  if (hour < 5) {
    return 'Still up';
  }

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 17) {
    return 'Good afternoon';
  }

  if (hour < 21) {
    return 'Good evening';
  }

  return 'Good night';
};

/* Counts back from today over the distinct days on which any
   attendance was recorded. */

const computeStreak = (attendanceMap) => {

  const days = new Set();

  Object.values(attendanceMap || {}).forEach(
    (attendance) => {

      (attendance?.records || []).forEach((record) => {

        const date = new Date(record.createdAt);

        if (!Number.isNaN(date.getTime())) {
          date.setHours(0, 0, 0, 0);
          days.add(date.getTime());
        }
      });
    }
  );

  if (days.size === 0) {
    return 0;
  }

  let streak = 0;

  const cursor = startOfToday();

  /* Yesterday still counts, so a streak is not lost before
     the current day is over. */

  if (!days.has(cursor.getTime())) {
    cursor.setDate(cursor.getDate() - 1);

    if (!days.has(cursor.getTime())) {
      return 0;
    }
  }

  while (days.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
};

/* Every tip carries the action it implies, so the card can take the
   student straight to the thing it is talking about. */

const buildSmartTip = (
  configuredSummary,
  unconfiguredCount = 0
) => {

  if (
    configuredSummary.length === 0 &&
    unconfiguredCount === 0
  ) {
    return null;
  }

  if (configuredSummary.length === 0) {
    return {
      tone: 'info',
      icon: 'tune',
      text: `Set up attendance for ${unconfiguredCount} ${unconfiguredCount === 1 ? 'subject' : 'subjects'} to see your risk summary.`,
      actionLabel: 'Set up',
      action: { type: 'screen', screen: 'Attendance' },
    };
  }

  const atRisk =
    configuredSummary
      .filter(
        (item) =>
          item.percentage < ATTENDANCE_THRESHOLD
      )
      .sort(
        (a, b) => a.percentage - b.percentage
      )[0];

  if (atRisk) {
    return {
      tone: 'danger',
      icon: 'warning-amber',
      text: `${atRisk.name} is at ${atRisk.percentage}%. You are below the ${ATTENDANCE_THRESHOLD}% requirement.`,
      actionLabel: 'Open subject',
      action: { type: 'subject', subjectId: atRisk.id },
    };
  }

  const closest =
    configuredSummary
      .slice()
      .sort(
        (a, b) =>
          a.remainingAbsences - b.remainingAbsences
      )[0];

  if (closest && closest.remainingAbsences <= 2) {
    return {
      tone: 'warning',
      icon: 'info-outline',
      text:
        closest.remainingAbsences === 0
          ? `${closest.name}: no more absences left before you drop below ${ATTENDANCE_THRESHOLD}%.`
          : `${closest.name}: ${closest.remainingAbsences} more ${closest.remainingAbsences === 1 ? 'absence' : 'absences'} allowed.`,
      actionLabel: 'Open subject',
      action: { type: 'subject', subjectId: closest.id },
    };
  }

  if (unconfiguredCount > 0) {
    return {
      tone: 'info',
      icon: 'tune',
      text: `Attendance is healthy so far. ${unconfiguredCount} ${unconfiguredCount === 1 ? 'subject still needs' : 'subjects still need'} setting up.`,
      actionLabel: 'Set up',
      action: { type: 'screen', screen: 'Attendance' },
    };
  }

  return {
    tone: 'success',
    icon: 'verified',
    text: 'Attendance is healthy across all your subjects.',
    action: null,
  };
};

/* A cheap fingerprint so an unchanged poll does not trigger a
   full re-render of the dashboard. */

const buildSignature = (payload) => {

  try {
    return JSON.stringify(payload);
  } catch (error) {
    return String(Date.now());
  }
};

/* ------------------------------------------------------------------
   SCREEN
------------------------------------------------------------------ */

export default function HomeScreen({
  openDrawer,
  currentUser,
  navigateTo,
  openSubjectDetails,
  unreadAlerts = 0,
  widgetRefreshRequest = 0,
}) {

  const {
    colors,
    isDarkMode,
    toggleTheme,
  } = useTheme();

  const {
    showError: showErrorToast,
    showSuccess: showSuccessToast,
  } = useToast();

  const {
    width,
    isCompactWidth,
  } = useResponsive();

  /* DATA */

  const [subjects, setSubjects] =
    useState([]);

  const [tasks, setTasks] =
    useState([]);

  const [classScheduleMap, setClassScheduleMap] =
    useState({});

  const [dateSheets, setDateSheets] =
    useState([]);

  const [attendanceSummary, setAttendanceSummary] =
    useState([]);

  const [attendanceMap, setAttendanceMap] =
    useState({});

  const [streak, setStreak] =
    useState(0);

  /* UI */

  const [taskFilter, setTaskFilter] =
    useState(null);

  const [showAllAttendance, setShowAllAttendance] =
    useState(false);

  const [isInitialLoading, setIsInitialLoading] =
    useState(true);

  const [isRefreshing, setIsRefreshing] =
    useState(false);

  const [markingClassKey, setMarkingClassKey] =
    useState(null);

  const [reduceMotion, setReduceMotion] =
    useState(false);

  /* A ticking clock, kept separate from the Firebase poll. Class
     state, countdowns, the greeting and the day rollover all change
     with time alone, so they must not wait for data to change. */

  const [now, setNow] = useState(() => new Date());

  const [lastSyncedAt, setLastSyncedAt] =
    useState(null);

  const [subjectPickerVisible, setSubjectPickerVisible] =
    useState(false);

  const [showAllOverdue, setShowAllOverdue] =
    useState(false);

  /* REFS
     The polling callback closes over whatever render created
     it, so anything it needs to read lives in a ref. */

  const isFirstLoad = useRef(true);

  const signatureRef = useRef('');

  const isForeground = useRef(true);

  const isLoadingRef = useRef(false);

  /* State updates are asynchronous, so a fast double tap can pass
     the guard twice. A ref flips synchronously and cannot. */

  const markingLockRef = useRef(null);

  const inFlightRef = useRef(null);

  /* ANIMATIONS */

  const heroAnim = useRef(new Animated.Value(0)).current;
  const statsAnim = useRef(new Animated.Value(0)).current;
  const bodyAnim = useRef(new Animated.Value(0)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;
  const rocketAnim = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const fabAnim = useRef(new Animated.Value(0)).current;
  const paperPulse = useRef(new Animated.Value(0)).current;
  const tipFade = useRef(new Animated.Value(1)).current;
  const burstAnim = useRef(new Animated.Value(0)).current;

  const [burstKey, setBurstKey] = useState(null);

  /* A short, one-off celebration on the row that was just marked
     present. It is a burst, not a loop, so it never becomes noise. */

  const triggerMarkSuccess = useCallback((key) => {

    if (reduceMotion) {
      return;
    }

    setBurstKey(key);
    burstAnim.setValue(0);

    Animated.sequence([
      Animated.spring(burstAnim, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.timing(burstAnim, {
        toValue: 0,
        duration: 260,
        delay: 420,
        useNativeDriver: true,
      }),
    ]).start(() => setBurstKey(null));

  }, [burstAnim, reduceMotion]);

  /* ---------------------------------------------------------------
     LOAD
  --------------------------------------------------------------- */

  const loadHomeData = useCallback(async ({
    silent = false,
  } = {}) => {

    if (!currentUser?.id) {
      return undefined;
    }

    /* A pull-to-refresh that lands mid-poll used to return
       immediately and show a spinner over stale data. It now waits
       on the request already in flight instead of faking it. */

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    isLoadingRef.current = true;

    const request = (async () => {

    try {

      /* All dashboard requests run together instead of one after
         another, which is what made a refresh feel slow. */

      const [
        taskBundle,
        attendance,
        classScheduleMap,
        dateSheets,
      ] = await Promise.all([
        loadAllUserTasks(currentUser.id),
        loadUserAttendance(currentUser.id),
        loadUserClassSchedules(currentUser.id),
        loadUserDateSheets(currentUser.id),
      ]);

      const nextSubjects = taskBundle.subjects || [];
      const nextTasks = taskBundle.tasks || [];

      const summary =
        nextSubjects.map((subject) => ({
          ...subject,
          ...getAttendanceStats(
            subject,
            attendance[subject.id]
          ),
        }));

      const signature =
        buildSignature({
          nextSubjects,
          nextTasks,
          attendance,
          classScheduleMap,
          dateSheets,
        });

      setLastSyncedAt(new Date());

      /* Nothing changed since the last poll, so leave state
         alone and avoid re-rendering the whole dashboard. */

      if (signature === signatureRef.current) {
        return;
      }

      signatureRef.current = signature;

      setSubjects(nextSubjects);
      setTasks(nextTasks);
      setAttendanceMap(attendance);
      setAttendanceSummary(summary);
      setClassScheduleMap(classScheduleMap);
      setDateSheets(dateSheets || []);
      setStreak(computeStreak(attendance));

    } catch (error) {

      console.log(error);

      // Preserve the useful last widget snapshot and label it as cached.
      // The native bridge is Android-only, so this is a safe no-op elsewhere.
      setWidgetError('offline');

      /* Read from the ref, not from state, so a background
         poll cannot mistake itself for the first load and
         spam a toast every minute. */

      if (isFirstLoad.current && !silent) {

        showErrorToast(
          'Could not load your dashboard. Check your connection and pull down to retry.'
        );
      }

    } finally {

      isFirstLoad.current = false;
      isLoadingRef.current = false;
      inFlightRef.current = null;

      setIsInitialLoading(false);
    }

    })();

    inFlightRef.current = request;

    return request;

  }, [currentUser, showErrorToast]);

  /* INITIAL + POLLING */

  useEffect(() => {

    if (!currentUser?.id) {
      return undefined;
    }

    loadHomeData();

    const interval =
      setInterval(() => {

        /* Backgrounded apps keep timers alive on Android, so
           the poll is skipped rather than burning data. */

        if (isForeground.current) {
          loadHomeData({ silent: true });
        }

      }, POLL_INTERVAL);

    return () =>
      clearInterval(interval);

  }, [currentUser, loadHomeData]);

  /* Any local write - from this screen or another one - shows up here
     instantly instead of waiting for the next poll. The poll above is
     now just a harmless local-read safety net. */
  useEffect(() => {

    if (!currentUser?.id) {
      return undefined;
    }

    const unsubscribe =
      onDataChanged(() =>
        loadHomeData({ silent: true })
      );

    return unsubscribe;

  }, [currentUser, loadHomeData]);

  /* CLOCK TICKER
     Time moves whether or not the data does. Without this the
     dashboard could sit on a stale "in progress" class, an expired
     countdown, or yesterday's date until Firebase happened to
     return something different. */

  useEffect(() => {

    const tick =
      setInterval(() => {

        if (isForeground.current) {
          setNow(new Date());
        }

      }, CLOCK_TICK);

    return () =>
      clearInterval(tick);

  }, []);

  /* FOREGROUND TRACKING */

  useEffect(() => {

    const subscription =
      AppState.addEventListener(
        'change',
        (nextState) => {

          const active = nextState === 'active';

          isForeground.current = active;

          if (active) {
            /* Coming back could be seconds or days later, so the
               clock is resynced before anything is re-derived. */
            setNow(new Date());
            loadHomeData({ silent: true });
          }
        }
      );

    return () =>
      subscription.remove();

  }, [loadHomeData]);

  /* Respect the device accessibility setting: decorative motion should
     become a stable layout, not an unavoidable continuous animation. */

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {});

    const subscription =
      AccessibilityInfo.addEventListener?.(
        'reduceMotionChanged',
        setReduceMotion
      );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  /* ENTRANCE + IDLE MOTION */

  useEffect(() => {

    if (isInitialLoading) {
      return undefined;
    }

    if (reduceMotion) {
      heroAnim.setValue(1);
      statsAnim.setValue(1);
      bodyAnim.setValue(1);
      sparkleAnim.setValue(1);
      rocketAnim.setValue(0);
      livePulse.setValue(1);
      fabAnim.setValue(1);
      paperPulse.setValue(0);
      return undefined;
    }

    Animated.stagger(110, [
      Animated.timing(heroAnim, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(statsAnim, {
        toValue: 1,
        duration: 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(bodyAnim, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(fabAnim, {
        toValue: 1,
        friction: 6,
        tension: 70,
        useNativeDriver: true,
      }),
    ]).start();

    const makeLoop = (value, duration) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    const loops = [
      makeLoop(sparkleAnim, 1100),
      makeLoop(rocketAnim, 1800),
      makeLoop(livePulse, 750),
    ];

    loops.forEach((loop) => loop.start());

    return () =>
      loops.forEach((loop) => loop.stop());

  }, [isInitialLoading, reduceMotion]);

  /* ---------------------------------------------------------------
     ACTIONS
  --------------------------------------------------------------- */

  const handleRefresh = async () => {

    setIsRefreshing(true);

    try {
      await loadHomeData();
    } finally {
      setIsRefreshing(false);
    }
  };

  const openTaskSubject = (task) => {

    const subject =
      subjects.find(
        (item) => item.id === task.subjectId
      );

    setTaskFilter(null);

    if (subject) {
      openSubjectDetails?.(subject);
    } else {
      navigateTo?.('Subjects');
    }
  };

  /* A tip that names a problem should also be the way to reach it. */

  const handleTipPress = (tip) => {

    if (!tip?.action) {
      return;
    }

    if (tip.action.type === 'screen') {
      navigateTo?.(tip.action.screen);
      return;
    }

    const subject =
      subjects.find(
        (item) => item.id === tip.action.subjectId
      );

    if (subject) {
      openSubjectDetails?.(subject);
    } else {
      navigateTo?.('Attendance');
    }
  };

  /* The quick-add button used to drop the student on the Subjects
     list to find their own way to a task form. */

  const handleQuickAdd = () => {

    if (subjects.length === 0) {
      navigateTo?.('Subjects');
      return;
    }

    if (subjects.length === 1) {
      openSubjectDetails?.(subjects[0]);
      return;
    }

    setSubjectPickerVisible(true);
  };

  /* QUICK ATTENDANCE */

  const markAttendance = async (
    classItem,
    status
  ) => {

    /* Synchronous lock. Two taps in the same tick both saw the old
       state value before this became a ref. */

    if (markingLockRef.current) {
      return;
    }

    const subject =
      subjects.find(
        (item) => item.id === classItem.subjectId
      );

    if (!subject) {
      return;
    }

    const current =
      attendanceMap[subject.id] || {
        subjectId: subject.id,
        attendancePerClass:
          subject.type === 'Lab' ? 2 : 1,
        totalClasses: 30,
        absences: 0,
        records: [],
        alertsSent: {},
      };

    /* Same date-key matching the Attendance screen uses, so a record
       edited there is recognised here and never duplicated. */

    if (getClassAttendanceRecord(current, classItem.id)) {
      showErrorToast(
        'Attendance is already marked for this class today. Open Attendance to edit it.'
      );
      return;
    }

    const windowState =
      getAttendanceWindowState(classItem, new Date());

    if (!windowState.canMark) {
      showErrorToast(
        windowState.state === 'upcoming'
          ? `This class has not started yet. ${windowState.reason}.`
          : 'The attendance window for this class has closed. Open Attendance to add it manually.'
      );
      return;
    }

    markingLockRef.current = classItem.key;

    setMarkingClassKey(classItem.key);

    const stats =
      getAttendanceStats(subject, current);

    const isAbsent = status === 'Absent';

    const nextAbsences =
      isAbsent
        ? Math.min(
            stats.absences + 1,
            stats.totalClasses
          )
        : stats.absences;

    const markedAt = new Date();

    /* Shared builder, so a Home mark and an Attendance mark are
       byte-for-byte the same shape. */

    const record =
      buildClassAttendanceRecord({
        subjectId: subject.id,
        schedule: classItem,
        status,
        absences: nextAbsences,
        source: 'home',
      });

    const nextAttendance = {
      ...current,
      absences: nextAbsences,
      records: [
        record,
        ...(current.records || []),
      ],
      updatedAt: markedAt.toISOString(),
    };

    /* Optimistic update so the row responds instantly. */

    const previousMap = attendanceMap;

    const nextMap = {
      ...attendanceMap,
      [subject.id]: nextAttendance,
    };

    setAttendanceMap(nextMap);

    setAttendanceSummary(
      subjects.map((item) => ({
        ...item,
        ...getAttendanceStats(
          item,
          nextMap[item.id]
        ),
      }))
    );

    setStreak(computeStreak(nextMap));

    try {

      const {
        schedules,
        reminderRefreshFailed,
      } = await persistAttendanceWithReminders({
          userId: currentUser.id,
          subject,
          nextAttendance,
          classScheduleMap,
        });

      /* The class lists are derived from this map, so updating it
         is enough - there is no second copy to keep in step. */

      if (schedules) {
        setClassScheduleMap((currentSchedules) => ({
          ...currentSchedules,
          [subject.id]: schedules,
        }));
      }

      signatureRef.current = '';

      /* Present is worth celebrating; absent is not. */

      if (!isAbsent) {
        triggerMarkSuccess(classItem.key);
      }

      showSuccessToast(
        `${status} saved for ${subject.name}.`
      );

      if (reminderRefreshFailed) {
        showErrorToast(
          'Attendance was saved, but class reminders need a refresh.'
        );
      }

    } catch (error) {

      console.log(error);

      setAttendanceMap(previousMap);

      setAttendanceSummary(
        subjects.map((item) => ({
          ...item,
          ...getAttendanceStats(
            item,
            previousMap[item.id]
          ),
        }))
      );

      setStreak(computeStreak(previousMap));

      showErrorToast(
        'Could not save attendance. Please try again.'
      );

    } finally {

      markingLockRef.current = null;
      setMarkingClassKey(null);
    }
  };

  /* ---------------------------------------------------------------
     DERIVED
  --------------------------------------------------------------- */

  const pending =
    useMemo(
      () =>
        tasks.filter(
          (item) => item.status === 'Pending'
        ),
      [tasks]
    );

  const completed =
    useMemo(
      () =>
        tasks.filter(
          (item) => item.status === 'Completed'
        ),
      [tasks]
    );

  const { overdueTasks, upcomingTasks } =
    useMemo(() => {

      const withInfo =
        pending.map((task) => ({
          ...task,
          info: getDeadlineInfo(task, now),
        }));

      const overdue =
        withInfo
          .filter((task) => task.info.isOverdue)
          .sort(
            (a, b) => a.info.daysLeft - b.info.daysLeft
          );

      const upcoming =
        withInfo
          .filter((task) => !task.info.isOverdue)
          .sort((a, b) => {

            if (a.info.daysLeft === null) {
              return 1;
            }

            if (b.info.daysLeft === null) {
              return -1;
            }

            return a.info.daysLeft - b.info.daysLeft;
          })
          .slice(0, 5);

      return {
        overdueTasks: overdue,
        upcomingTasks: upcoming,
      };

    }, [pending, now]);

  /* Derived from the clock, so the dashboard rolls over at
     midnight and reacts to classes starting and ending. */

  const classes =
    useMemo(
      () => buildClassList(subjects, classScheduleMap, now),
      [subjects, classScheduleMap, now]
    );

  const todayClasses =
    useMemo(
      () => buildTodayClassList(subjects, classScheduleMap, now),
      [subjects, classScheduleMap, now]
    );

  const nextClass =
    classes.length > 0 ? classes[0] : null;

  const ongoingClass =
    useMemo(
      () =>
        todayClasses.find((item) =>
          isClassOngoingAt(item, now)
        ) || null,
      [todayClasses, now]
    );

  const nextPaper =
    useMemo(
      () => findNextPaper(dateSheets, now),
      [dateSheets, now]
    );

  const upcomingPapers =
    useMemo(
      () =>
        dateSheets.filter((paper) => {
          if (paper.isArchived === true) {
            return false;
          }

          return getExamState(paper, now) !== 'ended';
        }),
      [dateSheets, now]
    );

  const paperIsLive =
    nextPaper?.examState === 'ongoing';

  /* Urgent means the paper starts within the hour. */

  const paperIsUrgent =
    Boolean(nextPaper) &&
    !paperIsLive &&
    nextPaper.nextDate.getTime() - now.getTime() <= 3600000;

  const paperCountdownLabel =
    !nextPaper
      ? ''
      : paperIsLive
        ? `${Math.max(
            Math.ceil(
              (nextPaper.endsAt.getTime() - now.getTime()) / 60000
            ),
            1
          )}m left`
        : formatCountdown(nextPaper.nextDate, now);

  const dueToday =
    useMemo(
      () =>
        pending.filter(
          (task) =>
            getDeadlineInfo(task, now).tone === 'today'
        ).length,
      [pending, now]
    );

  /* A subject with no attendance configuration has no real
     percentage. Averaging its default 100% made an untouched
     dashboard claim perfect attendance. */

  const configuredAttendance =
    useMemo(
      () =>
        attendanceSummary.filter(
          (item) => item.hasRecord
        ),
      [attendanceSummary]
    );

  const hasAttendanceData =
    configuredAttendance.length > 0;

  const averageAttendance =
    useMemo(() => {

      if (configuredAttendance.length === 0) {
        return null;
      }

      const total =
        configuredAttendance.reduce(
          (sum, item) => sum + item.percentage,
          0
        );

      return Math.round(
        total / configuredAttendance.length
      );

    }, [configuredAttendance]);

  /* Only configured subjects can be "at risk" - an unconfigured
     one is unknown, not healthy. */

  const riskySubjects =
    useMemo(
      () =>
        configuredAttendance
          .filter(
            (item) =>
              item.percentage < ATTENDANCE_THRESHOLD
          )
          .sort(
            (a, b) => a.percentage - b.percentage
          ),
      [configuredAttendance]
    );

  const unconfiguredCount =
    attendanceSummary.length - configuredAttendance.length;

  const visibleAttendance =
    showAllAttendance
      ? attendanceSummary
      : riskySubjects.length > 0
        ? riskySubjects.slice(0, 3)
        : attendanceSummary.slice(0, 3);

  const smartTip =
    useMemo(
      () =>
        buildSmartTip(
          configuredAttendance,
          unconfiguredCount
        ),
      [configuredAttendance, unconfiguredCount]
    );

  /* ---------------------------------------------------------------
     ANDROID HOME-SCREEN WIDGET SYNC

     Purely additive: mirrors the dashboard's already-computed stats
     to the native widget. Nothing here changes existing behaviour —
     it only reads derived values and forwards a snapshot.

     The freshest snapshot inputs are kept in a ref so the push
     callback can stay stable and NOT re-fire on every 30s clock tick.
     We only push when the underlying *data* changes, plus once when
     the app is backgrounded (right before the user sees the widget).
  --------------------------------------------------------------- */

  const widgetSnapshotRef = useRef({});

  widgetSnapshotRef.current = {
    currentUser,
    averageAttendance,
    riskySubjects,
    subjects,
    attendanceSummary,
    todayClasses,
    nextClass,
    pending,
    overdueTasks,
    upcomingTasks,
    upcomingPapers,
    nextPaper,
    paperCountdownLabel,
    now,
  };

  const syncWidget = useCallback(() => {
    pushWidgetData(widgetSnapshotRef.current);
  }, []);

  /* Push when real data changes (not on clock ticks — those state
     values are untouched by the ticking `now`). */

  useEffect(() => {

    if (!currentUser?.id) {
      return;
    }

    syncWidget();

  }, [
    currentUser,
    subjects,
    tasks,
    attendanceSummary,
    classScheduleMap,
    dateSheets,
    syncWidget,
  ]);


  /* Push a final fresh snapshot as the app is backgrounded, so the
     widget shows the current next-class time and countdowns the
     moment the user glances at their home screen. */

  useEffect(() => {

    const subscription =
      AppState.addEventListener('change', (nextState) => {

        if (
          nextState === 'background' ||
          nextState === 'inactive'
        ) {
          syncWidget();
        }
      });

    return () => subscription.remove();

  }, [syncWidget]);

  /* A widget Refresh tap launches the app with a deep link. Once this
     request token changes, Home performs the real authenticated Firebase
     sync and then writes the refreshed dashboard snapshot back to Glance. */

  const handledWidgetRefreshRef = useRef(0);

  useEffect(() => {

    if (
      !currentUser?.id ||
      !widgetRefreshRequest ||
      handledWidgetRefreshRef.current === widgetRefreshRequest
    ) {
      return;
    }

    handledWidgetRefreshRef.current = widgetRefreshRequest;

    loadHomeData({ silent: true })
      .finally(syncWidget);

  }, [
    currentUser,
    widgetRefreshRequest,
    loadHomeData,
    syncWidget,
  ]);

  /* ---------------------------------------------------------------
     ANIMATIONS THAT DEPEND ON DERIVED VALUES

     These must sit below the values they read. A dependency array is
     evaluated during render, so declaring them earlier reached the
     consts before initialisation and blanked the screen.
  --------------------------------------------------------------- */

  /* The exam card only breathes inside the final hour. A permanent
     pulse would stop meaning anything. */

  useEffect(() => {

    if (reduceMotion || !paperIsUrgent) {
      paperPulse.setValue(0);
      return undefined;
    }

    const loop =
      Animated.loop(
        Animated.sequence([
          Animated.timing(paperPulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(paperPulse, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    loop.start();

    return () => loop.stop();

  }, [paperIsUrgent, reduceMotion]);

  /* The tip changes on a refresh. Swapping the text under the
     reader's eyes is jarring, so it crossfades instead. */

  const tipTextRef = useRef('');

  const smartTipText = smartTip?.text || '';

  useEffect(() => {

    if (smartTipText === tipTextRef.current) {
      return;
    }

    const isFirstTip = tipTextRef.current === '';

    tipTextRef.current = smartTipText;

    if (reduceMotion || isFirstTip) {
      tipFade.setValue(1);
      return;
    }

    tipFade.setValue(0.25);

    Animated.timing(tipFade, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  }, [smartTipText, reduceMotion]);

  const completionPercent =
    tasks.length === 0
      ? 0
      : Math.round(
          (completed.length / tasks.length) * 100
        );

  const filteredTasks =
    taskFilter
      ? tasks.filter(
          (task) => task.status === taskFilter
        )
      : [];

  const firstName =
    (currentUser?.name || '').trim().split(' ')[0];

  /* Decorative layers are hidden from screen readers so the
     dashboard reads as content, not scenery. */

  const decorative = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
    pointerEvents: 'none',
  };

  /* ---------------------------------------------------------------
     RENDER HELPERS
  --------------------------------------------------------------- */

  const renderDeadlineBadge = (info) => {

    const tone =
      getToneColors(info.tone, colors, isDarkMode);

    return (
      <View
        style={[
          styles.deadlineBadge,
          {
            backgroundColor: tone.background,
            maxWidth: width * 0.3,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.deadlineText,
            {
              color: tone.text,
            },
          ]}
        >
          {info.label}
        </Text>
      </View>
    );
  };

  const renderTaskCard = (item, isOverdue = false) => {

    const info =
      item.info || getDeadlineInfo(item);

    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${item.type} for ${item.subjectName}, due ${info.label}`}
        accessibilityHint="Opens this subject"
        style={({ hovered, pressed }) => [
          styles.taskCard,
          {
            backgroundColor: colors.card,
          },
          isOverdue && {
            borderColor: `${colors.danger}55`,
            borderWidth: 1,
          },
          hovered && styles.dashboardCardHover,
          pressed && styles.cardPressed,
        ]}
        onPress={() => openTaskSubject(item)}
      >
        <View
          style={[
            styles.taskAccent,
            {
              backgroundColor: isOverdue
                ? colors.danger
                : colors.primary,
            },
          ]}
        />

        <View
          style={[
            styles.taskIcon,
            {
              backgroundColor: isDarkMode
                ? 'rgba(91,95,239,0.18)'
                : '#EEF2FF',
            },
          ]}
        >
          <MaterialIcons
            name={
              item.type === 'Quiz'
                ? 'quiz'
                : item.type === 'Project'
                  ? 'workspaces'
                  : 'assignment'
            }
            size={24}
            color={
              isOverdue
                ? colors.danger
                : colors.primary
            }
          />
        </View>

        <View style={styles.taskInfo}>
          <Text
            numberOfLines={1}
            style={[
              styles.taskTitle,
              {
                color: colors.textDark,
              },
            ]}
          >
            {item.title}
          </Text>

          <Text
            numberOfLines={1}
            style={[
              styles.taskSubject,
              {
                color: colors.textLight,
              },
            ]}
          >
            {item.subjectName}
          </Text>

          <Text
            style={[
              styles.taskType,
              {
                color: colors.secondary,
              },
            ]}
          >
            {item.type}
          </Text>
        </View>

        {renderDeadlineBadge(info)}
      </Pressable>
    );
  };

  /* ---------------------------------------------------------------
     LOADING
  --------------------------------------------------------------- */

  if (isInitialLoading) {

    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          {
            backgroundColor: colors.background,
          },
        ]}
      >
        <StatusBar
          backgroundColor={
            isDarkMode
              ? colors.background
              : '#E7DEFF'
          }
          barStyle={
            isDarkMode
              ? 'light-content'
              : 'dark-content'
          }
        />

        <ScrollView
          style={styles.container}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={styles.skeletonContent}
          accessibilityLabel="Loading your dashboard"
        >
          <SkeletonBlock height={150} radius={24} />

          <View style={styles.skeletonRow}>
            <SkeletonBlock height={92} radius={16} style={styles.flexOne} />
            <SkeletonBlock height={92} radius={16} style={styles.flexOne} />
            <SkeletonBlock height={92} radius={16} style={styles.flexOne} />
          </View>

          <SkeletonList count={3} lines={2} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ---------------------------------------------------------------
     MAIN
  --------------------------------------------------------------- */

  return (

    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor: colors.background,
        },
      ]}
    >

      <StatusBar
        backgroundColor={
          isDarkMode
            ? colors.background
            : '#E7DEFF'
        }
        barStyle={
          isDarkMode
            ? 'light-content'
            : 'dark-content'
        }
      />

      <ScrollView
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={{
          paddingBottom: SCREEN_BOTTOM_PADDING,
        }}
      >

        {/* ---------------- HERO ---------------- */}

        <Animated.View
          style={[
            styles.hero,
            {
              backgroundColor: isDarkMode
                ? colors.card
                : '#E9E1FF',
              opacity: heroAnim,
              transform: [
                {
                  translateY: heroAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 0],
                  }),
                },
              ],
            },
          ]}
        >

          <View {...decorative} style={StyleSheet.absoluteFill}>
            <View style={[styles.waveBack, isDarkMode && styles.darkWaveBack]} />
            <View style={[styles.waveMiddle, isDarkMode && styles.darkWaveMiddle]} />
            <View style={[styles.waveFront, isDarkMode && styles.darkWaveFront]} />
            <View style={[styles.curveLineOne, isDarkMode && styles.darkCurveLine]} />
            <View style={[styles.curveLineTwo, isDarkMode && styles.darkCurveLine]} />
            <FloatingParticles
              reduceMotion={reduceMotion}
              count={6}
              color={
                isDarkMode
                  ? 'rgba(165,180,252,0.38)'
                  : 'rgba(124,58,237,0.18)'
              }
            />
            <Sheen
              reduceMotion={reduceMotion}
              duration={4600}
              width={300}
            />
          </View>

          <View style={styles.headerTop}>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open navigation menu"
              style={({ hovered, pressed }) => [
                styles.menuButton,
                {
                  backgroundColor: colors.primary,
                },
                hovered && styles.primaryButtonHover,
                pressed && styles.cardPressed,
              ]}
              onPress={openDrawer}
            >
              <MaterialIcons
                name="menu"
                size={29}
                color="#FFFFFF"
              />
            </Pressable>

            <View style={styles.headerActions}>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  unreadAlerts > 0
                    ? `Alerts, ${unreadAlerts} new`
                    : 'Alerts'
                }
                style={({ hovered, pressed }) => [
                  styles.themeButton,
                  {
                    backgroundColor: colors.card,
                    borderColor: isDarkMode
                      ? colors.border
                      : '#FFFFFF',
                  },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => navigateTo?.('Alerts')}
              >
                <MaterialIcons
                  name="notifications"
                  size={25}
                  color={colors.primary}
                />
                {unreadAlerts > 0 && (
                  <View
                    style={[
                      styles.heroBadge,
                      {
                        backgroundColor: colors.danger,
                        borderColor: colors.card,
                      },
                    ]}
                  >
                    <Text style={styles.heroBadgeText}>
                      {unreadAlerts > 9 ? '9+' : unreadAlerts}
                    </Text>
                  </View>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: isDarkMode }}
                accessibilityLabel={
                  isDarkMode
                    ? 'Switch to light mode'
                    : 'Switch to dark mode'
                }
                style={({ hovered, pressed }) => [
                  styles.themeButton,
                  {
                    backgroundColor: colors.card,
                    borderColor: isDarkMode
                      ? colors.border
                      : '#FFFFFF',
                  },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={toggleTheme}
              >
                <MaterialIcons
                  name={isDarkMode ? 'light-mode' : 'dark-mode'}
                  size={25}
                  color={colors.primary}
                />
              </Pressable>

            </View>

          </View>

          <View style={styles.heroContent}>

            <View style={styles.heroTextBlock}>

              <Text
                style={[
                  styles.welcome,
                  {
                    color: isDarkMode
                      ? '#E0E7FF'
                      : colors.textLight,
                  },
                ]}
              >
                {getGreeting(now)}
              </Text>

              <Text
                numberOfLines={1}
                style={[
                  styles.title,
                  {
                    color: isDarkMode
                      ? '#C7D2FE'
                      : colors.primary,
                  },
                ]}
              >
                {firstName || 'Student'}
              </Text>

              {streak > 0 && (
                <View
                  style={[
                    styles.streakPill,
                    {
                      backgroundColor: isDarkMode
                        ? 'rgba(251,191,36,0.16)'
                        : 'rgba(251,191,36,0.20)',
                    },
                  ]}
                >
                  <MaterialIcons
                    name="local-fire-department"
                    size={15}
                    color={colors.accent}
                  />
                  <Text
                    style={[
                      styles.streakText,
                      {
                        color: colors.accent,
                      },
                    ]}
                  >
                    {streak} day streak
                  </Text>
                </View>
              )}

            </View>

            {!isCompactWidth && (
              <View {...decorative} style={styles.illustrationWrap}>
                <Animated.View
                  style={[
                    styles.sparkleOne,
                    {
                      opacity: sparkleAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.35, 1],
                      }),
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.sparkleTwo,
                    {
                      opacity: sparkleAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0.4],
                      }),
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.rocketBubble,
                    {
                      transform: [
                        {
                          translateY: rocketAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, -7],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <MaterialIcons
                    name="rocket-launch"
                    size={28}
                    color="#5B5FEF"
                  />
                </Animated.View>
                <View style={styles.bookStack}>
                  <View style={styles.bookTop} />
                  <View style={styles.bookMiddle} />
                  <View style={styles.bookBottom} />
                </View>
              </View>
            )}

          </View>

          {/* TODAY AT A GLANCE */}

          <View
            style={[
              styles.glanceStrip,
              {
                backgroundColor: isDarkMode
                  ? 'rgba(15,23,42,0.5)'
                  : 'rgba(255,255,255,0.66)',
              },
            ]}
          >

            <View style={styles.glanceItem}>
              <Text style={[styles.glanceValue, { color: colors.primary }]}>
                {todayClasses.length}
              </Text>
              <Text style={[styles.glanceLabel, { color: colors.textLight }]}>
                {todayClasses.length === 1 ? 'class today' : 'classes today'}
              </Text>
            </View>

            <View style={[styles.glanceDivider, { backgroundColor: colors.border }]} />

            <View style={styles.glanceItem}>
              <Text
                style={[
                  styles.glanceValue,
                  {
                    color: dueToday > 0
                      ? colors.danger
                      : colors.primary,
                  },
                ]}
              >
                {dueToday}
              </Text>
              <Text style={[styles.glanceLabel, { color: colors.textLight }]}>
                due today
              </Text>
            </View>

            <View style={[styles.glanceDivider, { backgroundColor: colors.border }]} />

            <View style={styles.glanceItem}>
              <Text
                style={[
                  styles.glanceValue,
                  {
                    color: !hasAttendanceData
                      ? colors.primary
                      : getAttendanceTone(
                          averageAttendance,
                          colors
                        ),
                  },
                ]}
              >
                  {!hasAttendanceData
                    ? '—'
                    : `${averageAttendance}%`}
              </Text>
              <Text style={[styles.glanceLabel, { color: colors.textLight }]}>
                {attendanceSummary.length === 0
                  ? 'set up subjects'
                  : !hasAttendanceData
                    ? 'not set up'
                    : 'attendance'}
              </Text>
            </View>

          </View>

        </Animated.View>

        {/* ---------------- STATS ---------------- */}

        <Animated.View
          style={[
            styles.statsContainer,
            {
              opacity: statsAnim,
              transform: [
                {
                  translateY: statsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
            },
          ]}
        >

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${subjects.length} subjects`}
            accessibilityHint="Opens the Subjects screen"
            style={({ hovered, pressed }) => [
              styles.statCard,
              { backgroundColor: colors.card },
              hovered && styles.dashboardCardHover,
              pressed && styles.cardPressed,
            ]}
            onPress={() => navigateTo?.('Subjects')}
          >
            <CountUp
              value={subjects.length}
              reduceMotion={reduceMotion}
              style={[styles.statNumber, { color: colors.primary }]}
            />
            <Text style={[styles.statLabel, { color: colors.textDark }]}>
              Subjects
            </Text>
            <View style={styles.statIconBlue}>
              <MaterialIcons name="menu-book" size={26} color="#5B5FEF" />
            </View>
            <MaterialIcons
              name="chevron-right"
              size={18}
              color={colors.textLight}
              style={styles.statChevron}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${pending.length} pending tasks`}
            accessibilityHint="Shows the list of pending tasks"
            style={({ hovered, pressed }) => [
              styles.statCard,
              { backgroundColor: colors.card },
              hovered && styles.dashboardCardHover,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setTaskFilter('Pending')}
          >
            <CountUp
              value={pending.length}
              reduceMotion={reduceMotion}
              style={[styles.statNumber, { color: colors.primary }]}
            />
            <Text style={[styles.statLabel, { color: colors.textDark }]}>
              Pending
            </Text>
            <View style={styles.statIconAmber}>
              <MaterialIcons name="schedule" size={27} color="#F59E0B" />
            </View>
            <MaterialIcons
              name="unfold-more"
              size={17}
              color={colors.textLight}
              style={styles.statChevron}
            />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${completed.length} completed tasks`}
            accessibilityHint="Shows the list of completed tasks"
            style={({ hovered, pressed }) => [
              styles.statCard,
              { backgroundColor: colors.card },
              hovered && styles.dashboardCardHover,
              pressed && styles.cardPressed,
            ]}
            onPress={() => setTaskFilter('Completed')}
          >
            <CountUp
              value={completed.length}
              reduceMotion={reduceMotion}
              style={[styles.statNumber, { color: colors.primary }]}
            />
            <Text style={[styles.statLabel, { color: colors.textDark }]}>
              Completed
            </Text>
            <View style={styles.statIconGreen}>
              <MaterialIcons name="check-circle" size={28} color="#22C55E" />
            </View>
            <MaterialIcons
              name="unfold-more"
              size={17}
              color={colors.textLight}
              style={styles.statChevron}
            />
          </Pressable>

        </Animated.View>

        {/* ---------------- BODY ---------------- */}

        <Animated.View
          style={[
            styles.contentShell,
            {
              backgroundColor: isDarkMode
                ? 'rgba(30,41,59,0.54)'
                : 'rgba(255,255,255,0.42)',
              borderColor: isDarkMode
                ? 'rgba(165,180,252,0.13)'
                : 'rgba(124,58,237,0.08)',
              opacity: bodyAnim,
              transform: [
                {
                  translateY: bodyAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [22, 0],
                  }),
                },
              ],
            },
          ]}
        >

          <View {...decorative} style={StyleSheet.absoluteFill}>
            <View style={[styles.bodyWaveOne, isDarkMode && styles.darkBodyWave]} />
            <View style={[styles.bodyWaveTwo, isDarkMode && styles.darkBodyWaveTwo]} />
            <View style={[styles.bodyCurveOne, isDarkMode && styles.darkBodyCurve]} />
          </View>

          {/* ONGOING CLASS */}

          {ongoingClass && (

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Class in progress: ${ongoingClass.subjectName} in room ${ongoingClass.room}`}
              accessibilityHint="Opens Attendance"
              style={({ hovered, pressed }) => [
                styles.liveCard,
                {
                  backgroundColor: isDarkMode
                    ? 'rgba(34,197,94,0.14)'
                    : '#DCFCE7',
                  borderColor: `${colors.success}55`,
                },
                hovered && styles.dashboardCardHover,
                pressed && styles.cardPressed,
              ]}
              onPress={() => navigateTo?.('Attendance')}
            >
              <Animated.View
                style={[
                  styles.liveDot,
                  {
                    backgroundColor: colors.success,
                    opacity: livePulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 1],
                    }),
                    transform: [
                      {
                        scale: livePulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.85, 1.15],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <View style={styles.flexOne}>
                <Text style={[styles.liveTitle, { color: colors.success }]}>
                  Class in progress
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.liveMeta, { color: colors.textDark }]}
                >
                  {ongoingClass.subjectName} · {ongoingClass.timeLabel} · Room {ongoingClass.room}
                </Text>
              </View>

              {/* Minutes left, driven by the clock rather than by data */}

              <View
                style={[
                  styles.liveRemaining,
                  { backgroundColor: `${colors.success}22` },
                ]}
              >
                <Text
                  style={[
                    styles.liveRemainingText,
                    { color: colors.success },
                  ]}
                >
                  {Math.max(
                    Math.ceil(
                      (getScheduleTimeOnDate(ongoingClass, now).getTime() +
                        ongoingClass.durationMinutes * 60000 -
                        now.getTime()) / 60000
                    ),
                    1
                  )}m left
                </Text>
              </View>
            </Pressable>

          )}

          {/* SMART TIP */}

          {smartTip && (

            <Animated.View style={{ opacity: tipFade }}>
              <Pressable
                accessibilityRole={smartTip.action ? 'button' : 'text'}
                accessibilityLabel={smartTip.text}
                accessibilityHint={
                  smartTip.action
                    ? 'Opens the related screen'
                    : undefined
                }
                disabled={!smartTip.action}
                onPress={() => handleTipPress(smartTip)}
                style={({ hovered, pressed }) => [
                  styles.tipCard,
                  {
                    backgroundColor: isDarkMode
                      ? 'rgba(148,163,184,0.10)'
                      : 'rgba(255,255,255,0.72)',
                    borderColor:
                      smartTip.tone === 'danger'
                        ? `${colors.danger}44`
                        : smartTip.tone === 'warning'
                          ? `${colors.warning}44`
                          : smartTip.tone === 'info'
                            ? `${colors.primary}44`
                            : `${colors.success}33`,
                  },
                  smartTip.action && hovered && styles.dashboardCardHover,
                  smartTip.action && pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name={smartTip.icon}
                  size={19}
                  color={
                    smartTip.tone === 'danger'
                      ? colors.danger
                      : smartTip.tone === 'warning'
                        ? colors.warning
                        : smartTip.tone === 'info'
                          ? colors.primary
                          : colors.success
                  }
                />
                <Text
                  style={[styles.tipText, { color: colors.textDark }]}
                >
                  {smartTip.text}
                </Text>

                {smartTip.action && (
                  <View style={styles.tipAction}>
                    <Text
                      style={[
                        styles.tipActionText,
                        { color: colors.primary },
                      ]}
                    >
                      {smartTip.actionLabel}
                    </Text>
                    <MaterialIcons
                      name="chevron-right"
                      size={16}
                      color={colors.primary}
                    />
                  </View>
                )}
              </Pressable>
            </Animated.View>

          )}

          {/* OVERDUE */}

          {overdueTasks.length > 0 && (

            <>
              <View style={styles.sectionHeaderRow}>
                <MaterialIcons
                  name="error-outline"
                  size={19}
                  color={colors.danger}
                />
                <Text
                  style={[styles.sectionTitle, { color: colors.danger, marginBottom: 0 }]}
                >
                  Overdue ({overdueTasks.length})
                </Text>

                {/* The count and the list used to disagree - eight
                    overdue, three shown, and no way to see the rest. */}

                {overdueTasks.length > 3 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showAllOverdue
                        ? 'Show fewer overdue tasks'
                        : `View all ${overdueTasks.length} overdue tasks`
                    }
                    hitSlop={8}
                    onPress={() => {
                      easeNext();
                      setShowAllOverdue((value) => !value);
                    }}
                    style={({ pressed }) => [
                      styles.viewAllButton,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.viewAllText,
                        { color: colors.danger },
                      ]}
                    >
                      {showAllOverdue ? 'Show less' : 'View all'}
                    </Text>
                    <MaterialIcons
                      name={
                        showAllOverdue
                          ? 'expand-less'
                          : 'expand-more'
                      }
                      size={17}
                      color={colors.danger}
                    />
                  </Pressable>
                )}
              </View>

              {(showAllOverdue
                ? overdueTasks
                : overdueTasks.slice(0, 3)
              ).map((item) => renderTaskCard(item, true))}
            </>

          )}

          {/* TODAY'S CLASSES */}

          <View style={styles.sectionHeaderRow}>
            <Text
              style={[styles.sectionTitle, { color: colors.textDark, marginBottom: 0 }]}
            >
              Today's Classes
            </Text>
            {todayClasses.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open Class Management"
                onPress={() => navigateTo?.('Class Management')}
                style={({ pressed }) => [
                  styles.sectionAction,
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={[styles.sectionActionText, { color: colors.primary }]}>
                  Manage
                </Text>
              </Pressable>
            )}
          </View>

          {todayClasses.length === 0 ? (

            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <MaterialIcons
                name="event-available"
                size={30}
                color={colors.textLight}
              />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                {classes.length === 0
                  ? 'No class schedule added yet.'
                  : 'No classes today. Enjoy the break.'}
              </Text>
              {classes.length === 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add class schedule"
                  onPress={() => navigateTo?.('Class Management')}
                  style={({ pressed }) => [
                    styles.emptyAction,
                    { backgroundColor: colors.primary },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text style={styles.emptyActionText}>
                    Add Schedule
                  </Text>
                </Pressable>
              )}
            </View>

          ) : (

            todayClasses.map((item) => {

              const live = isClassOngoingAt(item, now);
              const busy = markingClassKey === item.key;
              const markedRecord = getClassAttendanceRecord(
                attendanceMap[item.subjectId],
                item.id
              );

              const windowState =
                getAttendanceWindowState(item, now);

              const showBurst = burstKey === item.key;

              return (
                <Animated.View
                  key={item.key}
                  style={[
                    styles.classRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: live
                        ? `${colors.success}55`
                        : 'transparent',
                    },
                    live && !reduceMotion && {
                      transform: [
                        {
                          scale: livePulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.012],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  {/* One-off celebration wash after marking present */}

                  {showBurst && (
                    <Animated.View
                      {...decorative}
                      style={[
                        styles.markBurst,
                        {
                          backgroundColor: `${colors.success}22`,
                          opacity: burstAnim,
                          transform: [
                            {
                              scale: burstAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.85, 1],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  )}

                  <View
                    style={[
                      styles.classTimeBlock,
                      {
                        backgroundColor: live
                          ? `${colors.success}22`
                          : isDarkMode
                            ? 'rgba(91,95,239,0.16)'
                            : '#EEF2FF',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.classTime,
                        {
                          color: live
                            ? colors.success
                            : colors.primary,
                        },
                      ]}
                    >
                      {item.timeLabel}
                    </Text>
                  </View>

                  <View style={styles.flexOne}>
                    <Text
                      numberOfLines={1}
                      style={[styles.classSubject, { color: colors.textDark }]}
                    >
                      {item.subjectName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[styles.classMeta, { color: colors.textLight }]}
                    >
                      {live
                        ? `In progress · Room ${item.room}`
                        : `Room ${item.room} · ${item.durationMinutes} min`}
                    </Text>
                  </View>

                  {busy ? (

                    <ActivityIndicator size="small" color={colors.primary} />

                  ) : markedRecord ? (

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Marked ${markedRecord.type} for ${item.subjectName}. Open Attendance to edit.`}
                      accessibilityHint="Opens Attendance to edit this mark"
                      onPress={() => navigateTo?.('Attendance')}
                      style={({ pressed }) => [
                        styles.markedAttendanceButton,
                        {
                          backgroundColor:
                            markedRecord.type === 'Present'
                              ? isDarkMode
                                ? 'rgba(34,197,94,0.16)'
                                : '#DCFCE7'
                              : isDarkMode
                                ? 'rgba(248,113,113,0.16)'
                                : '#FEE2E2',
                        },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <MaterialIcons
                        name={
                          markedRecord.type === 'Present'
                            ? 'check-circle'
                            : 'cancel'
                        }
                        size={15}
                        color={
                          markedRecord.type === 'Present'
                            ? colors.success
                            : colors.danger
                        }
                      />
                      <Text
                        style={[
                          styles.markedAttendanceText,
                          {
                            color:
                              markedRecord.type === 'Present'
                                ? colors.success
                                : colors.danger,
                          },
                        ]}
                      >
                        Marked {markedRecord.type} — Edit
                      </Text>
                    </Pressable>

                  ) : !windowState.canMark ? (

                    /* Outside the valid window the buttons would be a
                       trap, so the reason is shown instead. */

                    <View
                      style={[
                        styles.windowNotice,
                        {
                          backgroundColor: isDarkMode
                            ? 'rgba(148,163,184,0.14)'
                            : '#F1F5F9',
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={
                          windowState.state === 'upcoming'
                            ? 'schedule'
                            : 'lock-clock'
                        }
                        size={13}
                        color={colors.textLight}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.windowNoticeText,
                          { color: colors.textLight },
                        ]}
                      >
                        {windowState.state === 'upcoming'
                          ? `Starts ${formatDueTime(windowState.startsAt)}`
                          : 'Window closed'}
                      </Text>
                    </View>

                  ) : (

                    <View style={styles.markRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Mark present for ${item.subjectName}`}
                        onPress={() => markAttendance(item, 'Present')}
                        style={({ pressed }) => [
                          styles.markButton,
                          {
                            backgroundColor: isDarkMode
                              ? 'rgba(34,197,94,0.16)'
                              : '#DCFCE7',
                          },
                          pressed && styles.cardPressed,
                        ]}
                      >
                        <MaterialIcons
                          name="check"
                          size={18}
                          color={colors.success}
                        />
                      </Pressable>

                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Mark absent for ${item.subjectName}`}
                        onPress={() => markAttendance(item, 'Absent')}
                        style={({ pressed }) => [
                          styles.markButton,
                          {
                            backgroundColor: isDarkMode
                              ? 'rgba(248,113,113,0.16)'
                              : '#FEE2E2',
                          },
                          pressed && styles.cardPressed,
                        ]}
                      >
                        <MaterialIcons
                          name="close"
                          size={18}
                          color={colors.danger}
                        />
                      </Pressable>
                    </View>

                  )}
                </Animated.View>
              );
            })

          )}

          {/* NEXT PAPER */}

          {nextPaper && (

            <>
              <Text style={[styles.sectionTitle, { color: colors.textDark }]}>
                {paperIsLive ? 'Paper In Progress' : 'Upcoming Paper'}
              </Text>

              <Animated.View
                style={
                  paperIsUrgent && !reduceMotion
                    ? {
                        transform: [
                          {
                            scale: paperPulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 1.015],
                            }),
                          },
                        ],
                      }
                    : undefined
                }
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${nextPaper.subjectName} paper, ${paperCountdownLabel}, room ${nextPaper.room}`}
                  accessibilityHint="Opens the Date Sheet"
                  style={({ hovered, pressed }) => [
                    styles.nextClassCard,
                    { backgroundColor: colors.card },
                    paperIsLive && {
                      borderWidth: 1,
                      borderColor: `${colors.danger}55`,
                    },
                    hovered && styles.dashboardCardHover,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => navigateTo?.('Date Sheet')}
                >
                  <View
                    style={[
                      styles.paperAccent,
                      {
                        backgroundColor: paperIsLive
                          ? colors.danger
                          : colors.accent,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.nextClassIcon,
                      {
                        backgroundColor: paperIsLive
                          ? `${colors.danger}22`
                          : isDarkMode
                            ? 'rgba(91,95,239,0.18)'
                            : '#EEF2FF',
                      },
                    ]}
                  >
                    <MaterialIcons
                      name={paperIsLive ? 'edit-note' : 'assignment'}
                      size={26}
                      color={
                        paperIsLive
                          ? colors.danger
                          : colors.primary
                      }
                    />
                  </View>

                  <View style={styles.nextClassInfo}>
                    <Text
                      numberOfLines={1}
                      style={[styles.nextClassTitle, { color: colors.textDark }]}
                    >
                      {nextPaper.subjectName}
                    </Text>
                    <Text style={[styles.nextClassMeta, { color: colors.textLight }]}>
                      {nextPaper.dateLabel} at {nextPaper.timeLabel}
                    </Text>
                    <Text style={[styles.nextClassRoom, { color: colors.primary }]}>
                      Room: {nextPaper.room}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.countdownPill,
                      {
                        backgroundColor: paperIsLive
                          ? `${colors.danger}22`
                          : paperIsUrgent
                            ? `${colors.danger}18`
                            : isDarkMode
                              ? 'rgba(251,191,36,0.16)'
                              : '#FEF3C7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.countdownText,
                        {
                          color: paperIsLive || paperIsUrgent
                            ? colors.danger
                            : colors.accent,
                        },
                      ]}
                    >
                      {paperCountdownLabel}
                    </Text>
                  </View>
                </Pressable>
              </Animated.View>
            </>

          )}

          {/* NEXT CLASS (when none today) */}

          {todayClasses.length === 0 && nextClass && (

            <>
              <Text style={[styles.sectionTitle, { color: colors.textDark }]}>
                Next Class
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Next class ${nextClass.subjectName} on ${nextClass.dayName} at ${nextClass.timeLabel}, room ${nextClass.room}`}
                accessibilityHint="Opens Class Management"
                style={({ hovered, pressed }) => [
                  styles.nextClassCard,
                  { backgroundColor: colors.card },
                  hovered && styles.dashboardCardHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => navigateTo?.('Class Management')}
              >
                <View
                  style={[
                    styles.classAccent,
                    { backgroundColor: colors.secondary },
                  ]}
                />
                <View
                  style={[
                    styles.nextClassIcon,
                    {
                      backgroundColor: isDarkMode
                        ? 'rgba(91,95,239,0.18)'
                        : '#EEF2FF',
                    },
                  ]}
                >
                  <MaterialIcons
                    name="school"
                    size={26}
                    color={colors.primary}
                  />
                </View>

                <View style={styles.nextClassInfo}>
                  <Text
                    numberOfLines={1}
                    style={[styles.nextClassTitle, { color: colors.textDark }]}
                  >
                    {nextClass.subjectName}
                  </Text>
                  <Text style={[styles.nextClassMeta, { color: colors.textLight }]}>
                    {nextClass.dayName} at {nextClass.timeLabel}
                  </Text>
                  <Text style={[styles.nextClassRoom, { color: colors.primary }]}>
                    Room: {nextClass.room}
                  </Text>
                </View>
              </Pressable>
            </>

          )}

          {/* UPCOMING DEADLINES */}

          <Text style={[styles.sectionTitle, { color: colors.textDark }]}>
            Upcoming Deadlines
          </Text>

          {upcomingTasks.length === 0 ? (

            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <MaterialIcons
                name="task-alt"
                size={30}
                color={colors.textLight}
              />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                {subjects.length === 0
                  ? 'Add a subject to start tracking deadlines.'
                  : 'Nothing due right now. Well played.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  subjects.length === 0
                    ? 'Add your first subject'
                    : 'Open subjects to add a task'
                }
                onPress={() => navigateTo?.('Subjects')}
                style={({ pressed }) => [
                  styles.emptyAction,
                  { backgroundColor: colors.primary },
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={styles.emptyActionText}>
                  {subjects.length === 0
                    ? 'Add Subject'
                    : 'Add a Task'}
                </Text>
              </Pressable>
            </View>

          ) : (

            upcomingTasks.map((item) => renderTaskCard(item))

          )}

          {/* PROGRESS */}

          {tasks.length > 0 && (

            <>
              <Text style={[styles.sectionTitle, { color: colors.textDark }]}>
                Your Progress
              </Text>

              <View style={[styles.progressCard, { backgroundColor: colors.card }]}>

                <ProgressRing
                  percentage={completionPercent}
                  size={104}
                  thickness={9}
                  color={
                    completionPercent >= 70
                      ? colors.success
                      : completionPercent >= 40
                        ? colors.warning
                        : colors.primary
                  }
                  trackColor={
                    isDarkMode
                      ? 'rgba(165,180,252,0.16)'
                      : '#E5E7EB'
                  }
                  reduceMotion={reduceMotion}
                >
                  <CountUp
                    value={completionPercent}
                    suffix="%"
                    reduceMotion={reduceMotion}
                    style={[styles.ringValue, { color: colors.textDark }]}
                  />
                </ProgressRing>

                <View style={styles.progressInfo}>
                  <Text style={[styles.progressTitle, { color: colors.textDark }]}>
                    {completed.length} of {tasks.length} tasks done
                  </Text>
                  <Text style={[styles.progressMeta, { color: colors.textLight }]}>
                    {pending.length === 0
                      ? 'Everything is complete.'
                      : `${pending.length} still pending${overdueTasks.length > 0 ? `, ${overdueTasks.length} overdue` : ''}.`}
                  </Text>
                </View>

              </View>
            </>

          )}

          {/* ATTENDANCE */}

          <View style={styles.sectionHeaderRow}>
            <Text
              style={[styles.sectionTitle, { color: colors.textDark, marginBottom: 0 }]}
            >
              Attendance
            </Text>
            {attendanceSummary.length > 3 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  showAllAttendance
                    ? 'Show fewer subjects'
                    : 'Show all subjects'
                }
                onPress={() => {
                  LayoutAnimation.configureNext(
                    LayoutAnimation.Presets.easeInEaseOut
                  );
                  setShowAllAttendance((value) => !value);
                }}
                style={({ pressed }) => [
                  styles.sectionAction,
                  pressed && styles.cardPressed,
                ]}
              >
                <Text style={[styles.sectionActionText, { color: colors.primary }]}>
                  {showAllAttendance ? 'Show less' : 'View all'}
                </Text>
              </Pressable>
            )}
          </View>

          {attendanceSummary.length === 0 ? (

            <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
              <MaterialIcons
                name="fact-check"
                size={30}
                color={colors.textLight}
              />
              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                Add subjects to track attendance.
              </Text>
            </View>

          ) : (

            <>
              {/* Averaging unconfigured subjects used to report a
                  confident 100% for a dashboard nobody had set up. */}

              {hasAttendanceData ? (

                <View
                  style={[
                    styles.attendanceSummaryRow,
                    { backgroundColor: colors.card },
                  ]}
                >
                  <View style={styles.flexOne}>
                    <Text style={[styles.summaryLabel, { color: colors.textLight }]}>
                      Average across {configuredAttendance.length}{' '}
                      {configuredAttendance.length === 1 ? 'subject' : 'subjects'}
                      {unconfiguredCount > 0
                        ? ` · ${unconfiguredCount} not set up`
                        : ''}
                    </Text>
                    <AnimatedBar
                      percentage={averageAttendance}
                      color={getAttendanceTone(averageAttendance, colors)}
                      trackColor={
                        isDarkMode ? colors.surface : '#E5E7EB'
                      }
                      style={styles.summaryBar}
                      pulse={averageAttendance < ATTENDANCE_THRESHOLD}
                      reduceMotion={reduceMotion}
                    />
                  </View>
                  <CountUp
                    value={averageAttendance}
                    suffix="%"
                    reduceMotion={reduceMotion}
                    style={[
                      styles.summaryValue,
                      {
                        color: getAttendanceTone(
                          averageAttendance,
                          colors
                        ),
                      },
                    ]}
                  />
                </View>

              ) : (

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Set up attendance for ${attendanceSummary.length} subjects`}
                  accessibilityHint="Opens Attendance"
                  onPress={() => navigateTo?.('Attendance')}
                  style={({ hovered, pressed }) => [
                    styles.attendanceSummaryRow,
                    { backgroundColor: colors.card },
                    hovered && styles.dashboardCardHover,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <View style={styles.flexOne}>
                    <Text style={[styles.summaryLabel, { color: colors.textLight }]}>
                      Attendance not set up yet
                    </Text>
                    <Text
                      style={[
                        styles.riskyNote,
                        { color: colors.primary, marginTop: 4 },
                      ]}
                    >
                      Add your totals to start tracking
                    </Text>
                  </View>
                  <MaterialIcons
                    name="chevron-right"
                    size={22}
                    color={colors.textLight}
                  />
                </Pressable>

              )}

              {riskySubjects.length > 0 && !showAllAttendance && (
                <Text style={[styles.riskyNote, { color: colors.danger }]}>
                  {riskySubjects.length} subject
                  {riskySubjects.length === 1 ? '' : 's'} below {ATTENDANCE_THRESHOLD}%
                </Text>
              )}

              {visibleAttendance.map((item) => {

                const tone =
                  item.hasRecord
                    ? getAttendanceTone(item.percentage, colors)
                    : colors.textLight;

                const atRisk =
                  item.hasRecord &&
                  item.percentage < ATTENDANCE_THRESHOLD;

                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}${item.type ? `, ${item.type}` : ''}, ${item.percentage} percent attendance, ${item.absences} absences`}
                    accessibilityHint="Opens Attendance"
                    style={({ hovered, pressed }) => [
                      styles.attendanceCard,
                      { backgroundColor: colors.card },
                      hovered && styles.dashboardCardHover,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => navigateTo?.('Attendance')}
                  >
                    <View
                      style={[
                        styles.attendanceAccent,
                        { backgroundColor: tone },
                      ]}
                    />

                    <View style={styles.attendanceTop}>
                      <View style={styles.flexOne}>
                        <View style={styles.attendanceNameRow}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.taskTitle,
                              styles.flexShrink,
                              { color: colors.textDark },
                            ]}
                          >
                            {item.name}
                          </Text>

                          {/* Two subjects can share the same name (e.g. a
                              "Lab" and "Theory" split of the same course),
                              so the type badge is what actually tells them
                              apart here - without it both rows read as an
                              identical, confusing duplicate. */}
                          {!!item.type && (
                            <View
                              style={[
                                styles.attendanceTypeBadge,
                                { backgroundColor: `${tone}1A` },
                              ]}
                            >
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.attendanceTypeText,
                                  { color: tone },
                                ]}
                              >
                                {item.type}
                              </Text>
                            </View>
                          )}
                        </View>
                        <Text style={[styles.taskSubject, { color: colors.textLight }]}>
                          {item.hasRecord
                            ? `${item.remainingAbsences} more absence${item.remainingAbsences === 1 ? '' : 's'} allowed`
                            : 'Tap to set up attendance'}
                        </Text>
                      </View>

                      {item.hasRecord ? (
                        <CountUp
                          value={item.percentage}
                          suffix="%"
                          reduceMotion={reduceMotion}
                          style={[styles.attendancePercent, { color: tone }]}
                        />
                      ) : (
                        <Text
                          style={[
                            styles.attendancePercent,
                            { color: colors.textLight },
                          ]}
                        >
                          —
                        </Text>
                      )}
                    </View>

                    <AnimatedBar
                      percentage={item.hasRecord ? item.percentage : 0}
                      color={item.hasRecord ? tone : colors.border}
                      trackColor={
                        isDarkMode ? colors.surface : '#E5E7EB'
                      }
                      pulse={atRisk && item.hasRecord}
                      reduceMotion={reduceMotion}
                      style={styles.attendanceBar}
                    />
                  </Pressable>
                );
              })}
            </>

          )}

          {/* QUOTE */}

          <View
            style={[
              styles.quoteCard,
              { backgroundColor: colors.primary },
            ]}
          >
            <View {...decorative} style={styles.footerGlow} />
            <Text style={styles.quote}>
              Small progress every day adds up to big results.
            </Text>
          </View>

          {/* So a dashboard that quietly stopped refreshing cannot
              pass itself off as current. */}

          <Text
            style={[
              styles.syncNote,
              { color: colors.textLight },
            ]}
          >
            {lastSyncedAt
              ? `Last updated ${formatDueTime(lastSyncedAt)}`
              : 'Not synced yet'}
          </Text>

        </Animated.View>

      </ScrollView>

      {/* QUICK ADD */}

      <Animated.View
        style={[
          styles.fabWrap,
          {
            opacity: fabAnim,
            transform: [
              { scale: fabAnim },
            ],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a new task"
          accessibilityHint={
            subjects.length > 1
              ? 'Choose a subject to add a task to'
              : 'Opens the subject so you can add a task'
          }
          style={({ hovered, pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary },
            hovered && styles.primaryButtonHover,
            pressed && styles.cardPressed,
          ]}
          onPress={handleQuickAdd}
        >
          <MaterialIcons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* SUBJECT PICKER
          Quick add used to leave the student on the Subjects list to
          find their own way to a task form. */}

      <Modal
        visible={subjectPickerVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setSubjectPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textDark }]}>
                Add task to
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSubjectPickerVisible(false)}
                style={({ pressed }) => [
                  styles.modalClose,
                  pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name="close"
                  size={22}
                  color={colors.textLight}
                />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.modalList}
            >
              {subjects.map((subject) => {

                const pendingCount =
                  pending.filter(
                    (task) => task.subjectId === subject.id
                  ).length;

                return (
                  <Pressable
                    key={subject.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add a task to ${subject.name}`}
                    onPress={() => {
                      setSubjectPickerVisible(false);
                      openSubjectDetails?.(subject);
                    }}
                    style={({ hovered, pressed }) => [
                      styles.pickerRow,
                      { borderColor: colors.border },
                      hovered && styles.dashboardCardHover,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View
                      style={[
                        styles.pickerIcon,
                        {
                          backgroundColor: isDarkMode
                            ? 'rgba(91,95,239,0.18)'
                            : '#EEF2FF',
                        },
                      ]}
                    >
                      <MaterialIcons
                        name={
                          subject.type === 'Lab'
                            ? 'science'
                            : 'menu-book'
                        }
                        size={20}
                        color={colors.primary}
                      />
                    </View>

                    <View style={styles.flexOne}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.pickerTitle,
                          { color: colors.textDark },
                        ]}
                      >
                        {subject.name}
                      </Text>
                      <Text
                        style={[
                          styles.pickerMeta,
                          { color: colors.textLight },
                        ]}
                      >
                        {pendingCount} pending
                      </Text>
                    </View>

                    <MaterialIcons
                      name="chevron-right"
                      size={22}
                      color={colors.textLight}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* TASK LIST MODAL */}

      <Modal
        visible={Boolean(taskFilter)}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setTaskFilter(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.card },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.textDark }]}>
                {taskFilter} Tasks ({filteredTasks.length})
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setTaskFilter(null)}
                style={({ pressed }) => [
                  styles.modalClose,
                  pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name="close"
                  size={22}
                  color={colors.textLight}
                />
              </Pressable>
            </View>

            {filteredTasks.length === 0 ? (

              <Text style={[styles.emptyText, { color: colors.textLight }]}>
                No {String(taskFilter).toLowerCase()} tasks yet.
              </Text>

            ) : (

              <ScrollView
                showsVerticalScrollIndicator={false}
                style={styles.modalScroll}
              >
                {filteredTasks.map((task) => {

                  const info = getDeadlineInfo(task);

                  return (
                    <Pressable
                      key={task.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${task.title}, ${task.subjectName}, ${info.label}`}
                      style={({ pressed }) => [
                        styles.modalRow,
                        { borderColor: colors.border },
                        pressed && styles.cardPressed,
                      ]}
                      onPress={() => openTaskSubject(task)}
                    >
                      <View style={styles.flexOne}>
                        <Text
                          numberOfLines={1}
                          style={[styles.modalTaskTitle, { color: colors.textDark }]}
                        >
                          {task.title}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[styles.modalTaskMeta, { color: colors.textLight }]}
                        >
                          {task.subjectName} · {task.type} · {info.label}
                        </Text>
                      </View>
                      <MaterialIcons
                        name="chevron-right"
                        size={22}
                        color={colors.primary}
                      />
                    </Pressable>
                  );
                })}
              </ScrollView>

            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: HEADER_TOP_PADDING,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },

  flexOne: {
    flex: 1,
  },

  skeletonContent: {
    gap: 18,
    paddingBottom: SCREEN_BOTTOM_PADDING,
  },

  skeletonRow: {
    flexDirection: 'row',
    gap: 12,
  },

  /* HERO */

  hero: {
    borderRadius: 26,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },

  waveBack: {
    position: 'absolute',
    left: -60,
    right: -50,
    top: 74,
    height: 96,
    backgroundColor: 'rgba(255,255,255,0.40)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 170,
    transform: [{ rotate: '-6deg' }],
  },

  darkWaveBack: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },

  waveMiddle: {
    position: 'absolute',
    left: -40,
    right: -60,
    bottom: -30,
    height: 110,
    backgroundColor: 'rgba(221,214,254,0.46)',
    borderTopLeftRadius: 170,
    borderTopRightRadius: 130,
    transform: [{ rotate: '5deg' }],
  },

  darkWaveMiddle: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },

  waveFront: {
    position: 'absolute',
    left: -30,
    right: -40,
    bottom: -46,
    height: 96,
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderTopLeftRadius: 140,
    borderTopRightRadius: 150,
    transform: [{ rotate: '-4deg' }],
  },

  darkWaveFront: {
    backgroundColor: 'rgba(30,41,59,0.42)',
  },

  curveLineOne: {
    position: 'absolute',
    right: -30,
    top: 40,
    left: '44%',
    height: 60,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.13)',
    borderRadius: 130,
    transform: [{ rotate: '-12deg' }],
  },

  curveLineTwo: {
    position: 'absolute',
    left: -26,
    bottom: 30,
    right: '52%',
    height: 50,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.10)',
    borderRadius: 120,
    transform: [{ rotate: '9deg' }],
  },

  darkCurveLine: {
    borderColor: 'rgba(165,180,252,0.16)',
  },

  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 3,
  },

  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },

  menuButton: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  themeButton: {
    position: 'relative',
    width: 50,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  heroBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },

  heroBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
  },

  heroContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    zIndex: 3,
  },

  heroTextBlock: {
    flex: 1,
  },

  welcome: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
  },

  title: {
    marginTop: 4,
    fontSize: 30,
    fontWeight: 'bold',
  },

  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },

  streakText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  illustrationWrap: {
    width: 110,
    height: 96,
    position: 'relative',
  },

  sparkleOne: {
    position: 'absolute',
    right: 12,
    top: 4,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: 'rgba(196,181,253,0.9)',
    transform: [{ rotate: '45deg' }],
  },

  sparkleTwo: {
    position: 'absolute',
    left: 6,
    bottom: 20,
    width: 8,
    height: 8,
    borderRadius: 3,
    backgroundColor: 'rgba(250,204,21,0.8)',
    transform: [{ rotate: '45deg' }],
  },

  rocketBubble: {
    position: 'absolute',
    right: 26,
    top: 20,
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  bookStack: {
    position: 'absolute',
    left: 8,
    bottom: 0,
    width: 46,
  },

  bookTop: {
    height: 8,
    borderRadius: 3,
    backgroundColor: '#FBBF24',
    marginBottom: 4,
  },

  bookMiddle: {
    height: 8,
    borderRadius: 3,
    backgroundColor: '#8B5CF6',
    marginBottom: 4,
    width: '86%',
  },

  bookBottom: {
    height: 8,
    borderRadius: 3,
    backgroundColor: '#5B5FEF',
    width: '70%',
  },

  /* GLANCE */

  glanceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 16,
    zIndex: 3,
  },

  glanceItem: {
    flex: 1,
    alignItems: 'center',
  },

  glanceValue: {
    fontSize: 19,
    fontWeight: 'bold',
  },

  glanceLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },

  glanceDivider: {
    width: 1,
    height: 26,
    opacity: 0.5,
  },

  /* STATS */

  statsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },

  statCard: {
    flex: 1,
    borderRadius: CARD_RADIUS,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  statNumber: {
    fontSize: 26,
    fontWeight: 'bold',
  },

  statLabel: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
  },

  statIconBlue: {
    marginTop: 10,
  },

  statIconAmber: {
    marginTop: 10,
  },

  statIconGreen: {
    marginTop: 10,
  },

  statChevron: {
    position: 'absolute',
    top: 8,
    right: 8,
    opacity: 0.55,
  },

  /* BODY */

  contentShell: {
    position: 'relative',
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },

  bodyWaveOne: {
    position: 'absolute',
    left: -50,
    right: -40,
    top: 40,
    height: 120,
    backgroundColor: 'rgba(238,233,255,0.5)',
    borderTopLeftRadius: 160,
    borderTopRightRadius: 140,
    transform: [{ rotate: '-5deg' }],
  },

  darkBodyWave: {
    backgroundColor: 'rgba(99,102,241,0.07)',
  },

  bodyWaveTwo: {
    position: 'absolute',
    left: -40,
    right: -50,
    bottom: -40,
    height: 140,
    backgroundColor: 'rgba(221,214,254,0.34)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 170,
    transform: [{ rotate: '4deg' }],
  },

  darkBodyWaveTwo: {
    backgroundColor: 'rgba(124,58,237,0.08)',
  },

  bodyCurveOne: {
    position: 'absolute',
    right: -30,
    top: 120,
    left: '40%',
    height: 70,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.10)',
    borderRadius: 140,
    transform: [{ rotate: '-10deg' }],
  },

  darkBodyCurve: {
    borderColor: 'rgba(165,180,252,0.14)',
  },

  /* SECTIONS */

  sectionTitle: {
    fontSize: TYPOGRAPHY.sectionTitle,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 12,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    marginBottom: 12,
  },

  sectionAction: {
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 8,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  sectionActionText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* LIVE CLASS */

  liveCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    marginTop: 4,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  liveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },

  liveTitle: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
    letterSpacing: 0.4,
  },

  liveMeta: {
    marginTop: 3,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
  },

  /* TIP */

  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    marginTop: 12,
  },

  tipText: {
    flex: 1,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 19,
    fontWeight: '600',
  },

  /* CLASS ROW */

  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    marginBottom: 10,
    ...SHADOW,
  },

  classTimeBlock: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    minWidth: 74,
    alignItems: 'center',
  },

  classTime: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  classSubject: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  classMeta: {
    marginTop: 2,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  markRow: {
    flexDirection: 'row',
    gap: 8,
  },

  markButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  markedAttendanceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 12,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  markedAttendanceText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '800',
  },

  /* ATTENDANCE WINDOW */

  windowNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 10,
    maxWidth: 130,
  },

  windowNoticeText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  markBurst: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
  },

  liveRemaining: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },

  liveRemainingText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '800',
  },

  /* TIP ACTION */

  tipAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  tipActionText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '800',
  },

  /* VIEW ALL */

  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
    paddingHorizontal: 4,
    paddingVertical: 2,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  viewAllText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '800',
  },

  /* SUBJECT PICKER */

  modalList: {
    maxHeight: 380,
  },

  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  pickerIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },

  pickerTitle: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: '800',
  },

  pickerMeta: {
    marginTop: 2,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  /* SYNC */

  syncNote: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
    textAlign: 'center',
  },

  /* CARDS */

  nextClassCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingLeft: 20,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  paperAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },

  classAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },

  nextClassIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },

  nextClassInfo: {
    flex: 1,
  },

  nextClassTitle: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  nextClassMeta: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  nextClassRoom: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  countdownPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },

  countdownText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  taskCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 20,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  taskAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },

  taskIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  taskInfo: {
    flex: 1,
    paddingRight: 8,
  },

  taskTitle: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  taskSubject: {
    marginTop: 3,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  taskType: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: 'bold',
  },

  deadlineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },

  deadlineText: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  /* PROGRESS */

  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    padding: 18,
    borderRadius: CARD_RADIUS,
    ...SHADOW,
  },

  ringValue: {
    fontSize: 20,
    fontWeight: 'bold',
  },

  progressInfo: {
    flex: 1,
  },

  progressTitle: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  progressMeta: {
    marginTop: 6,
    fontSize: TYPOGRAPHY.tiny,
    lineHeight: 18,
    fontWeight: '600',
  },

  /* ATTENDANCE */

  attendanceSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    ...SHADOW,
  },

  summaryLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  summaryBar: {
    marginTop: 9,
  },

  summaryValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },

  riskyNote: {
    marginBottom: 10,
    marginLeft: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  attendanceCard: {
    position: 'relative',
    padding: 16,
    paddingLeft: 20,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  attendanceAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },

  attendanceTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  attendanceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  flexShrink: {
    flexShrink: 1,
  },

  attendanceTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    flexShrink: 0,
  },

  attendanceTypeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  attendancePercent: {
    fontSize: 19,
    fontWeight: 'bold',
  },

  attendanceBar: {
    marginTop: 12,
  },

  /* EMPTY */

  emptyCard: {
    alignItems: 'center',
    padding: 26,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    ...SHADOW,
  },

  emptyText: {
    marginTop: 10,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },

  emptyAction: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 12,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  emptyActionText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* QUOTE */

  quoteCard: {
    position: 'relative',
    marginTop: 22,
    padding: 22,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },

  footerGlow: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  quote: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body,
    fontWeight: '700',
    lineHeight: 23,
    textAlign: 'center',
  },

  /* FAB */

  fabWrap: {
    position: 'absolute',
    right: 20,
    bottom: SCREEN_BOTTOM_PADDING - 30,
  },

  fab: {
    width: 56,
    height: 56,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  /* MODAL */

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },

  modalCard: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    maxHeight: '76%',
    borderRadius: CARD_RADIUS,
    padding: 20,
    ...SHADOW,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },

  modalTitle: {
    flex: 1,
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  modalClose: {
    padding: 4,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  modalScroll: {
    maxHeight: 420,
  },

  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  modalTaskTitle: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  modalTaskMeta: {
    marginTop: 3,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  /* INTERACTION */

  dashboardCardHover: {
    transform: [{ translateY: -3 }],
  },

  iconButtonHover: {
    backgroundColor: 'rgba(91,95,239,0.10)',
  },

  primaryButtonHover: {
    transform: [{ translateY: -2 }],
  },

  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

});
