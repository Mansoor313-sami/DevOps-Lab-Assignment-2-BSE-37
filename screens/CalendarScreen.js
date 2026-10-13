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
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  RefreshControl,
  AppState,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
  Platform,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import {
  Calendar,
} from 'react-native-calendars';

import COLORS from '../constants/colors';

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

import SwipeableRow from '../components/SwipeableRow';

import {
  loadAllUserTasks,
  loadUserClassSchedules,
  loadUserDateSheets,
  loadUserSubjects,
  saveSubjectTasks,
} from '../utils/localData';

import {
  onDataChanged,
} from '../utils/dataEvents';

import {
  cancelTaskNotifications,
} from '../utils/notifications';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ------------------------------------------------------------------
   CONSTANTS
------------------------------------------------------------------- */

const POLL_INTERVAL = 30000;

/* Safety valve for the isLoadingRef guard below: if a load never
   settles (a hung read, for example) that ref would otherwise stay
   true forever, silently no-oping every later poll, event-driven
   reload and pull-to-refresh. Treating it as stale after this long
   lets the screen recover on its own instead of wedging until the
   app is restarted. */
const LOAD_STALL_TIMEOUT = 20000;

const CLASS_COLOR_LIGHT = '#3B82F6';
const CLASS_COLOR_DARK = '#60A5FA';

const FILTERS = [
  { key: 'all', label: 'All', icon: 'apps' },
  { key: 'task', label: 'Tasks', icon: 'assignment' },
  { key: 'paper', label: 'Papers', icon: 'description' },
  { key: 'class', label: 'Classes', icon: 'school' },
];

const MONTH_NAMES = [
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
   DATE HELPERS
------------------------------------------------------------------- */

const getDateKeyFromDate = (date) => {

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const getTodayDateString = () =>
  getDateKeyFromDate(new Date());

const MONTH_INDEX = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

const convertTaskDate = (task) => {

  try {

    if (task?.deadlineAt) {
      const isoDate = new Date(task.deadlineAt);

      if (!Number.isNaN(isoDate.getTime())) {
        return getDateKeyFromDate(isoDate);
      }
    }

    const dateString = task?.deadline;

    if (typeof dateString !== 'string') {
      return null;
    }

    const parts = dateString.split(' ');
    const day = parts[0];
    const month = parts[1];
    const year = parts[2];

    if (!day || !month || !year || !MONTH_INDEX[month]) {
      return null;
    }

    return `${year}-${MONTH_INDEX[month]}-${day.padStart(2, '0')}`;

  } catch {

    return null;
  }
};

/* ------------------------------------------------------------------
   EVENT BUILDERS (pure — testable independent of the component)
------------------------------------------------------------------- */

const buildTaskEvents = (tasks) =>
  (tasks || [])
    .map((task) => {

      const dateKey = convertTaskDate(task);

      if (!dateKey) {
        return null;
      }

      return {
        id: `task_${task.id}`,
        eventType: 'task',
        dateKey,
        title: task.title,
        subjectName: task.subjectName,
        subjectId: task.subjectId,
        taskId: task.id,
        notificationIds: task.notificationIds,
        type: task.type,
        status: task.status,
        badgeText: task.status,
        message: task.subjectName
          ? `${task.subjectName} ka ${task.title} ${(task.status || '').toLowerCase()} hai.`
          : `${task.title} ${(task.status || '').toLowerCase()} hai.`,
      };
    })
    .filter(Boolean);

const buildPaperEvents = (papers) =>
  (papers || [])
    .filter((paper) => paper.isArchived !== true)
    .map((paper) => {

      const dateKey =
        getDateKeyFromDate(new Date(paper.examDate));

      if (!dateKey) {
        return null;
      }

      return {
        id: `paper_${paper.id}`,
        eventType: 'paper',
        dateKey,
        title: `${paper.subjectName} Paper`,
        subjectName: paper.subjectName,
        type: paper.subjectType || 'Paper',
        status: 'Upcoming',
        badgeText: 'Paper',
        room: paper.room,
        timeLabel: paper.timeLabel,
        message: `${paper.subjectName} ${paper.subjectType || ''} paper at ${paper.timeLabel} in ${paper.room}.`,
      };
    })
    .filter(Boolean);

const buildClassEvents = (scheduleMap, subjects) => {

  const subjectById = {};

  (subjects || []).forEach((subject) => {
    subjectById[subject.id] = subject;
  });

  const today = new Date();
  const startDate = new Date(today.getFullYear() - 1, 0, 1);
  const endDate = new Date(today.getFullYear() + 1, 11, 31);
  const events = [];

  Object.entries(scheduleMap || {}).forEach(
    ([subjectId, schedules]) => {

      const subject = subjectById[subjectId];

      Object.values(schedules || {}).forEach((schedule) => {

        const cursor = new Date(startDate);

        while (cursor <= endDate) {

          const weekday = cursor.getDay() + 1;

          if (weekday === Number(schedule.weekday)) {

            const dateKey = getDateKeyFromDate(cursor);

            events.push({
              id: `class_${schedule.id}_${dateKey}`,
              eventType: 'class',
              dateKey,
              title: `${subject?.name || 'Class'} Class`,
              subjectName: subject?.name || 'Subject',
              subjectId,
              type: subject?.type || 'Class',
              status: 'Upcoming',
              badgeText: 'Class',
              room: schedule.room,
              timeLabel: schedule.timeLabel,
              message: `${subject?.name || 'Your'} class at ${schedule.timeLabel} in ${schedule.room}.`,
            });
          }

          cursor.setDate(cursor.getDate() + 1);
        }
      });
    }
  );

  return events;
};

const sortEvents = (first, second) => {

  if (first.dateKey !== second.dateKey) {
    return first.dateKey.localeCompare(second.dateKey);
  }

  return (first.timeLabel || '').localeCompare(
    second.timeLabel || ''
  );
};

const filterByType = (events, filterKey) =>
  filterKey === 'all'
    ? events
    : events.filter((event) => event.eventType === filterKey);

/* Multiple event types on the same day used to overwrite each
   other's single dot. This builds up to three dots per day, one
   per event type, so nothing is silently hidden. */

const buildMarkedDates = (events, colors, classColor) => {

  const byDate = {};

  events.forEach((event) => {

    if (!event.dateKey) {
      return;
    }

    if (!byDate[event.dateKey]) {
      byDate[event.dateKey] = {
        task: null,
        paper: null,
        class: null,
      };
    }

    const bucket = byDate[event.dateKey];

    if (event.eventType === 'task') {

      if (event.status !== 'Completed') {
        bucket.task = colors.primary;
      } else if (!bucket.task) {
        bucket.task = colors.success;
      }

    } else if (event.eventType === 'paper') {

      bucket.paper = colors.warning;

    } else if (event.eventType === 'class') {

      bucket.class = classColor;
    }
  });

  const marks = {};

  Object.entries(byDate).forEach(([dateKey, bucket]) => {

    const dots = [];

    if (bucket.task) {
      dots.push({ key: 'task', color: bucket.task });
    }

    if (bucket.paper) {
      dots.push({ key: 'paper', color: bucket.paper });
    }

    if (bucket.class) {
      dots.push({ key: 'class', color: bucket.class });
    }

    if (dots.length) {
      marks[dateKey] = { dots };
    }
  });

  return marks;
};

const buildSignature = (payload) => {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return String(Date.now());
  }
};

/* ------------------------------------------------------------------
   SCREEN
------------------------------------------------------------------- */

export default function CalendarScreen({
  goBack,
  canGoBack,
  currentUser,
  navigateTo,
  openSubjectDetails,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const responsive = useResponsive();

  const {
    showError: showErrorToast,
    showSuccess: showSuccessToast,
  } = useToast();

  const classColor =
    isDarkMode ? CLASS_COLOR_DARK : CLASS_COLOR_LIGHT;

  const todayDate = getTodayDateString();

  /* RAW DATA */

  const [tasksRaw, setTasksRaw] = useState([]);
  const [papersRaw, setPapersRaw] = useState([]);
  const [scheduleMap, setScheduleMap] = useState({});
  const [subjectsList, setSubjectsList] = useState([]);

  /* UI STATE */

  const [selectedDate, setSelectedDate] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [visibleMonth, setVisibleMonth] =
    useState(todayDate.slice(0, 7));
  const [calendarToken, setCalendarToken] = useState(0);
  const [filterWidth, setFilterWidth] = useState(0);
  const [busyEventId, setBusyEventId] = useState(null);

  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const signatureRef = useRef('');
  const isForeground = useRef(true);
  const isLoadingRef = useRef(false);
  const loadStartedAtRef = useRef(0);
  const isFirstLoad = useRef(true);

  /* ANIMATIONS */

  const headerAnim = useRef(new Animated.Value(0)).current;
  const pillAnim = useRef(new Animated.Value(0)).current;
  const jumpAnim = useRef(new Animated.Value(0)).current;
  const dateChangeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {

    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();

  }, [headerAnim]);

  const showJumpToToday =
    visibleMonth !== todayDate.slice(0, 7);

  useEffect(() => {

    Animated.timing(jumpAnim, {
      toValue: showJumpToToday ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();

  }, [showJumpToToday, jumpAnim]);

  /* ---------------------------------------------------------------
     LOAD
  --------------------------------------------------------------- */

  const loadCalendarData = useCallback(async ({
    silent = false,
  } = {}) => {

    if (!currentUser?.id) {
      setIsInitialLoading(false);
      return;
    }

    /* A load that started more than LOAD_STALL_TIMEOUT ago is
       treated as abandoned rather than in-progress, so a single
       hung read cannot lock every future refresh out forever. */
    if (
      isLoadingRef.current &&
      Date.now() - loadStartedAtRef.current < LOAD_STALL_TIMEOUT
    ) {
      return;
    }

    isLoadingRef.current = true;
    loadStartedAtRef.current = Date.now();

    try {

      const [
        { tasks: nextTasks },
        nextPapers,
        nextScheduleMap,
        nextSubjects,
      ] = await Promise.all([
        loadAllUserTasks(currentUser.id),
        loadUserDateSheets(currentUser.id),
        loadUserClassSchedules(currentUser.id),
        loadUserSubjects(currentUser.id),
      ]);

      /* The read itself succeeded, whether or not the data actually
         changed below - clear any previous failure so a stale error
         banner does not linger after a background refresh recovers. */
      setLoadFailed(false);

      const signature = buildSignature({
        nextTasks,
        nextPapers,
        nextScheduleMap,
        nextSubjects,
      });

      /* Nothing changed since the last poll, so skip the
         re-render and the expensive class-event rebuild. */

      if (signature === signatureRef.current) {
        return;
      }

      signatureRef.current = signature;

      setTasksRaw(nextTasks);
      setPapersRaw(nextPapers);
      setScheduleMap(nextScheduleMap);
      setSubjectsList(nextSubjects);

    } catch (error) {

      console.log(error);

      /* A failed background refresh must stay visible somewhere -
         otherwise it silently renders as "nothing scheduled" instead
         of "we could not check". The toast still only fires for the
         very first load so background polls don't spam it. */
      setLoadFailed(true);

      if (isFirstLoad.current && !silent) {
        showErrorToast(
          'Could not load your calendar. Check your connection and pull down to retry.'
        );
      }

    } finally {

      isFirstLoad.current = false;
      isLoadingRef.current = false;
      setIsInitialLoading(false);
    }

  }, [currentUser, showErrorToast]);

  useEffect(() => {

    if (!currentUser?.id) {
      setIsInitialLoading(false);
      return undefined;
    }

    loadCalendarData();

    const interval = setInterval(() => {

      if (isForeground.current) {
        loadCalendarData({ silent: true });
      }

    }, POLL_INTERVAL);

    return () => clearInterval(interval);

  }, [currentUser, loadCalendarData]);

  useEffect(() => {

    if (!currentUser?.id) {
      return undefined;
    }

    const unsubscribe = onDataChanged(() => {
      signatureRef.current = '';
      loadCalendarData({ silent: true });
    });

    return unsubscribe;

  }, [currentUser, loadCalendarData]);

  useEffect(() => {

    const subscription = AppState.addEventListener(
      'change',
      (nextState) => {

        const active = nextState === 'active';

        isForeground.current = active;

        if (active) {
          loadCalendarData({ silent: true });
        }
      }
    );

    return () => subscription.remove();

  }, [loadCalendarData]);

  const handleRefresh = async () => {

    setIsRefreshing(true);

    /* A user pulling to refresh is explicitly asking to retry, so a
       stuck earlier load (poll, event-driven reload, ...) must never
       be allowed to silently no-op this gesture - clear the guard
       before trying again rather than waiting for it to go stale. */
    isLoadingRef.current = false;

    try {
      signatureRef.current = '';
      await loadCalendarData();
    } finally {
      setIsRefreshing(false);
    }
  };

  /* ---------------------------------------------------------------
     DERIVED EVENTS
  --------------------------------------------------------------- */

  const taskEvents = useMemo(
    () => buildTaskEvents(tasksRaw),
    [tasksRaw]
  );

  const paperEvents = useMemo(
    () => buildPaperEvents(papersRaw),
    [papersRaw]
  );

  const classEvents = useMemo(
    () => buildClassEvents(scheduleMap, subjectsList),
    [scheduleMap, subjectsList]
  );

  const allEvents = useMemo(
    () =>
      [...taskEvents, ...paperEvents, ...classEvents].sort(
        sortEvents
      ),
    [taskEvents, paperEvents, classEvents]
  );

  const filteredForCalendar = useMemo(
    () => filterByType(allEvents, activeFilter),
    [allEvents, activeFilter]
  );

  const dotMarks = useMemo(
    () => buildMarkedDates(filteredForCalendar, colors, classColor),
    [filteredForCalendar, colors, classColor]
  );

  const finalMarkedDates = useMemo(() => {

    const marks = { ...dotMarks };

    if (selectedDate) {
      marks[selectedDate] = {
        ...(marks[selectedDate] || {}),
        selected: true,
        selectedColor: colors.primary,
      };
    }

    return marks;

  }, [dotMarks, selectedDate, colors.primary]);

  const selectedDateEvents = useMemo(() => {

    if (!selectedDate) {
      return [];
    }

    return filteredForCalendar.filter(
      (event) => event.dateKey === selectedDate
    );

  }, [filteredForCalendar, selectedDate]);

  const monthSummary = useMemo(() => {

    const counts = { task: 0, paper: 0, class: 0 };

    allEvents.forEach((event) => {

      if (
        event.dateKey?.slice(0, 7) === visibleMonth &&
        counts[event.eventType] !== undefined
      ) {
        counts[event.eventType] += 1;
      }
    });

    return counts;

  }, [allEvents, visibleMonth]);

  const monthLabel =
    MONTH_NAMES[Number(visibleMonth.split('-')[1]) - 1] || '';

  /* ---------------------------------------------------------------
     ACTIONS
  --------------------------------------------------------------- */

  const handleDateSelect = (day) => {

    easeNext(200);

    dateChangeAnim.setValue(0);

    Animated.timing(dateChangeAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();

    setSelectedDate(day.dateString);
  };

  const handleMonthChange = (month) => {

    setVisibleMonth(
      `${month.year}-${String(month.month).padStart(2, '0')}`
    );
  };

  const jumpToToday = () => {

    easeNext(200);

    setSelectedDate(todayDate);
    setVisibleMonth(todayDate.slice(0, 7));
    setCalendarToken((token) => token + 1);
  };

  const selectFilter = (key, index) => {

    setActiveFilter(key);

    Animated.timing(pillAnim, {
      toValue: index,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    easeNext();
  };

  const handleEventPress = (event) => {

    if (event.eventType === 'paper') {

      if (typeof navigateTo === 'function') {
        navigateTo('Date Sheet');
      }

      return;
    }

    const subject = subjectsList.find(
      (item) => item.id === event.subjectId
    );

    if (subject && typeof openSubjectDetails === 'function') {
      openSubjectDetails(subject);
      return;
    }

    showErrorToast(
      'This subject could not be found — it may have been deleted.'
    );
  };

  const completeEventTask = async (event) => {

    if (!event.subjectId || !event.taskId) {
      return;
    }

    setBusyEventId(event.id);

    const previousTasks = tasksRaw;

    try {

      if (event.notificationIds?.length) {
        await cancelTaskNotifications(
          event.notificationIds,
          currentUser.id
        );
      }

      const nextTasksRaw = tasksRaw.map((task) =>
        task.id === event.taskId
          ? {
              ...task,
              status: 'Completed',
              completedAt: new Date().toISOString(),
              notificationIds: [],
            }
          : task
      );

      const subjectTasks = nextTasksRaw
        .filter((task) => task.subjectId === event.subjectId)
        .map(({ subjectName, subjectId, ...rest }) => rest);

      await saveSubjectTasks(
        currentUser.id,
        event.subjectId,
        subjectTasks
      );

      easeNext();

      setTasksRaw(nextTasksRaw);
      signatureRef.current = '';

      showSuccessToast(`${event.title} completed.`);

    } catch (error) {

      console.log(error);

      setTasksRaw(previousTasks);

      showErrorToast(
        'Could not complete this task. Please try again.'
      );

    } finally {

      setBusyEventId(null);
    }
  };

  /* ---------------------------------------------------------------
     THEME FOR CALENDAR
  --------------------------------------------------------------- */

  const calendarTheme = useMemo(() => ({

    backgroundColor: colors.card,
    calendarBackground: colors.card,

    dayTextColor: colors.textDark,

    textDisabledColor:
      isDarkMode ? '#475569' : '#CBD5E1',

    todayTextColor:
      isDarkMode ? colors.textDark : COLORS.white,

    todayBackgroundColor:
      isDarkMode
        ? colors.primary
        : 'rgba(239,68,68,0.78)',

    arrowColor: colors.primary,

    selectedDayBackgroundColor: colors.primary,
    selectedDayTextColor: COLORS.white,

    monthTextColor: colors.primary,

    textSectionTitleColor: colors.textLight,

    textDayFontWeight: '600',
    textMonthFontWeight: 'bold',
    textMonthFontSize: 18,
    textDayFontSize: 14,
    textDayHeaderFontSize: 12,

    'stylesheet.calendar.header': {

      week: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
      },

      dayHeader: {
        width: 32,
        textAlign: 'center',
        fontWeight: '600',
        color: colors.textDark,
      },

      dayTextAtIndex5: {
        color: colors.danger,
      },

      dayTextAtIndex6: {
        color: colors.danger,
      },
    },

  }), [colors, isDarkMode]);

  const filterPillWidth =
    filterWidth > 0
      ? (filterWidth - 8) / FILTERS.length
      : 0;

  /* ---------------------------------------------------------------
     RENDER: EVENT CARD
  --------------------------------------------------------------- */

  const renderEventCard = (item) => {

    const isTask = item.eventType === 'task';
    const isCompleted = item.status === 'Completed';
    const isBusy = busyEventId === item.id;

    const badgeStyle =
      item.eventType === 'paper'
        ? { backgroundColor: colors.softWarning }
        : item.eventType === 'class'
          ? { backgroundColor: colors.softInfo }
          : isCompleted
            ? { backgroundColor: colors.softSuccess }
            : { backgroundColor: colors.softDanger };

    const iconName =
      item.eventType === 'paper'
        ? 'description'
        : item.eventType === 'class'
          ? 'school'
          : isCompleted
            ? 'check-circle'
            : 'assignment-late';

    const iconColor =
      item.eventType === 'paper'
        ? colors.warning
        : item.eventType === 'class'
          ? classColor
          : isCompleted
            ? colors.success
            : colors.danger;

    const card = (

      <TouchableOpacity
        activeOpacity={0.85}
        disabled={isBusy}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.message}`}
        accessibilityHint="Opens this subject"
        onPress={() => handleEventPress(item)}
        style={[
          styles.taskCard,
          { backgroundColor: colors.card },
        ]}
      >

        <View
          style={[
            styles.eventIcon,
            { backgroundColor: badgeStyle.backgroundColor },
          ]}
        >
          <MaterialIcons
            name={iconName}
            size={20}
            color={iconColor}
          />
        </View>

        <View style={styles.leftSection}>

          <Text
            numberOfLines={1}
            style={[
              styles.taskTitle,
              { color: colors.textDark },
            ]}
          >
            {item.title}
          </Text>

          <Text
            style={[
              styles.taskType,
              { color: colors.secondary },
            ]}
          >
            {item.subjectName
              ? `${item.subjectName} - ${item.type}`
              : item.type}
            {item.timeLabel ? ` - ${item.timeLabel}` : ''}
          </Text>

          <Text
            style={[
              styles.taskMessage,
              { color: colors.textLight },
            ]}
          >
            {item.message}
          </Text>

        </View>

        <View style={[styles.statusBadge, badgeStyle]}>
          <Text
            style={[
              styles.statusText,
              { color: colors.textDark },
            ]}
          >
            {item.badgeText}
          </Text>
        </View>

      </TouchableOpacity>
    );

    if (isTask && !isCompleted) {

      return (
        <SwipeableRow
          key={item.id}
          enabled={!busyEventId || isBusy}
          onSwipeRight={() => completeEventTask(item)}
          leftLabel="Done"
          leftIcon="check"
          leftColor={colors.success}
        >
          {card}
        </SwipeableRow>
      );
    }

    return (
      <View key={item.id}>
        {card}
      </View>
    );
  };

  /* ---------------------------------------------------------------
     RENDER
  --------------------------------------------------------------- */

  return (

    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: colors.background },
      ]}
    >

      <StatusBar
        backgroundColor={colors.background}
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
      />

      {isInitialLoading ? (

        <ScrollView
          style={[
            styles.container,
            { backgroundColor: colors.background },
          ]}
          contentContainerStyle={{
            paddingBottom: SCREEN_BOTTOM_PADDING,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <SkeletonBlock
            height={185}
            radius={28}
            style={{ marginBottom: 25 }}
          />
          <SkeletonBlock
            height={340}
            radius={CARD_RADIUS}
            style={{ marginBottom: 20 }}
          />
          <SkeletonList count={3} />
        </ScrollView>

      ) : (

      <ScrollView

        style={[
          styles.container,
          { backgroundColor: colors.background },
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

        {/* HEADER */}

        <Animated.View
          style={{
            opacity: headerAnim,
            transform: [
              {
                translateY: headerAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-16, 0],
                }),
              },
            ],
          }}
        >

          <View
            style={[
              styles.header,
              {
                backgroundColor:
                  isDarkMode ? colors.card : '#EEE9FF',
                borderColor:
                  isDarkMode
                    ? 'rgba(165,180,252,0.14)'
                    : 'rgba(124,58,237,0.08)',
              },
            ]}
          >
            <View
              style={[
                styles.headerWaveBack,
                isDarkMode && styles.headerWaveBackDark,
              ]}
            />
            <View
              style={[
                styles.headerWaveFront,
                isDarkMode && styles.headerWaveFrontDark,
              ]}
            />
            <View
              style={[
                styles.headerCurve,
                isDarkMode && styles.headerCurveDark,
                { width: responsive.width * 0.72 },
              ]}
            />
            <View
              style={[
                styles.calendarArtCard,
                isDarkMode && styles.calendarArtCardDark,
              ]}
            >
              <View style={styles.calendarArtTop} />
              <View style={styles.calendarArtGrid}>
                <View style={styles.calendarArtDot} />
                <View style={styles.calendarArtDot} />
                <View style={styles.calendarArtDotActive} />
                <View style={styles.calendarArtDot} />
                <View style={styles.calendarArtDotActive} />
                <View style={styles.calendarArtDot} />
              </View>
            </View>
            <View
              style={[
                styles.deadlineBadgeArt,
                isDarkMode && styles.calendarArtCardDark,
              ]}
            >
              <MaterialIcons
                name="notifications-active"
                size={20}
                color="#5B5FEF"
              />
            </View>
            <View
              style={[
                styles.checkArt,
                isDarkMode && styles.calendarArtCardDark,
              ]}
            >
              <MaterialIcons
                name="event-available"
                size={24}
                color="#22C55E"
              />
            </View>
            <View style={styles.sparkleOne} />
            <View style={styles.sparkleTwo} />
            <View
              style={[
                styles.sparkleThree,
                { left: responsive.width * 0.48 },
              ]}
            />

            <View style={styles.headerActions}>

              {canGoBack && (

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={[
                    styles.backButton,
                    { backgroundColor: colors.card },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                  onPress={goBack}
                >
                  <MaterialIcons
                    name="arrow-back"
                    size={26}
                    color={colors.primary}
                  />
                </TouchableOpacity>

              )}

            </View>

            <Text
              style={[styles.title, { color: colors.primary }]}
            >
              Calendar
            </Text>

            <Text
              style={[
                styles.subtitle,
                { color: colors.textLight },
              ]}
            >
              Track all deadlines
            </Text>

          </View>

        </Animated.View>

        {/* ERROR BANNER
            A failed background refresh (polling, another screen's
            write, ...) is silent by design - it must not pop a toast
            every time - but it still needs to be visible somewhere,
            otherwise it reads identically to "nothing scheduled". */}

        {loadFailed && (

          <TouchableOpacity
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Could not refresh the calendar. Tap to retry."
            onPress={handleRefresh}
            style={[
              styles.errorBanner,
              {
                backgroundColor: isDarkMode
                  ? 'rgba(248,113,113,0.16)'
                  : '#FEE2E2',
              },
            ]}
          >
            <MaterialIcons
              name="cloud-off"
              size={18}
              color={colors.danger}
            />
            <Text
              style={[
                styles.errorBannerText,
                { color: colors.danger },
              ]}
            >
              Could not refresh the calendar. Showing the last data
              we have - tap to retry.
            </Text>
          </TouchableOpacity>

        )}

        {/* LEGEND + MONTH SUMMARY */}

        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.card },
          ]}
        >

          <Text
            style={[
              styles.summaryText,
              { color: colors.textDark },
            ]}
          >
            {monthLabel}: {monthSummary.task} deadline
            {monthSummary.task === 1 ? '' : 's'} ·{' '}
            {monthSummary.paper} paper
            {monthSummary.paper === 1 ? '' : 's'} ·{' '}
            {monthSummary.class} class
            {monthSummary.class === 1 ? '' : 'es'}
          </Text>

          <View style={styles.legendRow}>

            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: colors.primary },
                ]}
              />
              <Text
                style={[
                  styles.legendLabel,
                  { color: colors.textLight },
                ]}
              >
                Tasks
              </Text>
            </View>

            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: colors.warning },
                ]}
              />
              <Text
                style={[
                  styles.legendLabel,
                  { color: colors.textLight },
                ]}
              >
                Papers
              </Text>
            </View>

            <View style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: classColor },
                ]}
              />
              <Text
                style={[
                  styles.legendLabel,
                  { color: colors.textLight },
                ]}
              >
                Classes
              </Text>
            </View>

          </View>

        </View>

        {/* FILTER CHIPS */}

        <View
          onLayout={(event) =>
            setFilterWidth(event.nativeEvent.layout.width)
          }
          style={[
            styles.segment,
            { backgroundColor: colors.card },
          ]}
        >

          {filterPillWidth > 0 && (
            <Animated.View
              style={[
                styles.segmentPill,
                {
                  width: filterPillWidth,
                  backgroundColor: colors.primary,
                  transform: [
                    {
                      translateX: pillAnim.interpolate({
                        inputRange: [0, FILTERS.length - 1],
                        outputRange: [
                          0,
                          filterPillWidth * (FILTERS.length - 1),
                        ],
                      }),
                    },
                  ],
                },
              ]}
            />
          )}

          {FILTERS.map((option, index) => (
            <TouchableOpacity
              key={option.key}
              accessibilityRole="tab"
              accessibilityState={{
                selected: activeFilter === option.key,
              }}
              accessibilityLabel={`Show ${option.label}`}
              activeOpacity={0.8}
              style={styles.segmentButton}
              onPress={() => selectFilter(option.key, index)}
            >
              <MaterialIcons
                name={option.icon}
                size={15}
                color={
                  activeFilter === option.key
                    ? '#FFFFFF'
                    : colors.textLight
                }
                style={{ marginRight: 5 }}
              />
              <Text
                style={[
                  styles.segmentText,
                  {
                    color:
                      activeFilter === option.key
                        ? '#FFFFFF'
                        : colors.textLight,
                  },
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}

        </View>

        {/* CALENDAR */}

        <View>

          <Calendar

            key={calendarToken}

            current={todayDate}

            firstDay={1}

            markingType="multi-dot"

            onDayPress={handleDateSelect}

            onMonthChange={handleMonthChange}

            markedDates={finalMarkedDates}

            style={[
              styles.calendar,
              { backgroundColor: colors.card },
            ]}

            theme={calendarTheme}
          />

          {showJumpToToday && (

            <Animated.View
              style={[
                styles.jumpButtonWrap,
                {
                  opacity: jumpAnim,
                  transform: [
                    {
                      scale: jumpAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.7, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <TouchableOpacity
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                style={[
                  styles.jumpButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={jumpToToday}
              >
                <MaterialIcons
                  name="today"
                  size={16}
                  color="#FFFFFF"
                />
                <Text style={styles.jumpButtonText}>
                  Today
                </Text>
              </TouchableOpacity>
            </Animated.View>

          )}

        </View>

        {/* SECTION */}

        <Text
          style={[
            styles.sectionTitle,
            { color: colors.textDark },
          ]}
        >
          {selectedDate
            ? selectedDate === todayDate
              ? "Today's Events"
              : 'Selected Date Events'
            : 'Tap a date to see events'}
        </Text>

        {/* EMPTY */}

        {selectedDateEvents.length === 0 ? (

          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card },
            ]}
          >
            <MaterialIcons
              name={
                selectedDate
                  ? 'event-busy'
                  : 'touch-app'
              }
              size={30}
              color={colors.textLight}
              style={{ marginBottom: 8 }}
            />

            <Text
              style={[
                styles.emptyText,
                { color: colors.textLight },
              ]}
            >
              {selectedDate
                ? 'No events on this date'
                : 'Pick any date on the calendar above to see its deadlines, papers, and classes.'}
            </Text>
          </View>

        ) : (

          <Animated.View
            style={{
              opacity: dateChangeAnim,
              transform: [
                {
                  translateY: dateChangeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            }}
          >
            {selectedDateEvents.map((item) =>
              renderEventCard(item)
            )}
          </Animated.View>

        )}

      </ScrollView>

      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  /* SAFE AREA */

  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* CONTAINER */

  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: HEADER_TOP_PADDING,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },

  /* HEADER */

  header: {
    position: 'relative',
    minHeight: 185,
    marginHorizontal: -SCREEN_PADDING,
    marginTop: -HEADER_TOP_PADDING,
    marginBottom: 20,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: HEADER_TOP_PADDING + 26,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
    zIndex: 3,
  },

  backButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    ...SHADOW,
  },

  headerWaveBack: {
    position: 'absolute',
    left: -72,
    right: -72,
    top: 78,
    height: 92,
    backgroundColor: 'rgba(255,255,255,0.44)',
    borderTopLeftRadius: 160,
    borderTopRightRadius: 210,
    transform: [{ rotate: '-6deg' }],
  },

  headerWaveBackDark: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },

  headerWaveFront: {
    position: 'absolute',
    left: -50,
    right: -70,
    top: 116,
    height: 92,
    backgroundColor: 'rgba(221,214,254,0.50)',
    borderTopLeftRadius: 210,
    borderTopRightRadius: 160,
    transform: [{ rotate: '7deg' }],
  },

  headerWaveFrontDark: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },

  headerCurve: {
    position: 'absolute',
    right: -35,
    top: 64,
    height: 58,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.14)',
    borderRadius: 150,
    transform: [{ rotate: '-12deg' }],
  },

  headerCurveDark: {
    borderColor: 'rgba(165,180,252,0.18)',
  },

  calendarArtCard: {
    position: 'absolute',
    right: 28,
    bottom: 20,
    width: 92,
    height: 82,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.86)',
    padding: 12,
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  calendarArtCardDark: {
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(165,180,252,0.14)',
  },

  calendarArtTop: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#5B5FEF',
    marginBottom: 11,
  },

  calendarArtGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  calendarArtDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(196,181,253,0.72)',
  },

  calendarArtDotActive: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
  },

  deadlineBadgeArt: {
    position: 'absolute',
    right: 118,
    top: 48,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.86)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  checkArt: {
    position: 'absolute',
    right: 18,
    top: 74,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.82)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  sparkleOne: {
    position: 'absolute',
    left: 132,
    top: 48,
    width: 12,
    height: 12,
    borderRadius: 4,
    backgroundColor: 'rgba(196,181,253,0.76)',
    transform: [{ rotate: '45deg' }],
  },

  sparkleTwo: {
    position: 'absolute',
    right: 152,
    bottom: 28,
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor: 'rgba(250,204,21,0.64)',
    transform: [{ rotate: '45deg' }],
  },

  sparkleThree: {
    position: 'absolute',
    bottom: 54,
    width: 7,
    height: 7,
    borderRadius: 3,
    backgroundColor: 'rgba(91,95,239,0.24)',
  },

  title: {
    fontSize: TYPOGRAPHY.screenTitle,
    fontWeight: 'bold',
    color: COLORS.primary,
    zIndex: 3,
  },

  subtitle: {
    marginTop: 8,
    fontSize: TYPOGRAPHY.body,
    color: COLORS.textLight,
    zIndex: 3,
  },

  /* ERROR BANNER */

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: CARD_RADIUS,
    marginBottom: 14,
  },

  errorBannerText: {
    flex: 1,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
    lineHeight: 17,
  },

  /* SUMMARY + LEGEND */

  summaryCard: {
    borderRadius: CARD_RADIUS,
    padding: 16,
    marginBottom: 14,
    ...SHADOW,
  },

  summaryText: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
  },

  legendRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },

  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },

  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  legendLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  /* FILTER SEGMENT */

  segment: {
    position: 'relative',
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
    ...SHADOW,
  },

  segmentPill: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    borderRadius: 11,
  },

  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 11,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  segmentText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* CALENDAR */

  calendar: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    ...SHADOW,
    paddingBottom: 10,
  },

  jumpButtonWrap: {
    position: 'absolute',
    top: 10,
    right: 10,
  },

  jumpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    ...SHADOW,
  },

  jumpButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* SECTION */

  sectionTitle: {
    marginTop: 24,
    marginBottom: 16,
    fontSize: TYPOGRAPHY.sectionTitle,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },

  /* EMPTY */

  emptyCard: {
    backgroundColor: COLORS.white,
    padding: 25,
    borderRadius: CARD_RADIUS,
    alignItems: 'center',
  },

  emptyText: {
    color: COLORS.textLight,
    fontSize: TYPOGRAPHY.body,
    textAlign: 'center',
  },

  /* TASK CARD */

  taskCard: {
    backgroundColor: COLORS.white,
    padding: 16,
    borderRadius: CARD_RADIUS,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    ...SHADOW,
  },

  eventIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },

  leftSection: {
    flex: 1,
    paddingRight: 6,
  },

  taskTitle: {
    fontSize: TYPOGRAPHY.body,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },

  taskType: {
    marginTop: 4,
    color: COLORS.secondary,
    fontWeight: '600',
    fontSize: TYPOGRAPHY.small,
  },

  taskMessage: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.tiny,
    lineHeight: 17,
    fontWeight: '600',
  },

  /* STATUS */

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    alignItems: 'center',
  },

  statusText: {
    fontWeight: 'bold',
    fontSize: TYPOGRAPHY.tiny,
    color: COLORS.textDark,
    textAlign: 'center',
  },

});
