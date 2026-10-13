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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
} from 'react-native';

import DateTimePicker
from '@react-native-community/datetimepicker';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import AsyncStorage from '@react-native-async-storage/async-storage';

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
  SkeletonList,
} from '../components/Skeleton';

import {
  AnimatedBar,
  CountUp,
  ProgressRing,
} from '../components/AnimatedStats';

import SwipeableRow from '../components/SwipeableRow';

import {
  cancelTaskNotifications,
  getDeadlineDateKey,
  isDeadlineToday,
  scheduleTaskNotification,
} from '../utils/notifications';

import {
  loadSubjectTasks,
  loadUserAttendance,
  loadUserClassSchedules,
  saveSubjectTasks,
} from '../utils/localData';

import {
  DATA_DOMAINS,
  onDataChanged,
} from '../utils/dataEvents';

import {
  ATTENDANCE_THRESHOLD,
  getAttendanceStats,
  getAttendanceTone,
} from '../utils/attendance';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const MONTHS = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];

const UNDO_WINDOW = 5000;

const PRIORITIES = [
  { key: 'High', icon: 'keyboard-double-arrow-up' },
  { key: 'Medium', icon: 'drag-handle' },
  { key: 'Low', icon: 'keyboard-double-arrow-down' },
];

const SORT_OPTIONS = [
  { key: 'deadline', label: 'Deadline' },
  { key: 'priority', label: 'Priority' },
  { key: 'added', label: 'Added' },
  { key: 'type', label: 'Type' },
];

const PRIORITY_WEIGHT = {
  High: 0,
  Medium: 1,
  Low: 2,
};

const createId = () =>
  `${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const easeNext = (duration = 240) =>
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      duration,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity
    )
  );

/* ------------------------------------------------------------------
   DATE HELPERS
------------------------------------------------------------------ */

const formatDateLabel = (date) =>
  `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

const formatTimeLabel = (date) => {

  let hours = date.getHours();
  let minutes = date.getMinutes();

  const ampm = hours >= 12 ? 'PM' : 'AM';

  hours = hours % 12 || 12;
  minutes = minutes < 10 ? `0${minutes}` : minutes;

  return `${hours}:${minutes} ${ampm}`;
};

const parseDateInput = (value) => {

  const text = (value || '').trim();

  if (!text) {
    return null;
  }

  const slash =
    text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);

  if (slash) {

    const date = new Date(
      Number(slash[3]),
      Number(slash[2]) - 1,
      Number(slash[1])
    );

    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parts = text.split(/\s+/);

  if (parts.length === 3) {

    const monthIndex =
      MONTHS.findIndex(
        (month) =>
          month.toLowerCase() ===
          parts[1].toLowerCase()
      );

    if (monthIndex >= 0) {

      const date = new Date(
        Number(parts[2]),
        monthIndex,
        Number(parts[0])
      );

      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  return null;
};

const parseTimeInput = (value) => {

  const text = (value || '').trim();

  if (!text) {
    return null;
  }

  const match =
    text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridian = match[3]?.toUpperCase();

  if (
    minutes > 59 ||
    hours > (meridian ? 12 : 23) ||
    hours < 0 ||
    (meridian && hours === 0)
  ) {
    return null;
  }

  if (meridian === 'PM' && hours < 12) {
    hours += 12;
  }

  if (meridian === 'AM' && hours === 12) {
    hours = 0;
  }

  const date = new Date();

  date.setHours(hours, minutes, 0, 0);

  return date;
};

const mergeDateAndTime = (date, time) => {

  const next = new Date(date);

  next.setHours(
    time.getHours(),
    time.getMinutes(),
    0,
    0
  );

  return next;
};

const startOfToday = () => {

  const today = new Date();

  today.setHours(0, 0, 0, 0);

  return today;
};

/* Same urgency language the dashboard uses, so a deadline
   reads identically wherever it appears. */

const getDeadlineInfo = (deadline) => {

  const parsed = parseDateInput(deadline);

  if (!parsed) {
    return {
      daysLeft: null,
      isOverdue: false,
      tone: 'neutral',
      label: deadline || 'No date',
    };
  }

  const daysLeft =
    Math.round(
      (parsed.getTime() - startOfToday().getTime()) /
        86400000
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
    return { daysLeft, isOverdue: false, tone: 'today', label: 'Today' };
  }

  if (daysLeft === 1) {
    return { daysLeft, isOverdue: false, tone: 'urgent', label: 'Tomorrow' };
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

const getToneColor = (tone, colors) => {

  const map = {
    overdue: colors.danger,
    today: colors.danger,
    urgent: colors.warning,
    soon: colors.secondary,
    later: colors.textLight,
    neutral: colors.textLight,
  };

  return map[tone] || colors.textLight;
};


/* ------------------------------------------------------------------
   SCREEN
------------------------------------------------------------------ */

export default function SubjectDetailScreen({
  subject,
  goBack,
  currentUser,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const {
    showError: showErrorToast,
    showSuccess: showSuccessToast,
  } = useToast();

  const {
    isCompactWidth,
  } = useResponsive();

  /* DATA */

  const [tasks, setTasks] =
    useState([]);

  /* Mirrors `tasks` outside of React state so the undo-delete /
     undo-complete timer (which fires several seconds after render)
     always writes whatever is current, not whatever was captured
     when the timer was armed. */
  const tasksRef = useRef(tasks);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const [loadFailed, setLoadFailed] =
    useState(false);

  const [attendance, setAttendance] =
    useState(null);

  const [scheduleCount, setScheduleCount] =
    useState(0);

  /* VIEW */

  const [activeTab, setActiveTab] =
    useState('Pending');

  const [searchQuery, setSearchQuery] =
    useState('');

  const [sortMode, setSortMode] =
    useState('deadline');

  const [showSearch, setShowSearch] =
    useState(false);

  /* FORM */

  const [formVisible, setFormVisible] =
    useState(false);

  const [editingId, setEditingId] =
    useState(null);

  const [formTitle, setFormTitle] =
    useState('');

  const [formType, setFormType] =
    useState('Quiz');

  const [formPriority, setFormPriority] =
    useState('Medium');

  const [formNotes, setFormNotes] =
    useState('');

  const [formDateText, setFormDateText] =
    useState('');

  const [formTimeText, setFormTimeText] =
    useState('');

  const [formReminders, setFormReminders] =
    useState([]);

  const [formError, setFormError] =
    useState('');

  const [reminderDateText, setReminderDateText] =
    useState(formatDateLabel(new Date()));

  const [reminderTimeText, setReminderTimeText] =
    useState(formatTimeLabel(new Date()));

  /* PICKERS */

  const [picker, setPicker] =
    useState(null);

  /* BUSY */

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [busyId, setBusyId] =
    useState(null);

  /* UNDO */

  const [pendingAction, setPendingAction] =
    useState(null);

  const undoTimer = useRef(null);

  /* Holds the deferred commit function for the pending undo action,
     so the unmount cleanup below can flush it instead of silently
     discarding it. */
  const pendingApplyRef = useRef(null);

  const [highlightId, setHighlightId] =
    useState(null);

  const highlightTimer = useRef(null);

  const isMountedRef = useRef(true);

  const titleRef = useRef(null);

  /* ANIMATIONS */

  const headerAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const tabPill = useRef(new Animated.Value(0)).current;
  const typePill = useRef(new Animated.Value(0)).current;
  const savedTick = useRef(new Animated.Value(0)).current;
  const undoAnim = useRef(new Animated.Value(0)).current;
  const emptyBob = useRef(new Animated.Value(0)).current;
  const fabAnim = useRef(new Animated.Value(1)).current;

  const [tabWidth, setTabWidth] =
    useState(0);

  const [typeWidth, setTypeWidth] =
    useState(0);

  const scrollOffset = useRef(0);

  const typeOptions =
    useMemo(
      () =>
        subject?.type === 'Theory'
          ? ['Quiz', 'Assignment', 'Project']
          : ['Lab Task', 'Assignment', 'Project'],
      [subject]
    );

  /* ---------------------------------------------------------------
     LOAD
  --------------------------------------------------------------- */

  /* `silent` is used for event-driven reloads triggered by another
     screen's write - those should refresh the data underneath the
     user without flashing the skeleton or re-running entrance
     animations that are keyed off `isLoading`. */
  const loadData = useCallback(async ({ silent = false } = {}) => {

    if (!subject || !currentUser?.id) {
      setIsLoading(false);
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }

    try {

      const [
        savedTasks,
        attendanceMap,
        scheduleMap,
      ] = await Promise.all([
        loadSubjectTasks(currentUser.id, subject.id),
        loadUserAttendance(currentUser.id).catch(() => ({})),
        loadUserClassSchedules(currentUser.id).catch(() => ({})),
      ]);

      setTasks(savedTasks || []);

      setAttendance(
        (attendanceMap || {})[subject.id] || null
      );

      setScheduleCount(
        Object.values(
          (scheduleMap || {})[subject.id] || {}
        ).length
      );

      setLoadFailed(false);

    } catch (error) {

      console.log(error);

      /* A failed load must never be allowed to look like "no tasks
         yet" - that empty state invites an Add, and saving from it
         would wipe out whatever real tasks failed to load. */
      setLoadFailed(true);

      showErrorToast(
        'Could not load this subject. Check your connection and try again.'
      );

    } finally {

      if (!silent) {
        setIsLoading(false);
      }
    }

  }, [subject, currentUser, showErrorToast]);

  useEffect(() => {

    loadData();

  }, [loadData]);

  /* Only the domains this screen actually shows are worth a reload,
     and since the write already happened elsewhere this is always a
     silent, background refresh - never a skeleton flash. */
  useEffect(() => {

    const relevantDomains = [
      DATA_DOMAINS.TASKS,
      DATA_DOMAINS.ATTENDANCE,
      DATA_DOMAINS.CLASS_SCHEDULES,
    ];

    const unsubscribe =
      onDataChanged(({ domain }) => {
        if (!relevantDomains.includes(domain)) {
          return;
        }
        loadData({ silent: true });
      });

    return unsubscribe;

  }, [loadData]);

  useEffect(() => {

    if (isLoading) {
      return undefined;
    }

    Animated.stagger(110, [
      Animated.timing(headerAnim, {
        toValue: 1,
        duration: 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(listAnim, {
        toValue: 1,
        duration: 440,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const loop =
      Animated.loop(
        Animated.sequence([
          Animated.timing(emptyBob, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(emptyBob, {
            toValue: 0,
            duration: 1200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    loop.start();

    return () =>
      loop.stop();

  }, [isLoading]);

  /* If the screen goes away mid undo-window, the task is already
     hidden from the visible list - dropping the timer here (instead
     of flushing it) would silently resurrect it on the next load,
     which reads as a lost write to the user. So the pending action
     is run immediately rather than discarded. */

  useEffect(() =>
    () => {

      isMountedRef.current = false;

      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
        highlightTimer.current = null;
      }

      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
        undoTimer.current = null;

        if (pendingApplyRef.current) {
          pendingApplyRef.current();
          pendingApplyRef.current = null;
        }
      }
    },
  []);

  /* ---------------------------------------------------------------
     PERSIST
     Each action awaits its own write and rolls back on failure,
     so nothing is ever shown as saved when it is not. Opening
     the screen no longer rewrites the database.
  --------------------------------------------------------------- */

  const persistTasks = async (nextTasks) => {

    await saveSubjectTasks(
      currentUser.id,
      subject.id,
      nextTasks
    );
  };

  const markTodayDeadlineAlertSent = async (task) => {

    if (
      !currentUser?.id ||
      !isDeadlineToday(task.deadline)
    ) {
      return;
    }

    const dateKey =
      getDeadlineDateKey(task.deadline);

    if (!dateKey) {
      return;
    }

    try {

      await AsyncStorage.setItem(
        `deadline_alert_${currentUser.id}_${task.id}_${dateKey}`,
        'true'
      );

    } catch (error) {
      console.log(error);
    }
  };

  /* ---------------------------------------------------------------
     FORM
  --------------------------------------------------------------- */

  const resetForm = () => {

    setFormTitle('');
    setFormType(typeOptions[0]);
    setFormPriority('Medium');
    setFormNotes('');
    setFormDateText('');
    setFormTimeText('');
    setFormReminders([]);
    setFormError('');
    setReminderDateText(formatDateLabel(new Date()));
    setReminderTimeText(formatTimeLabel(new Date()));
  };

  const openSheet = () => {

    setFormVisible(true);

    savedTick.setValue(0);

    Animated.spring(sheetAnim, {
      toValue: 1,
      friction: 9,
      tension: 66,
      useNativeDriver: true,
    }).start();
  };

  const openAddForm = () => {

    resetForm();
    setEditingId(null);
    typePill.setValue(0);
    openSheet();

    setTimeout(() => titleRef.current?.focus(), 300);
  };

  const openEditForm = (task) => {

    setEditingId(task.id);
    setFormTitle(task.title);
    setFormType(task.type);
    setFormPriority(task.priority || 'Medium');
    setFormNotes(task.notes || '');
    setFormDateText(task.deadline || '');
    setFormTimeText(task.time || '');
    setFormReminders(task.reminders || []);
    setFormError('');

    typePill.setValue(
      Math.max(typeOptions.indexOf(task.type), 0)
    );

    openSheet();
  };

  const closeSheet = () => {

    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      if (!isMountedRef.current) {
        return;
      }
      setFormVisible(false);
      setEditingId(null);
      setPicker(null);
    });
  };

  const selectType = (option, index) => {

    setFormType(option);

    Animated.timing(typePill, {
      toValue: index,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const addReminder = () => {

    const parsedDate =
      parseDateInput(reminderDateText);

    const parsedTime =
      parseTimeInput(reminderTimeText);

    if (!parsedDate) {
      setFormError('Enter a valid reminder date.');
      return;
    }

    if (!parsedTime) {
      setFormError('Enter reminder time like 8:30 PM.');
      return;
    }

    const reminderAt =
      mergeDateAndTime(parsedDate, parsedTime);

    if (reminderAt <= new Date()) {
      setFormError('Pick a future reminder time.');
      return;
    }

    const exists =
      formReminders.some(
        (item) =>
          Math.abs(
            new Date(item.date).getTime() -
              reminderAt.getTime()
          ) < 60000
      );

    if (exists) {
      setFormError('That reminder is already added.');
      return;
    }

    setFormError('');

    easeNext(180);

    setFormReminders(
      [
        ...formReminders,
        {
          id: createId(),
          date: reminderAt.toISOString(),
          label: `${formatDateLabel(reminderAt)} at ${formatTimeLabel(reminderAt)}`,
        },
      ].sort(
        (a, b) => new Date(a.date) - new Date(b.date)
      )
    );
  };

  /* SAVE
     Notifications are scheduled first so their ids can be
     stored with the task, but if the write fails they are
     cancelled again. That is what stops an alert firing for a
     task that was never saved. */

  const handleSaveTask = async () => {

    if (isSaving) {
      return;
    }

    if (loadFailed) {
      setFormError(
        'Your tasks failed to load, so changes cannot be saved yet. Please retry loading first.'
      );
      return;
    }

    const title = formTitle.trim();

    if (!title) {
      setFormError('Please enter a task title.');
      return;
    }

    const parsedDeadline =
      parseDateInput(formDateText);

    if (!parsedDeadline) {
      setFormError('Please choose a deadline date.');
      return;
    }

    const parsedTime =
      formTimeText.trim()
        ? parseTimeInput(formTimeText)
        : null;

    if (formTimeText.trim() && !parsedTime) {
      setFormError('Enter time like 8:30 PM or 20:30.');
      return;
    }

    const duplicate =
      tasks.some(
        (item) =>
          item.id !== editingId &&
          item.title.trim().toLowerCase() ===
            title.toLowerCase() &&
          item.type === formType
      );

    if (duplicate) {
      setFormError(
        `A ${formType} called "${title}" already exists.`
      );
      return;
    }

    setFormError('');
    setIsSaving(true);

    const normalizedDeadline =
      formatDateLabel(parsedDeadline);

    const normalizedTime =
      parsedTime ? formatTimeLabel(parsedTime) : '';

    const existing =
      editingId
        ? tasks.find((item) => item.id === editingId)
        : null;

    const previousTasks = tasks;

    let scheduledIds = [];

    try {

      /* Replace any previous alerts for this task. */

      if (existing?.notificationIds?.length) {
        await cancelTaskNotifications(
          existing.notificationIds,
          currentUser.id
        );
      }

      const shouldSchedule =
        !existing || existing.status === 'Pending';

      if (shouldSchedule) {

        scheduledIds =
          (await scheduleTaskNotification(
            title,
            normalizedDeadline,
            normalizedTime,
            subject.name,
            currentUser.id,
            formReminders
          )) || [];
      }

      const nextTask = {
        id: existing?.id || createId(),
        title,
        type: formType,
        priority: formPriority,
        notes: formNotes.trim(),
        deadline: normalizedDeadline,
        time: normalizedTime,
        status: existing?.status || 'Pending',
        completedAt: existing?.completedAt || null,
        reminders: formReminders,
        notificationIds: scheduledIds,
        createdAt:
          existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const nextTasks =
        existing
          ? tasks.map((item) =>
              item.id === existing.id ? nextTask : item
            )
          : [...tasks, nextTask];

      await persistTasks(nextTasks);

      await markTodayDeadlineAlertSent(nextTask);

      easeNext();

      setTasks(nextTasks);

      setHighlightId(nextTask.id);

      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }

      highlightTimer.current = setTimeout(() => {
        highlightTimer.current = null;
        setHighlightId(null);
      }, 2000);

      Animated.sequence([
        Animated.spring(savedTick, {
          toValue: 1,
          friction: 5,
          tension: 110,
          useNativeDriver: true,
        }),
        Animated.delay(300),
      ]).start(closeSheet);

      showSuccessToast(
        existing ? 'Task updated.' : 'Task added.'
      );

    } catch (error) {

      console.log(error);

      /* Undo the alerts we just created so nothing fires for a
         task that did not make it into the database. */

      if (scheduledIds.length > 0) {
        await cancelTaskNotifications(
          scheduledIds,
          currentUser.id
        ).catch(() => {});
      }

      setTasks(previousTasks);

      setFormError(
        'Could not save. Check your connection and try again.'
      );

    } finally {

      setIsSaving(false);
    }
  };

  /* ---------------------------------------------------------------
     TASK ACTIONS
  --------------------------------------------------------------- */

  const runUndoable = (task, type, apply) => {

    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
    }

    easeNext();

    setPendingAction({ task, type });

    pendingApplyRef.current = apply;

    Animated.spring(undoAnim, {
      toValue: 1,
      friction: 8,
      tension: 70,
      useNativeDriver: true,
    }).start();

    undoTimer.current =
      setTimeout(() => {
        undoTimer.current = null;
        pendingApplyRef.current = null;
        apply();
      }, UNDO_WINDOW);
  };

  const cancelPending = () => {

    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
      pendingApplyRef.current = null;
    }

    Animated.timing(undoAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      if (!isMountedRef.current) {
        return;
      }
      easeNext();
      setPendingAction(null);
    });
  };

  const dismissUndoBar = () => {

    Animated.timing(undoAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();

    setPendingAction(null);
  };

  const completeTask = async (task) => {

    if (loadFailed) {
      showErrorToast(
        `Could not complete ${task.title}. Your tasks failed to load, so it is not safe to save changes yet. Please retry loading first.`
      );
      dismissUndoBar();
      return;
    }

    setBusyId(task.id);

    /* Read from the ref, not the `tasks` state captured when this
       action was scheduled - the undo window may have let several
       seconds pass, and anything added or edited meanwhile must not
       be clobbered by writing a stale snapshot. */
    const previousTasks = tasksRef.current;

    try {

      if (task.notificationIds?.length) {
        await cancelTaskNotifications(
          task.notificationIds,
          currentUser.id
        );
      }

      const nextTasks =
        previousTasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: 'Completed',
                completedAt: new Date().toISOString(),
                notificationIds: [],
              }
            : item
        );

      await persistTasks(nextTasks);

      easeNext();

      setTasks(nextTasks);

      showSuccessToast(`${task.title} completed.`);

    } catch (error) {

      console.log(error);

      setTasks(previousTasks);

      showErrorToast(
        'Could not complete this task. Please try again.'
      );

    } finally {

      setBusyId(null);
      dismissUndoBar();
    }
  };

  const reopenTask = async (task) => {

    if (loadFailed) {
      showErrorToast(
        `Could not reopen ${task.title}. Your tasks failed to load, so it is not safe to save changes yet. Please retry loading first.`
      );
      return;
    }

    setBusyId(task.id);

    const previousTasks = tasks;

    try {

      const scheduledIds =
        (await scheduleTaskNotification(
          task.title,
          task.deadline,
          task.time,
          subject.name,
          currentUser.id,
          task.reminders || []
        )) || [];

      const nextTasks =
        tasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                status: 'Pending',
                completedAt: null,
                notificationIds: scheduledIds,
              }
            : item
        );

      await persistTasks(nextTasks);

      easeNext();

      setTasks(nextTasks);

      showSuccessToast(`${task.title} reopened.`);

    } catch (error) {

      console.log(error);

      setTasks(previousTasks);

      showErrorToast(
        'Could not reopen this task. Please try again.'
      );

    } finally {

      setBusyId(null);
    }
  };

  const deleteTask = async (task) => {

    if (loadFailed) {
      showErrorToast(
        `Could not delete ${task.title}. Your tasks failed to load, so it is not safe to save changes yet. Please retry loading first.`
      );
      dismissUndoBar();
      return;
    }

    setBusyId(task.id);

    /* Read from the ref, not the `tasks` state captured when this
       action was scheduled - see the same comment in completeTask. */
    const previousTasks = tasksRef.current;

    try {

      if (task.notificationIds?.length) {
        await cancelTaskNotifications(
          task.notificationIds,
          currentUser.id
        );
      }

      const nextTasks =
        previousTasks.filter((item) => item.id !== task.id);

      await persistTasks(nextTasks);

      easeNext();

      setTasks(nextTasks);

      showSuccessToast(`${task.title} deleted.`);

    } catch (error) {

      console.log(error);

      setTasks(previousTasks);

      showErrorToast(
        'Could not delete this task. Please try again.'
      );

    } finally {

      setBusyId(null);
      dismissUndoBar();
    }
  };

  const duplicateTask = async (task) => {

    if (loadFailed) {
      showErrorToast(
        `Could not duplicate ${task.title}. Your tasks failed to load, so it is not safe to save changes yet. Please retry loading first.`
      );
      return;
    }

    setBusyId(task.id);

    const previousTasks = tasks;

    let scheduledIds = [];

    try {

      scheduledIds =
        (await scheduleTaskNotification(
          `${task.title} (copy)`,
          task.deadline,
          task.time,
          subject.name,
          currentUser.id,
          task.reminders || []
        )) || [];

      const copy = {
        ...task,
        id: createId(),
        title: `${task.title} (copy)`,
        status: 'Pending',
        completedAt: null,
        notificationIds: scheduledIds,
        createdAt: new Date().toISOString(),
      };

      const nextTasks = [...tasks, copy];

      await persistTasks(nextTasks);

      easeNext();

      setTasks(nextTasks);

      setHighlightId(copy.id);

      if (highlightTimer.current) {
        clearTimeout(highlightTimer.current);
      }

      highlightTimer.current = setTimeout(() => {
        highlightTimer.current = null;
        setHighlightId(null);
      }, 2000);

      showSuccessToast('Task duplicated.');

    } catch (error) {

      console.log(error);

      if (scheduledIds.length > 0) {
        await cancelTaskNotifications(
          scheduledIds,
          currentUser.id
        ).catch(() => {});
      }

      setTasks(previousTasks);

      showErrorToast(
        'Could not duplicate this task. Please try again.'
      );

    } finally {

      setBusyId(null);
    }
  };

  /* ---------------------------------------------------------------
     DERIVED
  --------------------------------------------------------------- */

  const decorated =
    useMemo(
      () =>
        tasks.map((task) => ({
          ...task,
          info: getDeadlineInfo(task.deadline),
        })),
      [tasks]
    );

  const pendingTasks =
    useMemo(
      () =>
        decorated.filter(
          (task) => task.status !== 'Completed'
        ),
      [decorated]
    );

  const completedTasks =
    useMemo(
      () =>
        decorated.filter(
          (task) => task.status === 'Completed'
        ),
      [decorated]
    );

  const sortTasks = useCallback((list) => {

    const next = [...list];

    if (sortMode === 'priority') {
      next.sort(
        (a, b) =>
          (PRIORITY_WEIGHT[a.priority] ?? 1) -
            (PRIORITY_WEIGHT[b.priority] ?? 1) ||
          (a.info.daysLeft ?? 9999) -
            (b.info.daysLeft ?? 9999)
      );
    } else if (sortMode === 'added') {
      next.sort((a, b) =>
        String(b.createdAt || b.id).localeCompare(
          String(a.createdAt || a.id)
        )
      );
    } else if (sortMode === 'type') {
      next.sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          (a.info.daysLeft ?? 9999) -
            (b.info.daysLeft ?? 9999)
      );
    } else {
      next.sort(
        (a, b) =>
          (a.info.daysLeft ?? 9999) -
          (b.info.daysLeft ?? 9999)
      );
    }

    return next;

  }, [sortMode]);

  const normalizedQuery =
    searchQuery.trim().toLowerCase();

  const matchesQuery = useCallback((task) =>
    normalizedQuery === '' ||
    task.title.toLowerCase().includes(normalizedQuery) ||
    task.type.toLowerCase().includes(normalizedQuery) ||
    (task.notes || '')
      .toLowerCase()
      .includes(normalizedQuery),
  [normalizedQuery]);

  const hiddenId = pendingAction?.task?.id;

  const visiblePending =
    useMemo(
      () =>
        sortTasks(
          pendingTasks.filter(
            (task) =>
              matchesQuery(task) && task.id !== hiddenId
          )
        ),
      [pendingTasks, matchesQuery, sortTasks, hiddenId]
    );

  const overdueGroup =
    visiblePending.filter((task) => task.info.isOverdue);

  const upcomingGroup =
    visiblePending.filter((task) => !task.info.isOverdue);

  const visibleCompleted =
    useMemo(
      () =>
        completedTasks
          .filter(
            (task) =>
              matchesQuery(task) && task.id !== hiddenId
          )
          .sort((a, b) =>
            String(b.completedAt || '').localeCompare(
              String(a.completedAt || '')
            )
          ),
      [completedTasks, matchesQuery, hiddenId]
    );

  const completionPercent =
    tasks.length === 0
      ? 0
      : Math.round(
          (completedTasks.length / tasks.length) * 100
        );

  const attendanceStats =
    useMemo(
      () =>
        subject
          ? getAttendanceStats(subject, attendance)
          : { percentage: 0, absences: 0 },
      [subject, attendance]
    );

  const attendanceTone =
    getAttendanceTone(attendanceStats.percentage, colors);

  const tabPillWidth =
    tabWidth > 0 ? (tabWidth - 8) / 2 : 0;

  const typePillWidth =
    typeWidth > 0
      ? (typeWidth - 8) / typeOptions.length
      : 0;

  const decorative = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
    pointerEvents: 'none',
  };

  const selectTab = (tab) => {

    setActiveTab(tab);

    Animated.timing(tabPill, {
      toValue: tab === 'Completed' ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    easeNext();
  };

  const handleScroll = (event) => {

    const y = event.nativeEvent.contentOffset.y;

    const goingDown = y > scrollOffset.current + 6;
    const goingUp = y < scrollOffset.current - 6;

    if (goingDown || goingUp) {

      Animated.spring(fabAnim, {
        toValue: goingDown ? 0 : 1,
        friction: 8,
        tension: 80,
        useNativeDriver: true,
      }).start();

      scrollOffset.current = y;
    }
  };

  /* NULL GUARD: after all hooks, so hook order stays stable. */

  if (!subject) {
    return null;
  }

  /* ---------------------------------------------------------------
     RENDER
  --------------------------------------------------------------- */

  const renderTaskCard = (task, index) => {

    const tone = getToneColor(task.info.tone, colors);

    const isCompleted = task.status === 'Completed';

    const isBusy = busyId === task.id;

    const highlighted = highlightId === task.id;

    return (
      <Animated.View
        key={task.id}
        style={{
          opacity: listAnim,
          transform: [
            {
              translateY: listAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [
                  Math.min(12 + index * 4, 30),
                  0,
                ],
              }),
            },
          ],
        }}
      >
        <SwipeableRow
          enabled={!isBusy}
          leftLabel={isCompleted ? 'Reopen' : 'Done'}
          leftIcon={isCompleted ? 'undo' : 'check'}
          leftColor={
            isCompleted ? colors.secondary : colors.success
          }
          rightColor={colors.danger}
          onSwipeRight={() => {
            if (isCompleted) {
              reopenTask(task);
            } else {
              runUndoable(task, 'complete', () =>
                completeTask(task)
              );
            }
          }}
          onSwipeLeft={() =>
            runUndoable(task, 'delete', () =>
              deleteTask(task)
            )
          }
          style={styles.swipeWrap}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${task.title}, ${task.type}, due ${task.info.label}${isCompleted ? ', completed' : ''}`}
            accessibilityHint="Opens this task for editing"
            disabled={isBusy}
            onPress={() => openEditForm(task)}
            style={({ hovered, pressed }) => [
              styles.taskCard,
              {
                backgroundColor: colors.card,
                borderColor: highlighted
                  ? colors.primary
                  : task.info.isOverdue && !isCompleted
                    ? `${colors.danger}55`
                    : 'transparent',
              },
              hovered && styles.cardHover,
              pressed && styles.cardPressed,
            ]}
          >

            <View
              style={[
                styles.taskAccent,
                {
                  backgroundColor: isCompleted
                    ? colors.success
                    : tone,
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
                  task.type === 'Quiz'
                    ? 'quiz'
                    : task.type === 'Project'
                      ? 'workspaces'
                      : task.type === 'Lab Task'
                        ? 'science'
                        : 'assignment'
                }
                size={22}
                color={
                  isCompleted ? colors.success : colors.primary
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
                    textDecorationLine: isCompleted
                      ? 'line-through'
                      : 'none',
                    opacity: isCompleted ? 0.7 : 1,
                  },
                ]}
              >
                {task.title}
              </Text>

              <View style={styles.taskMetaRow}>

                <Text
                  style={[
                    styles.taskType,
                    { color: colors.secondary },
                  ]}
                >
                  {task.type}
                </Text>

                {task.priority && task.priority !== 'Medium' && (
                  <View
                    style={[
                      styles.priorityChip,
                      {
                        backgroundColor:
                          task.priority === 'High'
                            ? `${colors.danger}1F`
                            : `${colors.textLight}1F`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.priorityText,
                        {
                          color:
                            task.priority === 'High'
                              ? colors.danger
                              : colors.textLight,
                        },
                      ]}
                    >
                      {task.priority}
                    </Text>
                  </View>
                )}

                {task.notes ? (
                  <MaterialIcons
                    name="sticky-note-2"
                    size={13}
                    color={colors.textLight}
                  />
                ) : null}

                {(task.reminders || []).length > 0 && (
                  <MaterialIcons
                    name="alarm"
                    size={13}
                    color={colors.textLight}
                  />
                )}

              </View>

              <Text
                style={[
                  styles.taskDeadline,
                  { color: colors.textLight },
                ]}
              >
                {task.deadline}
                {task.time ? ` · ${task.time}` : ''}
              </Text>

            </View>

            <View style={styles.taskRight}>

              {isBusy ? (

                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                />

              ) : (

                <>
                  <View
                    style={[
                      styles.deadlinePill,
                      {
                        backgroundColor: isCompleted
                          ? `${colors.success}1F`
                          : `${tone}1F`,
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.deadlinePillText,
                        {
                          color: isCompleted
                            ? colors.success
                            : tone,
                        },
                      ]}
                    >
                      {isCompleted ? 'Done' : task.info.label}
                    </Text>
                  </View>

                  <View style={styles.taskActions}>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Duplicate ${task.title}`}
                      hitSlop={6}
                      onPress={() => duplicateTask(task)}
                      style={({ pressed }) => [
                        styles.miniButton,
                        { backgroundColor: colors.background },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <MaterialIcons
                        name="content-copy"
                        size={15}
                        color={colors.textLight}
                      />
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        isCompleted
                          ? `Reopen ${task.title}`
                          : `Mark ${task.title} complete`
                      }
                      hitSlop={6}
                      onPress={() => {
                        if (isCompleted) {
                          reopenTask(task);
                        } else {
                          runUndoable(task, 'complete', () =>
                            completeTask(task)
                          );
                        }
                      }}
                      style={({ pressed }) => [
                        styles.miniButton,
                        {
                          backgroundColor: isDarkMode
                            ? 'rgba(34,197,94,0.16)'
                            : '#DCFCE7',
                        },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <MaterialIcons
                        name={isCompleted ? 'undo' : 'check'}
                        size={16}
                        color={colors.success}
                      />
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${task.title}`}
                      hitSlop={6}
                      onPress={() =>
                        runUndoable(task, 'delete', () =>
                          deleteTask(task)
                        )
                      }
                      style={({ pressed }) => [
                        styles.miniButton,
                        {
                          backgroundColor: isDarkMode
                            ? 'rgba(248,113,113,0.16)'
                            : '#FEE2E2',
                        },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <MaterialIcons
                        name="delete-outline"
                        size={16}
                        color={colors.danger}
                      />
                    </Pressable>

                  </View>
                </>

              )}

            </View>

          </Pressable>
        </SwipeableRow>
      </Animated.View>
    );
  };

  const activeList =
    activeTab === 'Pending'
      ? visiblePending
      : visibleCompleted;

  return (

    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: colors.background },
      ]}
    >

      <StatusBar
        backgroundColor={colors.background}
        barStyle={
          isDarkMode ? 'light-content' : 'dark-content'
        }
      />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{
          paddingBottom: SCREEN_BOTTOM_PADDING,
        }}
      >

        {/* HEADER */}

        <Animated.View
          style={[
            styles.header,
            {
              backgroundColor: isDarkMode
                ? colors.card
                : '#EEE9FF',
              borderColor: isDarkMode
                ? 'rgba(165,180,252,0.14)'
                : 'rgba(124,58,237,0.08)',
              opacity: headerAnim,
              transform: [
                {
                  translateY: headerAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-18, 0],
                  }),
                },
              ],
            },
          ]}
        >

          <View {...decorative} style={StyleSheet.absoluteFill}>
            <View
              style={[
                styles.headerWaveOne,
                isDarkMode && styles.headerWaveDark,
              ]}
            />
            <View
              style={[
                styles.headerWaveTwo,
                isDarkMode && styles.headerWaveTwoDark,
              ]}
            />
            <View style={styles.headerSparkle} />
          </View>

          <View style={styles.headerTop}>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={goBack}
              style={({ hovered, pressed }) => [
                styles.backButton,
                { backgroundColor: colors.card },
                hovered && styles.iconButtonHover,
                pressed && styles.cardPressed,
              ]}
            >
              <MaterialIcons
                name="arrow-back"
                size={23}
                color={colors.primary}
              />
            </Pressable>

            <View style={styles.headerIdentity}>
              <Text
                numberOfLines={1}
                style={[
                  styles.subjectName,
                  {
                    color: subject.color || colors.primary,
                  },
                ]}
              >
                {subject.name}
              </Text>
              <Text
                style={[
                  styles.subjectType,
                  { color: colors.textLight },
                ]}
              >
                {subject.type}
                {scheduleCount > 0
                  ? ` · ${scheduleCount} class${scheduleCount === 1 ? '' : 'es'}/week`
                  : ''}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showSearch ? 'Hide search' : 'Search tasks'
              }
              onPress={() => {
                easeNext(180);
                setShowSearch((value) => !value);
                if (showSearch) {
                  setSearchQuery('');
                }
              }}
              style={({ hovered, pressed }) => [
                styles.backButton,
                { backgroundColor: colors.card },
                hovered && styles.iconButtonHover,
                pressed && styles.cardPressed,
              ]}
            >
              <MaterialIcons
                name={showSearch ? 'close' : 'search'}
                size={22}
                color={colors.primary}
              />
            </Pressable>

          </View>

          {/* SUMMARY */}

          <View style={styles.summaryRow}>

            <ProgressRing
              percentage={completionPercent}
              size={86}
              thickness={8}
              color={
                completionPercent >= 70
                  ? colors.success
                  : completionPercent >= 40
                    ? colors.warning
                    : colors.primary
              }
              trackColor={
                isDarkMode
                  ? 'rgba(165,180,252,0.18)'
                  : 'rgba(91,95,239,0.14)'
              }
            >
              <CountUp
                value={completionPercent}
                suffix="%"
                style={[
                  styles.ringValue,
                  { color: colors.textDark },
                ]}
              />
            </ProgressRing>

            <View style={styles.summaryInfo}>

              <Text
                style={[
                  styles.summaryTitle,
                  { color: colors.textDark },
                ]}
              >
                {completedTasks.length} of {tasks.length} done
              </Text>

              <Text
                style={[
                  styles.summaryMeta,
                  { color: colors.textLight },
                ]}
              >
                {overdueGroup.length > 0
                  ? `${overdueGroup.length} overdue · ${pendingTasks.length} pending`
                  : `${pendingTasks.length} pending`}
              </Text>

              <View style={styles.summaryAttendance}>
                <Text
                  style={[
                    styles.summaryLabel,
                    { color: colors.textLight },
                  ]}
                >
                  Attendance
                </Text>
                <Text
                  style={[
                    styles.summaryValue,
                    { color: attendanceTone },
                  ]}
                >
                  {attendanceStats.percentage}%
                </Text>
              </View>

              <AnimatedBar
                percentage={attendanceStats.percentage}
                color={attendanceTone}
                trackColor={
                  isDarkMode ? colors.surface : '#E5E7EB'
                }
                height={6}
                pulse={
                  attendanceStats.percentage <
                  ATTENDANCE_THRESHOLD
                }
              />

            </View>

          </View>

        </Animated.View>

        {/* SEARCH */}

        {showSearch && (

          <View
            style={[
              styles.searchRow,
              {
                backgroundColor: colors.card,
                borderColor: isDarkMode
                  ? 'rgba(165,180,252,0.14)'
                  : 'rgba(91,95,239,0.10)',
              },
            ]}
          >
            <MaterialIcons
              name="search"
              size={20}
              color={colors.textLight}
            />
            <TextInput
              accessibilityLabel="Search tasks"
              placeholder="Search title, type or notes"
              placeholderTextColor={colors.textLight}
              value={searchQuery}
              onChangeText={(value) => {
                easeNext(160);
                setSearchQuery(value);
              }}
              autoFocus
              style={[
                styles.searchInput,
                { color: colors.textDark },
              ]}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={8}
                onPress={() => {
                  easeNext(160);
                  setSearchQuery('');
                }}
              >
                <MaterialIcons
                  name="close"
                  size={19}
                  color={colors.textLight}
                />
              </Pressable>
            )}
          </View>

        )}

        {/* TABS */}

        {tasks.length > 0 && (

          <View
            onLayout={(event) =>
              setTabWidth(event.nativeEvent.layout.width)
            }
            style={[
              styles.segment,
              { backgroundColor: colors.card },
            ]}
          >
            {tabPillWidth > 0 && (
              <Animated.View
                style={[
                  styles.segmentPill,
                  {
                    width: tabPillWidth,
                    backgroundColor: colors.primary,
                    transform: [
                      {
                        translateX: tabPill.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, tabPillWidth],
                        }),
                      },
                    ],
                  },
                ]}
              />
            )}

            {['Pending', 'Completed'].map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{
                  selected: activeTab === tab,
                }}
                accessibilityLabel={`${tab} tasks`}
                style={styles.segmentButton}
                onPress={() => selectTab(tab)}
              >
                <Text
                  style={[
                    styles.segmentText,
                    {
                      color:
                        activeTab === tab
                          ? '#FFFFFF'
                          : colors.textLight,
                    },
                  ]}
                >
                  {tab} (
                  {tab === 'Pending'
                    ? pendingTasks.length
                    : completedTasks.length}
                  )
                </Text>
              </Pressable>
            ))}
          </View>

        )}

        {/* SORT */}

        {activeTab === 'Pending' && tasks.length > 1 && (

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortRow}
          >
            <Text
              style={[
                styles.sortLabel,
                { color: colors.textLight },
              ]}
            >
              Sort
            </Text>

            {SORT_OPTIONS.map((option) => {

              const active = sortMode === option.key;

              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Sort by ${option.label}`}
                  onPress={() => {
                    easeNext();
                    setSortMode(option.key);
                  }}
                  style={({ pressed }) => [
                    styles.sortChip,
                    {
                      backgroundColor: active
                        ? `${colors.primary}1F`
                        : colors.card,
                      borderColor: active
                        ? colors.primary
                        : 'transparent',
                    },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      {
                        color: active
                          ? colors.primary
                          : colors.textLight,
                      },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

        )}

        {/* LIST */}

        {isLoading && (
          <SkeletonList count={4} lines={2} />
        )}

        {!isLoading && loadFailed && tasks.length === 0 && (

          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card },
            ]}
          >
            <MaterialIcons
              name="cloud-off"
              size={40}
              color={colors.danger}
            />

            <Text
              style={[
                styles.emptyTitle,
                { color: colors.textDark },
              ]}
            >
              Could not load these tasks
            </Text>
            <Text
              style={[
                styles.emptyText,
                { color: colors.textLight },
              ]}
            >
              Your tasks may still be there - we just could not
              read them. Adding one now would risk losing them, so
              please retry loading first.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading tasks"
              onPress={() => loadData()}
              style={({ pressed }) => [
                styles.emptyAction,
                { backgroundColor: colors.primary },
                pressed && styles.cardPressed,
              ]}
            >
              <MaterialIcons
                name="refresh"
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.emptyActionText}>
                Retry
              </Text>
            </Pressable>
          </View>

        )}

        {!isLoading && !loadFailed && tasks.length === 0 && (

          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card },
            ]}
          >
            <Animated.View
              style={{
                transform: [
                  {
                    translateY: emptyBob.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -7],
                    }),
                  },
                ],
              }}
            >
              <MaterialIcons
                name="assignment"
                size={40}
                color={colors.textLight}
              />
            </Animated.View>

            <Text
              style={[
                styles.emptyTitle,
                { color: colors.textDark },
              ]}
            >
              No tasks yet
            </Text>
            <Text
              style={[
                styles.emptyText,
                { color: colors.textLight },
              ]}
            >
              Add quizzes, assignments and projects for
              {' '}{subject.name} to get deadline reminders.
            </Text>

            <Animated.View
              style={{
                transform: [
                  {
                    scale: emptyBob.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.04],
                    }),
                  },
                ],
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add your first task"
                onPress={openAddForm}
                style={({ pressed }) => [
                  styles.emptyAction,
                  { backgroundColor: colors.primary },
                  pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name="add"
                  size={18}
                  color="#FFFFFF"
                />
                <Text style={styles.emptyActionText}>
                  Add Task
                </Text>
              </Pressable>
            </Animated.View>
          </View>

        )}

        {!isLoading &&
          tasks.length > 0 &&
          activeList.length === 0 && (

          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card },
            ]}
          >
            <MaterialIcons
              name={
                normalizedQuery ? 'search-off' : 'task-alt'
              }
              size={34}
              color={colors.textLight}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.textDark },
              ]}
            >
              {normalizedQuery
                ? 'No matching tasks'
                : activeTab === 'Pending'
                  ? 'Nothing pending'
                  : 'Nothing completed yet'}
            </Text>
          </View>

        )}

        {!isLoading &&
          activeTab === 'Pending' &&
          overdueGroup.length > 0 && (

          <>
            <View style={styles.groupHeader}>
              <MaterialIcons
                name="error-outline"
                size={18}
                color={colors.danger}
              />
              <Text
                style={[
                  styles.groupTitle,
                  { color: colors.danger },
                ]}
              >
                Overdue ({overdueGroup.length})
              </Text>
            </View>

            {overdueGroup.map(renderTaskCard)}
          </>

        )}

        {!isLoading &&
          activeTab === 'Pending' &&
          upcomingGroup.length > 0 && (

          <>
            {overdueGroup.length > 0 && (
              <View style={styles.groupHeader}>
                <MaterialIcons
                  name="schedule"
                  size={18}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.groupTitle,
                    { color: colors.textDark },
                  ]}
                >
                  Upcoming ({upcomingGroup.length})
                </Text>
              </View>
            )}

            {upcomingGroup.map(renderTaskCard)}
          </>

        )}

        {!isLoading &&
          activeTab === 'Completed' &&
          visibleCompleted.map(renderTaskCard)}

      </ScrollView>

      {/* UNDO BAR */}

      {pendingAction && (

        <Animated.View
          style={[
            styles.undoBar,
            {
              backgroundColor: isDarkMode
                ? colors.card
                : '#1E293B',
              opacity: undoAnim,
              transform: [
                {
                  translateY: undoAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [40, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <MaterialIcons
            name={
              pendingAction.type === 'delete'
                ? 'delete-outline'
                : 'check-circle-outline'
            }
            size={19}
            color="#FFFFFF"
          />
          <Text numberOfLines={2} style={styles.undoText}>
            {pendingAction.type === 'delete'
              ? 'Deleting'
              : 'Completing'}{' '}
            {pendingAction.task.title}...
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Undo"
            onPress={cancelPending}
            style={({ pressed }) => [
              styles.undoButton,
              pressed && styles.cardPressed,
            ]}
          >
            <Text
              style={[
                styles.undoButtonText,
                { color: colors.accent },
              ]}
            >
              UNDO
            </Text>
          </Pressable>
        </Animated.View>

      )}

      {/* FAB */}

      <Animated.View
        style={[
          styles.fabWrap,
          {
            opacity: fabAnim,
            transform: [
              { scale: fabAnim },
              {
                translateY: fabAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [70, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a new task"
          onPress={openAddForm}
          style={({ hovered, pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary },
            hovered && styles.primaryHover,
            pressed && styles.cardPressed,
          ]}
        >
          <MaterialIcons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* ADD / EDIT SHEET */}

      <Modal
        visible={formVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeSheet}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={
            Platform.OS === 'ios' ? 'padding' : undefined
          }
        >
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.card,
                  opacity: sheetAnim,
                  transform: [
                    {
                      translateY: sheetAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [40, 0],
                      }),
                    },
                  ],
                },
              ]}
            >

              <View style={styles.sheetHeader}>
                <Text
                  style={[
                    styles.sheetTitle,
                    { color: colors.textDark },
                  ]}
                >
                  {editingId ? 'Edit Task' : 'Add Task'}
                </Text>

                <Animated.View
                  style={{
                    opacity: savedTick,
                    transform: [{ scale: savedTick }],
                  }}
                >
                  <MaterialIcons
                    name="check-circle"
                    size={24}
                    color={colors.success}
                  />
                </Animated.View>
              </View>

              <TextInput
                ref={titleRef}
                placeholder="Task title"
                placeholderTextColor={colors.textLight}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.background,
                    color: colors.textDark,
                    borderColor: formError
                      ? colors.danger
                      : 'transparent',
                  },
                ]}
                value={formTitle}
                onChangeText={(value) => {
                  setFormTitle(value);
                  if (formError) {
                    setFormError('');
                  }
                }}
                returnKeyType="next"
              />

              {/* TYPE */}

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Type
              </Text>

              <View
                onLayout={(event) =>
                  setTypeWidth(
                    event.nativeEvent.layout.width
                  )
                }
                style={[
                  styles.segment,
                  {
                    backgroundColor: colors.background,
                    marginTop: 0,
                  },
                ]}
              >
                {typePillWidth > 0 && (
                  <Animated.View
                    style={[
                      styles.segmentPill,
                      {
                        width: typePillWidth,
                        backgroundColor: colors.primary,
                        transform: [
                          {
                            translateX: typePill.interpolate({
                              inputRange: [
                                0,
                                typeOptions.length - 1,
                              ],
                              outputRange: [
                                0,
                                typePillWidth *
                                  (typeOptions.length - 1),
                              ],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                )}

                {typeOptions.map((option, index) => (
                  <Pressable
                    key={option}
                    accessibilityRole="tab"
                    accessibilityState={{
                      selected: formType === option,
                    }}
                    accessibilityLabel={`${option} type`}
                    style={styles.segmentButton}
                    onPress={() => selectType(option, index)}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.segmentText,
                        {
                          color:
                            formType === option
                              ? '#FFFFFF'
                              : colors.textLight,
                        },
                      ]}
                    >
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* PRIORITY */}

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Priority
              </Text>

              <View style={styles.priorityRow}>
                {PRIORITIES.map((option) => {

                  const active = formPriority === option.key;

                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${option.key} priority`}
                      onPress={() =>
                        setFormPriority(option.key)
                      }
                      style={({ pressed }) => [
                        styles.priorityOption,
                        {
                          backgroundColor: active
                            ? `${colors.primary}1F`
                            : colors.background,
                          borderColor: active
                            ? colors.primary
                            : 'transparent',
                        },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <MaterialIcons
                        name={option.icon}
                        size={16}
                        color={
                          active
                            ? colors.primary
                            : colors.textLight
                        }
                      />
                      <Text
                        style={[
                          styles.priorityOptionText,
                          {
                            color: active
                              ? colors.primary
                              : colors.textLight,
                          },
                        ]}
                      >
                        {option.key}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* DEADLINE */}

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Deadline
              </Text>

              <View style={styles.dateRow}>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick deadline date"
                  onPress={() => setPicker('date')}
                  style={({ pressed }) => [
                    styles.dateButton,
                    { backgroundColor: colors.background },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="event"
                    size={17}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dateButtonText,
                      {
                        color: formDateText
                          ? colors.textDark
                          : colors.textLight,
                      },
                    ]}
                  >
                    {formDateText || 'Select date'}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick deadline time"
                  onPress={() => setPicker('time')}
                  style={({ pressed }) => [
                    styles.dateButton,
                    { backgroundColor: colors.background },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="schedule"
                    size={17}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dateButtonText,
                      {
                        color: formTimeText
                          ? colors.textDark
                          : colors.textLight,
                      },
                    ]}
                  >
                    {formTimeText || 'Optional time'}
                  </Text>
                </Pressable>

              </View>

              {/* NOTES */}

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Notes
              </Text>

              <TextInput
                placeholder="Syllabus, chapters, requirements..."
                placeholderTextColor={colors.textLight}
                style={[
                  styles.notesInput,
                  {
                    backgroundColor: colors.background,
                    color: colors.textDark,
                  },
                ]}
                value={formNotes}
                onChangeText={setFormNotes}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {/* REMINDERS */}

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Extra reminders
              </Text>

              <View style={styles.dateRow}>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick reminder date"
                  onPress={() => setPicker('reminderDate')}
                  style={({ pressed }) => [
                    styles.dateButton,
                    { backgroundColor: colors.background },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="event"
                    size={17}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dateButtonText,
                      { color: colors.textDark },
                    ]}
                  >
                    {reminderDateText}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pick reminder time"
                  onPress={() => setPicker('reminderTime')}
                  style={({ pressed }) => [
                    styles.dateButton,
                    { backgroundColor: colors.background },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="schedule"
                    size={17}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.dateButtonText,
                      { color: colors.textDark },
                    ]}
                  >
                    {reminderTimeText}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add this reminder"
                  onPress={addReminder}
                  style={({ pressed }) => [
                    styles.reminderAdd,
                    { backgroundColor: colors.primary },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="add"
                    size={20}
                    color="#FFFFFF"
                  />
                </Pressable>

              </View>

              {formReminders.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.reminderChip,
                    { backgroundColor: colors.background },
                  ]}
                >
                  <MaterialIcons
                    name="alarm"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.reminderText,
                      { color: colors.textDark },
                    ]}
                  >
                    {item.label}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove reminder ${item.label}`}
                    hitSlop={8}
                    onPress={() => {
                      easeNext(180);
                      setFormReminders(
                        formReminders.filter(
                          (entry) => entry.id !== item.id
                        )
                      );
                    }}
                  >
                    <MaterialIcons
                      name="close"
                      size={16}
                      color={colors.danger}
                    />
                  </Pressable>
                </View>
              ))}

              {formError.length > 0 && (
                <Text
                  style={[
                    styles.fieldError,
                    { color: colors.danger },
                  ]}
                >
                  {formError}
                </Text>
              )}

              <View style={styles.sheetActions}>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                  disabled={isSaving}
                  style={({ hovered, pressed }) => [
                    styles.cancelButton,
                    { backgroundColor: colors.background },
                    hovered && styles.iconButtonHover,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={closeSheet}
                >
                  <Text
                    style={[
                      styles.cancelText,
                      { color: colors.textDark },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    editingId ? 'Save changes' : 'Add task'
                  }
                  accessibilityState={{ busy: isSaving }}
                  disabled={isSaving}
                  style={({ hovered, pressed }) => [
                    styles.saveButton,
                    { backgroundColor: colors.primary },
                    isSaving && styles.buttonDisabled,
                    hovered && !isSaving && styles.primaryHover,
                    pressed && !isSaving && styles.cardPressed,
                  ]}
                  onPress={handleSaveTask}
                >
                  {isSaving ? (
                    <>
                      <ActivityIndicator
                        size="small"
                        color="#FFFFFF"
                      />
                      <Text style={styles.saveText}>
                        Saving...
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.saveText}>
                      {editingId ? 'Save' : 'Add'}
                    </Text>
                  )}
                </Pressable>

              </View>

            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* PICKERS */}

      {picker && (
        <DateTimePicker
          value={
            picker === 'date'
              ? parseDateInput(formDateText) || new Date()
              : picker === 'time'
                ? parseTimeInput(formTimeText) || new Date()
                : picker === 'reminderDate'
                  ? parseDateInput(reminderDateText) || new Date()
                  : parseTimeInput(reminderTimeText) || new Date()
          }
          mode={
            picker === 'date' || picker === 'reminderDate'
              ? 'date'
              : 'time'
          }
          display={
            Platform.OS === 'ios' ? 'spinner' : 'default'
          }
          minimumDate={
            picker === 'date' ? new Date() : undefined
          }
          onChange={(event, selected) => {

            setPicker(null);

            if (!selected || event?.type === 'dismissed') {
              return;
            }

            if (picker === 'date') {
              setFormDateText(formatDateLabel(selected));
            } else if (picker === 'time') {
              setFormTimeText(formatTimeLabel(selected));
            } else if (picker === 'reminderDate') {
              setReminderDateText(formatDateLabel(selected));
            } else {
              setReminderTimeText(formatTimeLabel(selected));
            }
          }}
        />
      )}

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

  /* HEADER */

  header: {
    position: 'relative',
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 14,
  },

  headerWaveOne: {
    position: 'absolute',
    left: -44,
    right: -52,
    top: 44,
    height: 78,
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 190,
    transform: [{ rotate: '-7deg' }],
  },

  headerWaveDark: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },

  headerWaveTwo: {
    position: 'absolute',
    left: -36,
    right: -42,
    bottom: -24,
    height: 84,
    backgroundColor: 'rgba(221,214,254,0.48)',
    borderTopLeftRadius: 180,
    borderTopRightRadius: 120,
    transform: [{ rotate: '6deg' }],
  },

  headerWaveTwoDark: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },

  headerSparkle: {
    position: 'absolute',
    right: '28%',
    top: 18,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: 'rgba(196,181,253,0.78)',
    transform: [{ rotate: '45deg' }],
  },

  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 3,
  },

  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  headerIdentity: {
    flex: 1,
  },

  subjectName: {
    fontSize: 22,
    fontWeight: 'bold',
  },

  subjectType: {
    marginTop: 3,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 18,
    zIndex: 3,
  },

  ringValue: {
    fontSize: 17,
    fontWeight: 'bold',
  },

  summaryInfo: {
    flex: 1,
  },

  summaryTitle: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  summaryMeta: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  summaryAttendance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 6,
  },

  summaryLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  summaryValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  /* CONTROLS */

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
  },

  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    fontWeight: '600',
  },

  segment: {
    position: 'relative',
    flexDirection: 'row',
    borderRadius: 14,
    padding: 4,
    marginBottom: 12,
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
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderRadius: 11,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  segmentText: {
    fontSize: 12,
    fontWeight: 'bold',
  },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
    paddingBottom: 12,
  },

  sortLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  sortChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  sortChipText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* GROUPS */

  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    marginBottom: 10,
  },

  groupTitle: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  /* TASK CARD */

  swipeWrap: {
    marginBottom: 10,
  },

  taskCard: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    paddingLeft: 18,
    borderRadius: CARD_RADIUS,
    borderWidth: 1.5,
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
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },

  taskInfo: {
    flex: 1,
  },

  taskTitle: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 4,
  },

  taskType: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  priorityChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
  },

  priorityText: {
    fontSize: 9,
    fontWeight: 'bold',
  },

  taskDeadline: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '600',
  },

  taskRight: {
    alignItems: 'flex-end',
    gap: 8,
  },

  deadlinePill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    maxWidth: 96,
  },

  deadlinePillText: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  taskActions: {
    flexDirection: 'row',
    gap: 5,
  },

  miniButton: {
    width: 28,
    height: 28,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  /* EMPTY */

  emptyCard: {
    alignItems: 'center',
    padding: 30,
    borderRadius: CARD_RADIUS,
    marginBottom: 10,
    ...SHADOW,
  },

  emptyTitle: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  emptyText: {
    marginTop: 8,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },

  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 13,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  emptyActionText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  /* UNDO */

  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    ...SHADOW,
  },

  undoText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
  },

  undoButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  undoButtonText: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
    letterSpacing: 0.6,
  },

  /* FAB */

  fabWrap: {
    position: 'absolute',
    right: 20,
    bottom: 28,
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

  /* SHEET */

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },

  modalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 26,
  },

  sheet: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderRadius: CARD_RADIUS,
    padding: 22,
    ...SHADOW,
  },

  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },

  sheetTitle: {
    fontSize: TYPOGRAPHY.sectionTitle,
    fontWeight: 'bold',
  },

  input: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: TYPOGRAPHY.body,
  },

  notesInput: {
    minHeight: 78,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: TYPOGRAPHY.small,
  },

  fieldLabel: {
    marginTop: 18,
    marginBottom: 9,
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  fieldError: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
    lineHeight: 17,
  },

  priorityRow: {
    flexDirection: 'row',
    gap: 8,
  },

  priorityOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  priorityOptionText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  dateRow: {
    flexDirection: 'row',
    gap: 8,
  },

  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 12,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  dateButtonText: {
    flex: 1,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  reminderAdd: {
    width: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  reminderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
  },

  reminderText: {
    flex: 1,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },

  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  cancelText: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  saveButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 13,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  saveText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  /* INTERACTION */

  cardHover: {
    transform: [{ translateY: -2 }],
  },

  iconButtonHover: {
    backgroundColor: 'rgba(91,95,239,0.12)',
  },

  primaryHover: {
    transform: [{ translateY: -2 }],
  },

  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },

});
