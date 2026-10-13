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
  SkeletonList,
} from '../components/Skeleton';

import {
  AnimatedBar,
} from '../components/AnimatedStats';

import {
  deleteSubjectAttendance,
  deleteSubjectClassSchedules,
  deleteSubjectTasks,
  loadSubjectTasks,
  loadUserAttendance,
  loadUserClassSchedules,
  loadUserSubjects,
  loadUserTasksBySubject,
  saveUserSubjects,
} from '../utils/localData';

import {
  DATA_DOMAINS,
  onDataChanged,
} from '../utils/dataEvents';

import {
  cancelClassNotifications,
  cancelTaskNotifications,
} from '../utils/notifications';

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

const UNDO_WINDOW = 5000;

const SUBJECT_COLORS = [
  '#5B5FEF',
  '#0EA5A4',
  '#F59E0B',
  '#EC4899',
  '#8B5CF6',
  '#22C55E',
  '#EF4444',
  '#0EA5E9',
];

const SORT_OPTIONS = [
  { key: 'recent', label: 'Recent' },
  { key: 'name', label: 'Name' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'pending', label: 'Pending' },
];

const TYPE_FILTERS = ['All', 'Theory', 'Lab'];

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

export default function SubjectsScreen({
  goBack,
  canGoBack,
  openSubjectDetails,
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

  const [subjects, setSubjects] =
    useState([]);

  /* Mirrors `subjects` outside of React state so the undo-delete timer
     (which fires several seconds after render) always writes whatever
     is current, not whatever was captured when the timer was armed. */
  const subjectsRef = useRef(subjects);

  useEffect(() => {
    subjectsRef.current = subjects;
  }, [subjects]);

  const [loadFailed, setLoadFailed] =
    useState(false);

  const [taskMap, setTaskMap] =
    useState({});

  const [attendanceMap, setAttendanceMap] =
    useState({});

  const [scheduleMap, setScheduleMap] =
    useState({});

  /* VIEW */

  const [searchQuery, setSearchQuery] =
    useState('');

  const [typeFilter, setTypeFilter] =
    useState('All');

  const [sortMode, setSortMode] =
    useState('recent');

  const [showArchived, setShowArchived] =
    useState(false);

  /* MODALS */

  const [formVisible, setFormVisible] =
    useState(false);

  const [editingId, setEditingId] =
    useState(null);

  const [formName, setFormName] =
    useState('');

  const [formType, setFormType] =
    useState('Theory');

  const [formColor, setFormColor] =
    useState(SUBJECT_COLORS[0]);

  const [formError, setFormError] =
    useState('');

  const [confirmSubject, setConfirmSubject] =
    useState(null);

  /* BUSY */

  const [isLoading, setIsLoading] =
    useState(true);

  const [isSaving, setIsSaving] =
    useState(false);

  const [busyId, setBusyId] =
    useState(null);

  /* UNDO
     The cascade only runs once the undo window closes, so a
     mistaken delete costs nothing. */

  const [pendingDelete, setPendingDelete] =
    useState(null);

  const undoTimer = useRef(null);

  /* Mirrors `pendingDelete` so the unmount cleanup below can flush a
     still-pending delete instead of silently discarding it. */
  const pendingDeleteRef = useRef(null);

  useEffect(() => {
    pendingDeleteRef.current = pendingDelete;
  }, [pendingDelete]);

  const [highlightId, setHighlightId] =
    useState(null);

  const highlightTimer = useRef(null);

  const isMountedRef = useRef(true);

  const nameRef = useRef(null);

  /* ANIMATIONS */

  const headerAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const pillAnim = useRef(new Animated.Value(0)).current;
  const typePillAnim = useRef(new Animated.Value(0)).current;
  const dangerShake = useRef(new Animated.Value(0)).current;
  const emptyBob = useRef(new Animated.Value(0)).current;
  const savedTick = useRef(new Animated.Value(0)).current;
  const undoAnim = useRef(new Animated.Value(0)).current;

  const [filterWidth, setFilterWidth] =
    useState(0);

  const [typeWidth, setTypeWidth] =
    useState(0);

  /* ---------------------------------------------------------------
     LOAD
  --------------------------------------------------------------- */

  /* `silent` is used for event-driven reloads triggered by another
     screen's write - those should refresh the data underneath the
     user without flashing the skeleton or re-running entrance
     animations that are keyed off `isLoading`. */
  const loadData = useCallback(async ({ silent = false } = {}) => {

    if (!currentUser?.id) {
      setIsLoading(false);
      return;
    }

    if (!silent) {
      setIsLoading(true);
    }

    try {

      const [
        allSubjects,
        tasks,
        attendance,
        schedules,
      ] = await Promise.all([
        loadUserSubjects(currentUser.id, {
          includeArchived: true,
        }),
        loadUserTasksBySubject(currentUser.id).catch(() => ({})),
        loadUserAttendance(currentUser.id).catch(() => ({})),
        loadUserClassSchedules(currentUser.id).catch(() => ({})),
      ]);

      setSubjects(allSubjects);
      setTaskMap(tasks || {});
      setAttendanceMap(attendance || {});
      setScheduleMap(schedules || {});
      setLoadFailed(false);

    } catch (error) {

      console.log(error);

      /* A failed load must never be allowed to look like "no
         subjects yet" - that empty state invites an Add, and saving
         from it would wipe out whatever real data failed to load. */
      setLoadFailed(true);

      showErrorToast(
        'Could not load your subjects. Check your connection and try again.'
      );

    } finally {

      if (!silent) {
        setIsLoading(false);
      }
    }

  }, [currentUser, showErrorToast]);

  useEffect(() => {

    loadData();

  }, [loadData]);

  /* Local writes made from other screens (Home marking attendance,
     Subject Detail editing a task, ...) emit here instantly - no
     polling, no network, so this just re-reads the local database.
     Only the domains this screen actually shows are worth a reload,
     and since the write already happened elsewhere this is always a
     silent, background refresh - never a skeleton flash. */
  useEffect(() => {

    const relevantDomains = [
      DATA_DOMAINS.SUBJECTS,
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

  /* ENTRANCE */

  useEffect(() => {

    if (isLoading) {
      return undefined;
    }

    Animated.stagger(120, [
      Animated.timing(headerAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(listAnim, {
        toValue: 1,
        duration: 420,
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

  /* If the screen goes away mid undo-window, the row is already
     hidden from the visible list - dropping the timer here (instead
     of flushing it) would silently resurrect the "deleted" subject
     on the next load, which reads as a lost write to the user. So
     the cascade is run immediately rather than discarded. */

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

        if (pendingDeleteRef.current) {
          commitDelete(pendingDeleteRef.current);
        }
      }
    },
  []);

  /* ---------------------------------------------------------------
     PERSIST
     Every write is awaited inside the handler that triggered it,
     and rolled back on failure. There is no save-on-render
     effect, so opening the screen never rewrites the database.
  --------------------------------------------------------------- */

  const persistSubjects = async (nextSubjects) => {

    await saveUserSubjects(
      currentUser.id,
      nextSubjects
    );
  };

  /* FORM */

  const openAddForm = () => {

    setEditingId(null);
    setFormName('');
    setFormType('Theory');
    setFormColor(
      SUBJECT_COLORS[
        subjects.length % SUBJECT_COLORS.length
      ]
    );
    setFormError('');
    setFormVisible(true);

    typePillAnim.setValue(0);
    savedTick.setValue(0);

    Animated.spring(sheetAnim, {
      toValue: 1,
      friction: 9,
      tension: 68,
      useNativeDriver: true,
    }).start();

    setTimeout(
      () => nameRef.current?.focus(),
      280
    );
  };

  const openEditForm = (subject) => {

    setEditingId(subject.id);
    setFormName(subject.name);
    setFormType(subject.type || 'Theory');
    setFormColor(
      subject.color || SUBJECT_COLORS[0]
    );
    setFormError('');
    setFormVisible(true);

    typePillAnim.setValue(
      (subject.type || 'Theory') === 'Lab' ? 1 : 0
    );
    savedTick.setValue(0);

    Animated.spring(sheetAnim, {
      toValue: 1,
      friction: 9,
      tension: 68,
      useNativeDriver: true,
    }).start();
  };

  const closeForm = () => {

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
    });
  };

  const selectType = (nextType) => {

    setFormType(nextType);

    Animated.timing(typePillAnim, {
      toValue: nextType === 'Lab' ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleSaveSubject = async () => {

    if (isSaving) {
      return;
    }

    if (loadFailed) {
      showErrorToast(
        'Your subjects failed to load, so changes cannot be saved yet. Please retry loading first.'
      );
      return;
    }

    const trimmed = formName.trim();

    if (trimmed.length === 0) {
      setFormError('Please enter a subject name.');
      return;
    }

    const duplicate =
      subjects.some(
        (item) =>
          item.id !== editingId &&
          item.name.trim().toLowerCase() ===
            trimmed.toLowerCase() &&
          (item.type || 'Theory') === formType
      );

    if (duplicate) {
      setFormError(
        `A ${formType} subject called "${trimmed}" already exists.`
      );
      return;
    }

    setFormError('');
    setIsSaving(true);

    const previous = subjects;

    const nextSubjects =
      editingId
        ? subjects.map((item) =>
            item.id === editingId
              ? {
                  ...item,
                  name: trimmed,
                  type: formType,
                  color: formColor,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )
        : [
            ...subjects,
            {
              id: createId(),
              name: trimmed,
              type: formType,
              color: formColor,
              createdAt: new Date().toISOString(),
            },
          ];

    try {

      /* Saved first, shown second: the list only changes once
         the database has actually accepted it. */

      await persistSubjects(nextSubjects);

      easeNext();

      setSubjects(nextSubjects);

      const savedId =
        editingId ||
        nextSubjects[nextSubjects.length - 1].id;

      setHighlightId(savedId);

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
        Animated.delay(320),
      ]).start(() => {
        closeForm();
      });

      showSuccessToast(
        editingId
          ? `${trimmed} updated.`
          : `${trimmed} added.`
      );

    } catch (error) {

      console.log(error);

      setSubjects(previous);

      setFormError(
        'Could not save. Please check your connection and try again.'
      );

    } finally {

      setIsSaving(false);
    }
  };

  /* ARCHIVE */

  const toggleArchive = async (subject) => {

    if (busyId) {
      return;
    }

    if (loadFailed) {
      showErrorToast(
        'Your subjects failed to load, so changes cannot be saved yet. Please retry loading first.'
      );
      return;
    }

    setBusyId(subject.id);

    const previous = subjects;

    const nextSubjects =
      subjects.map((item) =>
        item.id === subject.id
          ? {
              ...item,
              archived: !item.archived,
              archivedAt: !item.archived
                ? new Date().toISOString()
                : null,
            }
          : item
      );

    try {

      await persistSubjects(nextSubjects);

      easeNext();

      setSubjects(nextSubjects);

      showSuccessToast(
        subject.archived
          ? `${subject.name} restored.`
          : `${subject.name} archived. Its data is kept safe.`
      );

    } catch (error) {

      console.log(error);

      setSubjects(previous);

      showErrorToast(
        'Could not update this subject. Please try again.'
      );

    } finally {

      setBusyId(null);
    }
  };

  /* DELETE */

  const requestDelete = (subject) => {

    setConfirmSubject(subject);

    dangerShake.setValue(0);

    Animated.sequence([
      Animated.delay(180),
      Animated.timing(dangerShake, {
        toValue: 1,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(dangerShake, {
        toValue: -1,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(dangerShake, {
        toValue: 0.5,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(dangerShake, {
        toValue: 0,
        duration: 55,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const startDeleteCountdown = (subject) => {

    setConfirmSubject(null);

    easeNext();

    setPendingDelete(subject);

    Animated.spring(undoAnim, {
      toValue: 1,
      friction: 8,
      tension: 70,
      useNativeDriver: true,
    }).start();

    undoTimer.current =
      setTimeout(() => {
        commitDelete(subject);
      }, UNDO_WINDOW);
  };

  const cancelDelete = () => {

    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
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
      setPendingDelete(null);
    });
  };

  /* The cascade removes the children first and only drops the
     subject itself once they are gone. If anything fails the
     subject stays, and the message says exactly what happened
     instead of pretending nothing was touched. */

  const commitDelete = async (subject) => {

    undoTimer.current = null;

    Animated.timing(undoAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();

    if (loadFailed) {
      showErrorToast(
        `Could not delete ${subject.name}. Your subjects failed to load, so it is not safe to save changes yet. Please retry loading first.`
      );
      setPendingDelete(null);
      return;
    }

    setBusyId(subject.id);

    const failures = [];

    try {

      try {

        const subjectTasks =
          await loadSubjectTasks(
            currentUser.id,
            subject.id
          );

        await cancelTaskNotifications(
          subjectTasks.flatMap(
            (task) => task.notificationIds || []
          ),
          currentUser.id
        );

        await deleteSubjectTasks(
          currentUser.id,
          subject.id
        );

      } catch (error) {
        console.log(error);
        failures.push('tasks');
      }

      try {

        await deleteSubjectAttendance(
          currentUser.id,
          subject.id
        );

      } catch (error) {
        console.log(error);
        failures.push('attendance');
      }

      try {

        const schedules =
          Object.values(
            (await loadUserClassSchedules(currentUser.id))[
              subject.id
            ] || {}
          );

        await cancelClassNotifications(
          schedules.flatMap(
            (schedule) => schedule.notificationIds || []
          ),
          currentUser.id
        );

        await deleteSubjectClassSchedules(
          currentUser.id,
          subject.id
        );

      } catch (error) {
        console.log(error);
        failures.push('class schedules');
      }

      if (failures.length > 0) {

        showErrorToast(
          `Could not fully delete ${subject.name}. Its ${failures.join(' and ')} could not be removed, so the subject was kept. Please try again.`
        );

        setPendingDelete(null);

        return;
      }

      /* Read from the ref, not the `subjects` state captured when
         this delete was scheduled - several seconds may have passed
         since then, and anything added or edited in the meantime
         must not be clobbered by writing a stale snapshot. */
      const nextSubjects =
        subjectsRef.current.filter(
          (item) => item.id !== subject.id
        );

      await persistSubjects(nextSubjects);

      easeNext();

      setSubjects(nextSubjects);

      setPendingDelete(null);

      showSuccessToast(
        `${subject.name} and its data were deleted.`
      );

    } catch (error) {

      console.log(error);

      setPendingDelete(null);

      showErrorToast(
        `Could not delete ${subject.name}. Please try again.`
      );

    } finally {

      setBusyId(null);
    }
  };

  /* ---------------------------------------------------------------
     DERIVED
  --------------------------------------------------------------- */

  const enriched =
    useMemo(() =>

      subjects.map((subject) => {

        const tasks =
          Object.values(taskMap[subject.id] || {});

        const pending =
          tasks.filter(
            (task) => task.status === 'Pending'
          ).length;

        const schedules =
          Object.values(scheduleMap[subject.id] || {});

        return {
          ...subject,
          taskTotal: tasks.length,
          taskPending: pending,
          scheduleCount: schedules.length,
          ...getAttendanceStats(
            subject,
            attendanceMap[subject.id]
          ),
        };
      }),

    [subjects, taskMap, attendanceMap, scheduleMap]);

  const normalizedQuery =
    searchQuery.trim().toLowerCase();

  const visibleSubjects =
    useMemo(() => {

      const filtered =
        enriched.filter((item) => {

          if (pendingDelete?.id === item.id) {
            return false;
          }

          if (Boolean(item.archived) !== showArchived) {
            return false;
          }

          const matchesType =
            typeFilter === 'All' ||
            (item.type || 'Theory') === typeFilter;

          const matchesQuery =
            normalizedQuery === '' ||
            item.name
              .toLowerCase()
              .includes(normalizedQuery) ||
            (item.type || 'Theory')
              .toLowerCase()
              .includes(normalizedQuery);

          return matchesType && matchesQuery;
        });

      const sorted = [...filtered];

      if (sortMode === 'name') {
        sorted.sort((a, b) =>
          a.name.localeCompare(b.name)
        );
      } else if (sortMode === 'attendance') {
        sorted.sort(
          (a, b) => a.percentage - b.percentage
        );
      } else if (sortMode === 'pending') {
        sorted.sort(
          (a, b) => b.taskPending - a.taskPending
        );
      } else {
        sorted.sort((a, b) =>
          String(b.createdAt || b.id).localeCompare(
            String(a.createdAt || a.id)
          )
        );
      }

      return sorted;

    }, [
      enriched,
      normalizedQuery,
      typeFilter,
      sortMode,
      showArchived,
      pendingDelete,
    ]);

  const archivedCount =
    useMemo(
      () =>
        enriched.filter(
          (item) => item.archived
        ).length,
      [enriched]
    );

  const activeCount =
    enriched.length - archivedCount;

  /* Counts shown in the delete confirmation, so the cascade is
     never a surprise. */

  const confirmCounts =
    useMemo(() => {

      if (!confirmSubject) {
        return null;
      }

      const item =
        enriched.find(
          (entry) => entry.id === confirmSubject.id
        );

      return {
        tasks: item?.taskTotal || 0,
        absences: item?.absences || 0,
        hasAttendance: Boolean(item?.hasRecord),
        schedules: item?.scheduleCount || 0,
      };

    }, [confirmSubject, enriched]);

  const filterPillWidth =
    filterWidth > 0
      ? (filterWidth - 8) / TYPE_FILTERS.length
      : 0;

  const typePillWidth =
    typeWidth > 0 ? (typeWidth - 8) / 2 : 0;

  const decorative = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
    pointerEvents: 'none',
  };

  const selectTypeFilter = (option, index) => {

    setTypeFilter(option);

    Animated.timing(pillAnim, {
      toValue: index,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    easeNext();
  };

  /* ---------------------------------------------------------------
     RENDER
  --------------------------------------------------------------- */

  const renderSubjectCard = (item, index) => {

    const accent =
      item.color || colors.primary;

    const tone =
      getAttendanceTone(item.percentage, colors);

    const isBusy = busyId === item.id;

    const isHighlighted = highlightId === item.id;

    return (
      <Animated.View
        key={item.id}
        style={{
          opacity: listAnim,
          transform: [
            {
              translateY: listAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [
                  Math.min(14 + index * 4, 34),
                  0,
                ],
              }),
            },
          ],
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${item.type}, ${item.taskPending} pending tasks, ${item.percentage} percent attendance`}
          accessibilityHint="Opens this subject"
          disabled={isBusy}
          style={({ hovered, pressed }) => [
            styles.subjectCard,
            {
              backgroundColor: colors.card,
              borderColor: isHighlighted
                ? accent
                : 'transparent',
            },
            hovered && styles.cardHover,
            pressed && styles.cardPressed,
          ]}
          onPress={() => openSubjectDetails?.(item)}
        >

          <View
            style={[
              styles.cardAccent,
              { backgroundColor: accent },
            ]}
          />

          <View style={styles.cardTop}>

            <View
              style={[
                styles.subjectIconWrap,
                { backgroundColor: `${accent}1F` },
              ]}
            >
              <MaterialIcons
                name={
                  item.type === 'Lab'
                    ? 'science'
                    : 'menu-book'
                }
                size={23}
                color={accent}
              />
            </View>

            <View style={styles.cardIdentity}>
              <Text
                numberOfLines={1}
                style={[
                  styles.subjectName,
                  { color: colors.textDark },
                ]}
              >
                {item.name}
              </Text>

              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.typeBadge,
                    { backgroundColor: `${accent}1A` },
                  ]}
                >
                  <Text
                    style={[
                      styles.typeText,
                      { color: accent },
                    ]}
                  >
                    {item.type}
                  </Text>
                </View>

                {item.scheduleCount > 0 && (
                  <Text
                    style={[
                      styles.metaText,
                      { color: colors.textLight },
                    ]}
                  >
                    {item.scheduleCount} class
                    {item.scheduleCount === 1 ? '' : 'es'}/week
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.cardActions}>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit ${item.name}`}
                hitSlop={6}
                disabled={isBusy}
                onPress={() => openEditForm(item)}
                style={({ hovered, pressed }) => [
                  styles.iconButton,
                  { backgroundColor: colors.background },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name="edit"
                  size={18}
                  color={colors.primary}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  item.archived
                    ? `Restore ${item.name}`
                    : `Archive ${item.name}`
                }
                hitSlop={6}
                disabled={isBusy}
                onPress={() => toggleArchive(item)}
                style={({ hovered, pressed }) => [
                  styles.iconButton,
                  { backgroundColor: colors.background },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
              >
                {isBusy ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                  />
                ) : (
                  <MaterialIcons
                    name={
                      item.archived
                        ? 'unarchive'
                        : 'archive'
                    }
                    size={18}
                    color={colors.textLight}
                  />
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.name}`}
                hitSlop={6}
                disabled={isBusy}
                onPress={() => requestDelete(item)}
                style={({ hovered, pressed }) => [
                  styles.iconButton,
                  styles.deleteButton,
                  hovered && styles.deleteButtonHover,
                  pressed && styles.cardPressed,
                ]}
              >
                <MaterialIcons
                  name="delete-outline"
                  size={19}
                  color={colors.danger}
                />
              </Pressable>

            </View>

          </View>

          <View style={styles.statsRow}>

            <View style={styles.statBlock}>
              <Text
                style={[
                  styles.statValue,
                  {
                    color:
                      item.taskPending > 0
                        ? colors.warning
                        : colors.textDark,
                  },
                ]}
              >
                {item.taskPending}
                <Text
                  style={[
                    styles.statTotal,
                    { color: colors.textLight },
                  ]}
                >
                  /{item.taskTotal}
                </Text>
              </Text>
              <Text
                style={[
                  styles.statCaption,
                  { color: colors.textLight },
                ]}
              >
                pending
              </Text>
            </View>

            <View
              style={[
                styles.statDivider,
                { backgroundColor: colors.border },
              ]}
            />

            <View style={styles.attendanceBlock}>
              <View style={styles.attendanceHeader}>
                <Text
                  style={[
                    styles.statCaption,
                    { color: colors.textLight },
                  ]}
                >
                  attendance
                </Text>
                <Text
                  style={[
                    styles.attendanceValue,
                    { color: tone },
                  ]}
                >
                  {item.percentage}%
                </Text>
              </View>

              <AnimatedBar
                percentage={item.percentage}
                color={tone}
                trackColor={
                  isDarkMode ? colors.surface : '#E5E7EB'
                }
                height={7}
                pulse={
                  item.percentage < ATTENDANCE_THRESHOLD
                }
                style={styles.cardBar}
              />
            </View>

            <MaterialIcons
              name="chevron-right"
              size={24}
              color={colors.primary}
            />

          </View>

        </Pressable>
      </Animated.View>
    );
  };

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

      <View style={styles.container}>

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

          {canGoBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ hovered, pressed }) => [
                styles.backButton,
                { backgroundColor: colors.card },
                hovered && styles.iconButtonHover,
                pressed && styles.cardPressed,
              ]}
              onPress={goBack}
            >
              <MaterialIcons
                name="arrow-back"
                size={24}
                color={colors.primary}
              />
            </Pressable>
          )}

          <View
            style={[
              styles.titleBlock,
              canGoBack && styles.titleBlockOffset,
            ]}
          >
            <Text
              style={[
                styles.heading,
                { color: colors.primary },
              ]}
            >
              Subjects
            </Text>
            <Text
              style={[
                styles.headerSubtitle,
                { color: colors.textLight },
              ]}
            >
              {activeCount} active
              {archivedCount > 0
                ? ` · ${archivedCount} archived`
                : ''}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a new subject"
            style={({ hovered, pressed }) => [
              styles.addButton,
              { backgroundColor: colors.primary },
              hovered && styles.primaryHover,
              pressed && styles.cardPressed,
            ]}
            onPress={openAddForm}
          >
            <MaterialIcons
              name="add"
              size={26}
              color="#FFFFFF"
            />
          </Pressable>

        </Animated.View>

        {/* CONTROLS */}

        {subjects.length > 0 && (

          <Animated.View
            style={[
              styles.controls,
              { opacity: headerAnim },
            ]}
          >

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
                accessibilityLabel="Search subjects"
                placeholder="Search name or type"
                placeholderTextColor={colors.textLight}
                value={searchQuery}
                onChangeText={(value) => {
                  easeNext(160);
                  setSearchQuery(value);
                }}
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

            <View
              onLayout={(event) =>
                setFilterWidth(
                  event.nativeEvent.layout.width
                )
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
                          translateX:
                            pillAnim.interpolate({
                              inputRange: [0, TYPE_FILTERS.length - 1],
                              outputRange: [
                                0,
                                filterPillWidth *
                                  (TYPE_FILTERS.length - 1),
                              ],
                            }),
                        },
                      ],
                    },
                  ]}
                />
              )}

              {TYPE_FILTERS.map((option, index) => (
                <Pressable
                  key={option}
                  accessibilityRole="tab"
                  accessibilityState={{
                    selected: typeFilter === option,
                  }}
                  accessibilityLabel={`Show ${option} subjects`}
                  style={styles.segmentButton}
                  onPress={() =>
                    selectTypeFilter(option, index)
                  }
                >
                  <Text
                    style={[
                      styles.segmentText,
                      {
                        color:
                          typeFilter === option
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

              {archivedCount > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: showArchived }}
                  accessibilityLabel={
                    showArchived
                      ? 'Show active subjects'
                      : `Show ${archivedCount} archived subjects`
                  }
                  onPress={() => {
                    easeNext();
                    setShowArchived((value) => !value);
                  }}
                  style={({ pressed }) => [
                    styles.sortChip,
                    {
                      backgroundColor: showArchived
                        ? `${colors.secondary}1F`
                        : colors.card,
                      borderColor: showArchived
                        ? colors.secondary
                        : 'transparent',
                    },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <MaterialIcons
                    name="archive"
                    size={14}
                    color={
                      showArchived
                        ? colors.secondary
                        : colors.textLight
                    }
                  />
                  <Text
                    style={[
                      styles.sortChipText,
                      {
                        color: showArchived
                          ? colors.secondary
                          : colors.textLight,
                      },
                    ]}
                  >
                    Archived ({archivedCount})
                  </Text>
                </Pressable>
              )}
            </ScrollView>

          </Animated.View>

        )}

        {/* LIST */}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: SCREEN_BOTTOM_PADDING,
          }}
        >

          {isLoading && (
            <SkeletonList count={4} lines={2} />
          )}

          {!isLoading &&
            loadFailed &&
            subjects.length === 0 && (

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
                Could not load your subjects
              </Text>
              <Text
                style={[
                  styles.emptyText,
                  { color: colors.textLight },
                ]}
              >
                Your data may still be there - we just could not
                read it. Adding a subject now would risk losing it,
                so please retry loading first.
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading subjects"
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

          {!isLoading &&
            !loadFailed &&
            subjects.length === 0 && (

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
                  name="menu-book"
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
                No subjects yet
              </Text>
              <Text
                style={[
                  styles.emptyText,
                  { color: colors.textLight },
                ]}
              >
                Add your first subject to start tracking tasks,
                attendance and class schedules.
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
                  accessibilityLabel="Add your first subject"
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
                    Add Subject
                  </Text>
                </Pressable>
              </Animated.View>
            </View>

          )}

          {!isLoading &&
            subjects.length > 0 &&
            visibleSubjects.length === 0 && (

            <View
              style={[
                styles.emptyCard,
                { backgroundColor: colors.card },
              ]}
            >
              <MaterialIcons
                name={
                  showArchived
                    ? 'archive'
                    : 'search-off'
                }
                size={36}
                color={colors.textLight}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.textDark },
                ]}
              >
                {showArchived
                  ? 'No archived subjects'
                  : 'No matches'}
              </Text>
              {!showArchived && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear filters"
                  onPress={() => {
                    easeNext();
                    setSearchQuery('');
                    selectTypeFilter('All', 0);
                  }}
                  style={({ pressed }) => [
                    styles.clearFilterButton,
                    { backgroundColor: colors.surface },
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.clearFilterText,
                      { color: colors.primary },
                    ]}
                  >
                    Clear filters
                  </Text>
                </Pressable>
              )}
            </View>

          )}

          {!isLoading &&
            visibleSubjects.map(renderSubjectCard)}

        </ScrollView>

      </View>

      {/* UNDO BAR */}

      {pendingDelete && (

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
            name="delete-outline"
            size={19}
            color="#FFFFFF"
          />
          <Text
            numberOfLines={2}
            style={styles.undoText}
          >
            Deleting {pendingDelete.name}...
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Undo deleting ${pendingDelete.name}`}
            onPress={cancelDelete}
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

      {/* ADD / EDIT SHEET */}

      <Modal
        visible={formVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeForm}
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
                  {editingId ? 'Edit Subject' : 'Add Subject'}
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
                ref={nameRef}
                placeholder="Subject name"
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
                value={formName}
                onChangeText={(value) => {
                  setFormName(value);
                  if (formError) {
                    setFormError('');
                  }
                }}
                returnKeyType="done"
                onSubmitEditing={handleSaveSubject}
              />

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
                  { backgroundColor: colors.background },
                ]}
              >
                {typePillWidth > 0 && (
                  <Animated.View
                    style={[
                      styles.segmentPill,
                      {
                        width: typePillWidth,
                        backgroundColor: formColor,
                        transform: [
                          {
                            translateX:
                              typePillAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, typePillWidth],
                              }),
                          },
                        ],
                      },
                    ]}
                  />
                )}

                {['Theory', 'Lab'].map((option) => (
                  <Pressable
                    key={option}
                    accessibilityRole="tab"
                    accessibilityState={{
                      selected: formType === option,
                    }}
                    accessibilityLabel={`${option} subject`}
                    style={styles.segmentButton}
                    onPress={() => selectType(option)}
                  >
                    <Text
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

              <Text
                style={[
                  styles.fieldLabel,
                  { color: colors.textDark },
                ]}
              >
                Colour
              </Text>

              <View style={styles.colorRow}>
                {SUBJECT_COLORS.map((swatch) => {

                  const selected = formColor === swatch;

                  return (
                    <Pressable
                      key={swatch}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`Colour ${swatch}`}
                      onPress={() => setFormColor(swatch)}
                      style={({ pressed }) => [
                        styles.swatch,
                        {
                          backgroundColor: swatch,
                          borderColor: selected
                            ? colors.textDark
                            : 'transparent',
                        },
                        pressed && styles.cardPressed,
                      ]}
                    >
                      {selected && (
                        <MaterialIcons
                          name="check"
                          size={16}
                          color="#FFFFFF"
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>

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
                  onPress={closeForm}
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
                    editingId ? 'Save changes' : 'Add subject'
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
                  onPress={handleSaveSubject}
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

      {/* DELETE CONFIRM */}

      <Modal
        visible={Boolean(confirmSubject)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setConfirmSubject(null)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: colors.card },
            ]}
          >

            <Animated.View
              style={[
                styles.confirmIcon,
                {
                  backgroundColor: isDarkMode
                    ? 'rgba(248,113,113,0.16)'
                    : '#FEE2E2',
                  transform: [
                    {
                      translateX: dangerShake.interpolate({
                        inputRange: [-1, 1],
                        outputRange: [-7, 7],
                      }),
                    },
                  ],
                },
              ]}
            >
              <MaterialIcons
                name="warning-amber"
                size={30}
                color={colors.danger}
              />
            </Animated.View>

            <Text
              style={[
                styles.confirmTitle,
                { color: colors.textDark },
              ]}
            >
              Delete {confirmSubject?.name}?
            </Text>

            <Text
              style={[
                styles.confirmMessage,
                { color: colors.textLight },
              ]}
            >
              This permanently removes the subject and everything
              stored with it:
            </Text>

            <View
              style={[
                styles.confirmList,
                { backgroundColor: colors.background },
              ]}
            >
              <View style={styles.confirmRow}>
                <MaterialIcons
                  name="assignment"
                  size={17}
                  color={colors.danger}
                />
                <Text
                  style={[
                    styles.confirmRowText,
                    { color: colors.textDark },
                  ]}
                >
                  {confirmCounts?.tasks || 0} task
                  {confirmCounts?.tasks === 1 ? '' : 's'}
                </Text>
              </View>

              <View style={styles.confirmRow}>
                <MaterialIcons
                  name="fact-check"
                  size={17}
                  color={colors.danger}
                />
                <Text
                  style={[
                    styles.confirmRowText,
                    { color: colors.textDark },
                  ]}
                >
                  {confirmCounts?.hasAttendance
                    ? `Attendance record (${confirmCounts.absences} absence${confirmCounts.absences === 1 ? '' : 's'})`
                    : 'No attendance record'}
                </Text>
              </View>

              <View style={styles.confirmRow}>
                <MaterialIcons
                  name="school"
                  size={17}
                  color={colors.danger}
                />
                <Text
                  style={[
                    styles.confirmRowText,
                    { color: colors.textDark },
                  ]}
                >
                  {confirmCounts?.schedules || 0} class schedule
                  {confirmCounts?.schedules === 1 ? '' : 's'} and reminders
                </Text>
              </View>
            </View>

            <Text
              style={[
                styles.confirmHint,
                { color: colors.textLight },
              ]}
            >
              Want to keep the data? Archive it instead.
            </Text>

            <View style={styles.confirmActions}>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ hovered, pressed }) => [
                  styles.cancelButton,
                  { backgroundColor: colors.background },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setConfirmSubject(null)}
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
                accessibilityLabel={`Archive ${confirmSubject?.name} instead`}
                style={({ hovered, pressed }) => [
                  styles.archiveButton,
                  { backgroundColor: `${colors.secondary}22` },
                  hovered && styles.iconButtonHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => {
                  const target = confirmSubject;
                  setConfirmSubject(null);
                  toggleArchive(target);
                }}
              >
                <Text
                  style={[
                    styles.archiveText,
                    { color: colors.secondary },
                  ]}
                >
                  Archive
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${confirmSubject?.name} permanently`}
                style={({ hovered, pressed }) => [
                  styles.deleteConfirmButton,
                  { backgroundColor: colors.danger },
                  hovered && styles.primaryHover,
                  pressed && styles.cardPressed,
                ]}
                onPress={() =>
                  startDeleteCountdown(confirmSubject)
                }
              >
                <Text style={styles.deleteConfirmText}>
                  Delete
                </Text>
              </Pressable>

            </View>

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

  /* HEADER */

  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 104,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 16,
  },

  headerWaveOne: {
    position: 'absolute',
    left: -44,
    right: -52,
    top: 34,
    height: 68,
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
    bottom: -22,
    height: 78,
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
    right: '32%',
    top: 20,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: 'rgba(196,181,253,0.78)',
    transform: [{ rotate: '45deg' }],
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  titleBlock: {
    flex: 1,
    zIndex: 3,
  },

  titleBlockOffset: {
    marginLeft: 14,
  },

  heading: {
    fontSize: 28,
    fontWeight: 'bold',
  },

  headerSubtitle: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  addButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  /* CONTROLS */

  controls: {
    marginBottom: 14,
    gap: 10,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
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
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 11,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  segmentText: {
    fontSize: 13,
    fontWeight: 'bold',
  },

  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },

  sortLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
    marginRight: 2,
  },

  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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

  /* CARD */

  subjectCard: {
    position: 'relative',
    borderRadius: CARD_RADIUS,
    borderWidth: 1.5,
    padding: 14,
    paddingLeft: 18,
    marginBottom: 12,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },

  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  subjectIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },

  cardIdentity: {
    flex: 1,
  },

  subjectName: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 5,
  },

  typeBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
  },

  typeText: {
    fontSize: 10,
    fontWeight: 'bold',
  },

  metaText: {
    fontSize: 10,
    fontWeight: '700',
  },

  cardActions: {
    flexDirection: 'row',
    gap: 6,
  },

  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  deleteButton: {
    backgroundColor: 'rgba(239,68,68,0.10)',
  },

  deleteButtonHover: {
    backgroundColor: 'rgba(239,68,68,0.20)',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
  },

  statBlock: {
    minWidth: 52,
  },

  statValue: {
    fontSize: 19,
    fontWeight: 'bold',
  },

  statTotal: {
    fontSize: 13,
    fontWeight: '700',
  },

  statCaption: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: '700',
  },

  statDivider: {
    width: 1,
    height: 30,
    opacity: 0.6,
  },

  attendanceBlock: {
    flex: 1,
  },

  attendanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  attendanceValue: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  cardBar: {
    marginTop: 6,
  },

  /* EMPTY */

  emptyCard: {
    alignItems: 'center',
    padding: 30,
    borderRadius: CARD_RADIUS,
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

  clearFilterButton: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  clearFilterText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  /* UNDO */

  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: SCREEN_BOTTOM_PADDING - 60,
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

  /* MODALS */

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },

  modalScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 28,
  },

  sheet: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderRadius: CARD_RADIUS,
    padding: 22,
    ...SHADOW,
  },

  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
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

  fieldError: {
    marginTop: 8,
    marginLeft: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
    lineHeight: 17,
  },

  fieldLabel: {
    marginTop: 18,
    marginBottom: 9,
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  swatch: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  sheetActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 24,
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

  /* CONFIRM */

  confirmCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    borderRadius: CARD_RADIUS,
    padding: 24,
    alignItems: 'center',
    ...SHADOW,
  },

  confirmIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },

  confirmTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  confirmMessage: {
    marginTop: 9,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },

  confirmList: {
    width: '100%',
    marginTop: 16,
    padding: 14,
    borderRadius: 13,
    gap: 10,
  },

  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  confirmRowText: {
    flex: 1,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  confirmHint: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
    textAlign: 'center',
  },

  confirmActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
    width: '100%',
  },

  archiveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  archiveText: {
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  deleteConfirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  deleteConfirmText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  /* INTERACTION */

  cardHover: {
    transform: [{ translateY: -3 }],
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
