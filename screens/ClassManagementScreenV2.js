import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import DateTimePicker from '@react-native-community/datetimepicker';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useResponsive } from '../constants/layout';
import {
  loadUserAttendance,
  loadUserClassSchedules,
  loadUserSubjects,
} from '../utils/localData';

import { DATA_DOMAINS, onDataChanged } from '../utils/dataEvents';
import { getAttendanceStats } from '../utils/attendance';
import {
  findScheduleConflicts,
  normalizeRoom,
  persistScheduleReminders,
} from '../utils/schedules';

const DAYS = [
  { label: 'Mon', name: 'Monday', weekday: 2 },
  { label: 'Tue', name: 'Tuesday', weekday: 3 },
  { label: 'Wed', name: 'Wednesday', weekday: 4 },
  { label: 'Thu', name: 'Thursday', weekday: 5 },
  { label: 'Fri', name: 'Friday', weekday: 6 },
  { label: 'Sat', name: 'Saturday', weekday: 7 },
  { label: 'Sun', name: 'Sunday', weekday: 1 },
];

const DURATIONS = [60, 90, 180];
const REMINDERS = [0, 5, 10, 15];

const formatTime = (hours, minutes) => {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
};

const parseTime = (value) => {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (minutes > 59 || hours > (period ? 12 : 23) || hours < 0 || (period && hours === 0)) return null;
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
};

const dayName = (weekday) => DAYS.find((day) => day.weekday === weekday)?.name || '';

const dateForSchedule = (schedule) => {
  const now = new Date();
  const next = new Date(now);
  let offset = schedule.weekday - (now.getDay() + 1);
  next.setHours(schedule.hours, schedule.minutes, 0, 0);
  if (offset < 0 || (offset === 0 && next <= now)) offset += 7;
  next.setDate(next.getDate() + offset);
  return next;
};

const formatNext = (schedule) => {
  const next = dateForSchedule(schedule);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const prefix = next.toDateString() === today.toDateString()
    ? 'Today'
    : next.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : dayName(schedule.weekday);
  return `${prefix}, ${formatTime(schedule.hours, schedule.minutes)}`;
};

const sortSchedules = (schedules) => [...schedules].sort(
  (a, b) => a.weekday - b.weekday || a.hours - b.hours || a.minutes - b.minutes
);

function MotionCard({ index = 0, reduceMotion, children, style }) {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 12)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, delay: Math.min(index * 45, 220), useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay: Math.min(index * 45, 220), friction: 9, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, reduceMotion, translateY]);

  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

function Skeletons({ colors }) {
  return (
    <View style={styles.listGap} accessibilityLabel="Loading timetable">
      {[0, 1, 2].map((item) => <View key={item} style={[styles.skeleton, { backgroundColor: colors.card }]} />)}
    </View>
  );
}

export default function ClassManagementScreenV2({
  goBack,
  canGoBack,
  currentUser,
  navigateTo,
}) {
  const { colors, isDarkMode } = useTheme();
  const { showError: showErrorToast, showSuccess: showSuccessToast } = useToast();
  const { isCompactWidth, screenPadding, maxContentWidth } = useResponsive();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [scheduleMap, setScheduleMap] = useState({});
  const [attendanceMap, setAttendanceMap] = useState({});
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [selectedDays, setSelectedDays] = useState([]);
  const [timeText, setTimeText] = useState(formatTime(new Date().getHours(), new Date().getMinutes()));
  const [room, setRoom] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customDurationText, setCustomDurationText] = useState('60');
  const [reminderMinutes, setReminderMinutes] = useState(5);
  const [editingId, setEditingId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [undo, setUndo] = useState(null);
  const undoProgress = useRef(new Animated.Value(0)).current;
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslate = useRef(new Animated.Value(reduceMotion ? 0 : -12)).current;

  const haptic = (type = 'light') => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(type === 'success' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  };

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => subscription?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      headerOpacity.setValue(1);
      headerTranslate.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.spring(headerTranslate, { toValue: 0, friction: 9, useNativeDriver: true }),
    ]).start();
  }, [headerOpacity, headerTranslate, reduceMotion]);

  const loadData = async ({ silent = false } = {}) => {
    if (!currentUser?.id) {
      setIsLoading(false);
      return;
    }
    if (!silent) {
      setIsLoading(true);
    }
    setLoadError(false);
    try {
      const [nextSubjects, nextSchedules, nextAttendance] = await Promise.all([
        loadUserSubjects(currentUser.id),
        loadUserClassSchedules(currentUser.id),
        loadUserAttendance(currentUser.id),
      ]);
      setSubjects(nextSubjects || []);
      setScheduleMap(nextSchedules || {});
      setAttendanceMap(nextAttendance || {});
    } catch (error) {
      console.log(error);
      setLoadError(true);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await loadData();
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, [currentUser?.id]);

  useEffect(() => {
    const relevantDomains = [
      DATA_DOMAINS.SUBJECTS,
      DATA_DOMAINS.CLASS_SCHEDULES,
      DATA_DOMAINS.ATTENDANCE,
    ];
    const unsubscribe = onDataChanged(({ domain }) => {
      if (!relevantDomains.includes(domain)) return;
      loadData({ silent: true });
    });
    return unsubscribe;
  }, [currentUser?.id]);

  useEffect(() => {
    if (!undo) return undefined;
    undoProgress.setValue(0);
    if (!reduceMotion) {
      Animated.timing(undoProgress, { toValue: 1, duration: 7000, useNativeDriver: false }).start();
    }
    const timer = setTimeout(() => setUndo(null), 7000);
    return () => clearTimeout(timer);
  }, [reduceMotion, undo, undoProgress]);

  const selectedSchedules = useMemo(() => selectedSubject
    ? sortSchedules(Object.values(scheduleMap[selectedSubject.id] || {})) : [], [scheduleMap, selectedSubject]);

  const activeSchedules = selectedSchedules.filter((schedule) => schedule.isActive !== false);
  const archivedSchedules = selectedSchedules.filter((schedule) => schedule.isActive === false);
  const allActiveSchedules = useMemo(() => subjects.flatMap((subject) =>
    Object.values(scheduleMap[subject.id] || {}).filter((schedule) => schedule.isActive !== false).map((schedule) => ({ ...schedule, subject }))
  ), [scheduleMap, subjects]);

  const resetForm = () => {
    setSelectedDays([]);
    setTimeText(formatTime(new Date().getHours(), new Date().getMinutes()));
    setRoom('');
    setDurationMinutes(60);
    setIsCustomDuration(false);
    setCustomDurationText('60');
    setReminderMinutes(5);
    setEditingId(null);
    setConflicts([]);
    setMessage('');
  };

  const openSubject = (subject) => { setSelectedSubject(subject); resetForm(); };
  const closeSubject = () => { setSelectedSubject(null); resetForm(); };
  const toggleDay = (weekday) => {
    setConflicts([]);
    setSelectedDays((current) => current.includes(weekday)
      ? current.filter((day) => day !== weekday) : [...current, weekday]);
  };

  const makeCandidate = (weekday, id, resolvedDuration) => {
    const time = parseTime(timeText);
    return {
      id: id || `${Date.now()}_${weekday}_${Math.random().toString(36).slice(2, 7)}`,
      subjectId: selectedSubject.id,
      weekday,
      dayName: dayName(weekday),
      hours: time.hours,
      minutes: time.minutes,
      timeLabel: formatTime(time.hours, time.minutes),
      room: room.trim().replace(/\s+/g, ' '),
      durationMinutes: resolvedDuration,
      reminderMinutes,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
  };

  const saveSchedule = async (force = false) => {
    if (isSaving || !selectedSubject) return;
    const time = parseTime(timeText);
    if (!time) { setMessage('Time format: 8:30 AM or 20:30.'); return; }
    if (!selectedDays.length) { setMessage('Select at least one weekly day.'); return; }
    if (editingId && selectedDays.length !== 1) { setMessage('Editing keeps one weekly day.'); return; }
    const resolvedDuration = isCustomDuration
      ? Number(customDurationText)
      : durationMinutes;
    if (!Number.isInteger(resolvedDuration) || resolvedDuration < 5 || resolvedDuration > 720) {
      setMessage('Enter a custom duration between 5 and 720 minutes.');
      return;
    }

    const existing = activeSchedules;
    const daysToAdd = editingId ? selectedDays : selectedDays.filter((weekday) => !existing.some((item) =>
      item.weekday === weekday && item.hours === time.hours && item.minutes === time.minutes &&
      normalizeRoom(item.room) === normalizeRoom(room)
    ));

    if (!daysToAdd.length) { setMessage('That class slot already exists.'); return; }
    const candidates = daysToAdd.map((weekday) => makeCandidate(weekday, editingId || undefined, resolvedDuration));
    const nextConflicts = findScheduleConflicts({
      scheduleMap,
      subjects,
      candidates,
      ignoreIds: editingId ? [editingId] : [],
    });

    if (nextConflicts.length && !force) {
      setConflicts(nextConflicts);
      setMessage('This overlaps with an existing class. Review it or save anyway.');
      haptic();
      return;
    }

    const currentSchedules = selectedSchedules;
    const nextSchedules = editingId
      ? currentSchedules.map((item) => item.id === editingId ? { ...candidates[0], createdAt: item.createdAt, notificationIds: item.notificationIds || [] } : item)
      : [...currentSchedules, ...candidates];

    setIsSaving(true);
    try {
      const attendancePercentage = getAttendanceStats(selectedSubject, attendanceMap[selectedSubject.id]).percentage;
      const result = await persistScheduleReminders({
        userId: currentUser.id,
        subject: selectedSubject,
        schedules: nextSchedules,
        attendancePercentage,
      });
      setScheduleMap((current) => ({ ...current, [selectedSubject.id]: result.schedules }));
      const skipped = selectedDays.length - daysToAdd.length;
      resetForm();
      haptic('success');
      if (result.reminderSyncFailed) {
        showErrorToast('Timetable saved. Reminder sync needs a retry.');
        setMessage('Schedule saved. The reminder needs refresh.');
      } else {
        const summary = editingId ? 'Class updated.' : `${daysToAdd.length} class${daysToAdd.length > 1 ? 'es' : ''} saved${skipped ? `; ${skipped} duplicate skipped` : ''}.`;
        setMessage(summary);
        showSuccessToast(summary);
      }
    } catch (error) {
      console.log(error);
      showErrorToast('Timetable was not saved. Check connection and retry.');
    } finally { setIsSaving(false); }
  };

  const editSchedule = (schedule) => {
    setEditingId(schedule.id);
    setSelectedDays([schedule.weekday]);
    setTimeText(formatTime(schedule.hours, schedule.minutes));
    setRoom(schedule.room || '');
    const savedDuration = schedule.durationMinutes || 60;
    setDurationMinutes(savedDuration);
    setIsCustomDuration(!DURATIONS.includes(savedDuration));
    setCustomDurationText(String(savedDuration));
    setReminderMinutes(schedule.reminderMinutes ?? 5);
    setConflicts([]);
    setMessage('Editing one recurring class.');
  };

  const archiveSchedule = async (schedule) => {
    if (isSaving) return;
    setIsSaving(true);
    const nextSchedules = selectedSchedules.map((item) => item.id === schedule.id ? {
      ...item, isActive: false, archivedAt: new Date().toISOString(), reminderSyncPending: true,
    } : item);
    try {
      const result = await persistScheduleReminders({
        userId: currentUser.id, subject: selectedSubject, schedules: nextSchedules,
        attendancePercentage: getAttendanceStats(selectedSubject, attendanceMap[selectedSubject.id]).percentage,
      });
      setScheduleMap((current) => ({ ...current, [selectedSubject.id]: result.schedules }));
      setUndo({ subjectId: selectedSubject.id, schedule });
      setMessage('Future classes removed. Past attendance remains saved.');
      if (result.reminderSyncFailed) showErrorToast('Schedule archived; reminder cleanup needs retry.');
      haptic();
    } catch (error) { showErrorToast('Could not remove this future class.'); }
    finally { setIsSaving(false); }
  };

  const restoreSchedule = async (schedule = undo?.schedule) => {
    if (!schedule || isSaving) return;
    setIsSaving(true);
    const scheduleList = Object.values(scheduleMap[selectedSubject.id] || {}).map((item) => item.id === schedule.id ? {
      ...item, isActive: true, archivedAt: null,
    } : item);
    try {
      const result = await persistScheduleReminders({
        userId: currentUser.id, subject: selectedSubject, schedules: scheduleList,
        attendancePercentage: getAttendanceStats(selectedSubject, attendanceMap[selectedSubject.id]).percentage,
      });
      setScheduleMap((current) => ({ ...current, [selectedSubject.id]: result.schedules }));
      setUndo(null);
      setMessage('Class restored.');
      haptic('success');
    } catch (error) { showErrorToast('Could not restore this class.'); }
    finally { setIsSaving(false); }
  };

  const retryReminders = async () => {
    if (!selectedSubject || isSaving) return;
    setIsSaving(true);
    try {
      const result = await persistScheduleReminders({
        userId: currentUser.id, subject: selectedSubject, schedules: selectedSchedules,
        attendancePercentage: getAttendanceStats(selectedSubject, attendanceMap[selectedSubject.id]).percentage,
      });
      setScheduleMap((current) => ({ ...current, [selectedSubject.id]: result.schedules }));
      result.reminderSyncFailed ? showErrorToast('Reminder sync could not finish. Try later.') : showSuccessToast('Reminders refreshed.');
    } catch (error) { showErrorToast('Reminder sync could not start.'); }
    finally { setIsSaving(false); }
  };

  const preview = (() => {
    const time = parseTime(timeText);
    if (!time || !selectedDays[0]) return null;
    const schedule = { weekday: selectedDays[0], hours: time.hours, minutes: time.minutes };
    const next = dateForSchedule(schedule);
    const reminder = new Date(next.getTime() - reminderMinutes * 60000);
    return { next, reminder };
  })();

  const pendingReminderCount = selectedSchedules.filter((item) => item.reminderSyncPending).length;
  const background = colors.background;

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <StatusBar backgroundColor={background} barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
        contentContainerStyle={[styles.scrollContent, { paddingHorizontal: screenPadding, paddingBottom: 118 }]}
      >
        <View style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
          <Animated.View style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border, opacity: headerOpacity, transform: [{ translateY: headerTranslate }] }]}>
            <View style={[styles.headerIcon, { backgroundColor: colors.softInfo }]}><MaterialIcons name="calendar-month" size={25} color={colors.primary} /></View>
            <View style={styles.headerText}>
              <Text selectable style={[styles.title, { color: colors.textDark }]}>{selectedSubject ? selectedSubject.name : 'Class timetable'}</Text>
              <Text selectable style={[styles.subtitle, { color: colors.textLight }]}>{selectedSubject ? 'Recurring classes, reminders & conflicts' : 'Plan each weekly class with confidence'}</Text>
            </View>
            {(selectedSubject || canGoBack) && <Pressable accessibilityRole="button" accessibilityLabel={selectedSubject ? 'Back to all subjects' : 'Go back'} onPress={selectedSubject ? closeSubject : goBack} style={({ pressed }) => [styles.iconButton, { backgroundColor: colors.surface, opacity: pressed ? 0.7 : 1 }]}><MaterialIcons name="arrow-back" size={22} color={colors.primary} /></Pressable>}
          </Animated.View>

          {isLoading && !subjects.length ? <Skeletons colors={colors} /> : !selectedSubject ? (
            <Overview
              colors={colors}
              subjects={subjects}
              scheduleMap={scheduleMap}
              attendanceMap={attendanceMap}
              reduceMotion={reduceMotion}
              allActiveSchedules={allActiveSchedules}
              onOpen={openSubject}
              onAddSubject={() => navigateTo?.('Subjects')}
              loadError={loadError}
              onRetry={loadData}
            />
          ) : (
            <Detail
              colors={colors}
              isDarkMode={isDarkMode}
              isCompactWidth={isCompactWidth}
              subject={selectedSubject}
              activeSchedules={activeSchedules}
              archivedSchedules={archivedSchedules}
              selectedDays={selectedDays}
              timeText={timeText}
              room={room}
              durationMinutes={durationMinutes}
              isCustomDuration={isCustomDuration}
              customDurationText={customDurationText}
              reminderMinutes={reminderMinutes}
              showPicker={showPicker}
              preview={preview}
              conflicts={conflicts}
              message={message}
              isSaving={isSaving}
              pendingReminderCount={pendingReminderCount}
              showArchived={showArchived}
              reduceMotion={reduceMotion}
              onToggleDay={toggleDay}
              onTimeChange={(value) => { setTimeText(value); setConflicts([]); }}
              onRoomChange={(value) => { setRoom(value); setConflicts([]); }}
              onDuration={(value) => { setDurationMinutes(value); setIsCustomDuration(false); setConflicts([]); }}
              onCustomDuration={() => { setIsCustomDuration(true); setCustomDurationText(String(durationMinutes)); setConflicts([]); }}
              onCustomDurationChange={(value) => { setCustomDurationText(value.replace(/[^0-9]/g, '')); setConflicts([]); }}
              onReminder={(value) => { setReminderMinutes(value); setConflicts([]); }}
              onShowPicker={setShowPicker}
              onPickerChange={(event, value) => { setShowPicker(Platform.OS === 'ios'); if (value) { setTimeText(formatTime(value.getHours(), value.getMinutes())); setConflicts([]); } }}
              onSave={() => saveSchedule(conflicts.length > 0)}
              onEdit={editSchedule}
              onArchive={archiveSchedule}
              onRestore={restoreSchedule}
              onRetryReminders={retryReminders}
              onToggleArchived={() => setShowArchived((value) => !value)}
              onCancelEdit={resetForm}
              editing={Boolean(editingId)}
            />
          )}
        </View>
      </ScrollView>
      {undo && selectedSubject?.id === undo.subjectId && <View style={[styles.undoBar, { backgroundColor: colors.textDark }]} accessibilityLiveRegion="polite">
        <View style={styles.undoTextWrap}><Text style={styles.undoText}>Future class removed</Text><Text style={styles.undoSubtext}>Past attendance is kept</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Undo remove class" onPress={() => restoreSchedule()}><Text style={[styles.undoAction, { color: colors.secondary }]}>UNDO</Text></Pressable>
        {!reduceMotion && <Animated.View style={[styles.undoProgress, { backgroundColor: colors.secondary, width: undoProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />}
      </View>}
    </View>
  );
}

function Overview({ colors, subjects, scheduleMap, attendanceMap, reduceMotion, allActiveSchedules, onOpen, onAddSubject, loadError, onRetry }) {
  return <View style={styles.listGap}>
    <View style={styles.sectionHeading}><View><Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>This week</Text><Text selectable style={[styles.sectionSub, { color: colors.textLight }]}>A visual view of your active timetable</Text></View><View style={[styles.countPill, { backgroundColor: colors.surface }]}><Text style={[styles.countPillText, { color: colors.primary }]}>{allActiveSchedules.length} classes</Text></View></View>
    <WeeklyTimeline colors={colors} schedules={allActiveSchedules} />
    <View style={styles.sectionHeading}><View><Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>Subjects</Text><Text selectable style={[styles.sectionSub, { color: colors.textLight }]}>Open a subject to manage recurring classes</Text></View></View>
    {loadError && <View style={[styles.retryCard, { backgroundColor: colors.softDanger }]}><MaterialIcons name="cloud-off" size={20} color={colors.danger} /><View style={styles.flex}><Text selectable style={[styles.retryText, { color: colors.textDark }]}>Could not refresh timetable</Text><Text selectable style={[styles.muted, { color: colors.textLight }]}>Showing the last available information.</Text></View><Pressable onPress={onRetry}><Text style={[styles.link, { color: colors.primary }]}>Retry</Text></Pressable></View>}
    {!subjects.length ? <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}><MaterialIcons name="menu-book" size={35} color={colors.primary} /><Text selectable style={[styles.emptyTitle, { color: colors.textDark }]}>Add a subject first</Text><Text selectable style={[styles.emptyText, { color: colors.textLight }]}>Subjects provide the attendance and reminder context for each class.</Text><Pressable onPress={onAddSubject} style={[styles.primaryButton, { backgroundColor: colors.primary }]}><Text style={styles.primaryText}>Add subject</Text></Pressable></View> : subjects.map((subject, index) => {
      const schedules = sortSchedules(Object.values(scheduleMap[subject.id] || {}).filter((item) => item.isActive !== false));
      const next = schedules.map((item) => ({ ...item, nextDate: dateForSchedule(item) })).sort((a, b) => a.nextDate - b.nextDate)[0];
      const stats = getAttendanceStats(subject, attendanceMap[subject.id]);
      const pending = schedules.some((item) => item.reminderSyncPending);
      return <MotionCard key={subject.id} index={index} reduceMotion={reduceMotion} style={[styles.subjectCard, { backgroundColor: colors.card, borderColor: colors.border }]}><Pressable accessibilityRole="button" accessibilityLabel={`${subject.name}, ${schedules.length} weekly classes`} accessibilityHint="Opens class schedule management" onPress={() => onOpen(subject)} style={({ pressed }) => [styles.cardPress, pressed && styles.pressed]}><View style={[styles.subjectIcon, { backgroundColor: colors.softInfo }]}><MaterialIcons name={subject.type === 'Lab' ? 'science' : 'school'} size={22} color={colors.primary} /></View><View style={styles.flex}><View style={styles.cardTitleRow}><Text selectable numberOfLines={1} style={[styles.cardTitle, { color: colors.textDark }]}>{subject.name}</Text><MaterialIcons name="chevron-right" size={23} color={colors.textLight} /></View><Text selectable style={[styles.muted, { color: colors.textLight }]}>{schedules.length ? `${schedules.map((item) => DAYS.find((day) => day.weekday === item.weekday)?.label).join(' · ')} · ${schedules.length} weekly` : 'No weekly classes yet'}</Text>{next && <Text selectable style={[styles.nextLine, { color: colors.textDark }]}>Next: {formatNext(next)}{next.room ? ` · ${next.room}` : ''}</Text>}<View style={styles.metaRow}><Text selectable style={[styles.tinyStatus, { color: stats.percentage < 80 ? colors.danger : colors.success }]}>{stats.percentage}% attendance</Text><Text selectable style={[styles.tinyStatus, { color: pending ? colors.warning : colors.secondary }]}>{pending ? 'Reminder needs refresh' : 'Reminder status ready'}</Text></View></View></Pressable></MotionCard>;
    })}
  </View>;
}

function WeeklyTimeline({ colors, schedules }) {
  return <View style={[styles.timeline, { backgroundColor: colors.card, borderColor: colors.border }]}>{DAYS.slice(0, 5).map((day) => {
    const classes = schedules.filter((item) => item.weekday === day.weekday).sort((a, b) => a.hours - b.hours || a.minutes - b.minutes);
    return <View key={day.weekday} style={[styles.dayColumn, { borderColor: colors.border }]}><Text selectable style={[styles.dayLabel, { color: colors.textLight }]}>{day.label}</Text>{classes.length ? classes.slice(0, 3).map((item) => <View key={`${item.subject.id}_${item.id}`} style={[styles.timeBlock, { backgroundColor: colors.softInfo }]}><Text numberOfLines={1} selectable style={[styles.timeBlockTitle, { color: colors.primary }]}>{item.subject.name}</Text><Text selectable style={[styles.timeBlockTime, { color: colors.textLight }]}>{formatTime(item.hours, item.minutes)}</Text></View>) : <Text selectable style={[styles.noClass, { color: colors.textLight }]}>—</Text>}</View>;
  })}</View>;
}

function Detail(props) {
  const { colors, subject, activeSchedules, archivedSchedules, selectedDays, timeText, room, durationMinutes, isCustomDuration, customDurationText, reminderMinutes, showPicker, preview, conflicts, message, isSaving, pendingReminderCount, showArchived, reduceMotion, onToggleDay, onTimeChange, onRoomChange, onDuration, onCustomDuration, onCustomDurationChange, onReminder, onShowPicker, onPickerChange, onSave, onEdit, onArchive, onRestore, onRetryReminders, onToggleArchived, onCancelEdit, editing } = props;
  return <View style={styles.listGap}>
    {pendingReminderCount > 0 && <View style={[styles.syncBanner, { backgroundColor: colors.softWarning }]}><MaterialIcons name="notifications-active" size={20} color={colors.warning} /><View style={styles.flex}><Text selectable style={[styles.syncTitle, { color: colors.textDark }]}>Reminder sync needs attention</Text><Text selectable style={[styles.muted, { color: colors.textLight }]}>{pendingReminderCount} schedule{pendingReminderCount > 1 ? 's' : ''} saved, but reminder refresh is pending.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Retry reminder sync" onPress={onRetryReminders}><Text style={[styles.link, { color: colors.primary }]}>Retry</Text></Pressable></View>}
    <View style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.formHeading}><View><Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>{editing ? 'Edit recurring class' : 'Add weekly class'}</Text><Text selectable style={[styles.sectionSub, { color: colors.textLight }]}>{editing ? 'Updates this one weekly slot.' : 'Select every day this class repeats.'}</Text></View>{editing && <Pressable onPress={onCancelEdit}><Text style={[styles.link, { color: colors.primary }]}>Cancel</Text></Pressable>}</View>
      <Text selectable style={[styles.fieldLabel, { color: colors.textDark }]}>Weekly days</Text>
      <View style={styles.dayChips}>{DAYS.map((day) => <Pressable key={day.weekday} accessibilityRole="checkbox" accessibilityState={{ checked: selectedDays.includes(day.weekday), disabled: editing && !selectedDays.includes(day.weekday) }} accessibilityLabel={day.name} onPress={() => onToggleDay(day.weekday)} disabled={editing && !selectedDays.includes(day.weekday)} style={[styles.dayChip, { borderColor: selectedDays.includes(day.weekday) ? colors.primary : colors.border, backgroundColor: selectedDays.includes(day.weekday) ? colors.primary : colors.surface, opacity: editing && !selectedDays.includes(day.weekday) ? 0.42 : 1 }]}><Text style={[styles.dayChipText, { color: selectedDays.includes(day.weekday) ? '#fff' : colors.textDark }]}>{day.label}</Text></Pressable>)}</View>
      <View style={styles.fieldRow}><View style={styles.flex}><Text selectable style={[styles.fieldLabel, { color: colors.textDark }]}>Start time</Text><TextInput accessibilityLabel="Class start time" value={timeText} onChangeText={onTimeChange} placeholder="8:30 AM" placeholderTextColor={colors.textLight} style={[styles.input, { color: colors.textDark, backgroundColor: colors.surface, borderColor: colors.border }]} /></View><Pressable accessibilityRole="button" accessibilityLabel="Open time picker" onPress={() => onShowPicker(true)} style={[styles.pickerButton, { backgroundColor: colors.softInfo }]}><MaterialIcons name="schedule" size={22} color={colors.primary} /></Pressable></View>
      {showPicker && <DateTimePicker value={(() => { const parsed = parseTime(timeText) || { hours: 9, minutes: 0 }; const date = new Date(); date.setHours(parsed.hours, parsed.minutes, 0, 0); return date; })()} mode="time" display="default" onChange={onPickerChange} />}
      <Text selectable style={[styles.fieldLabel, { color: colors.textDark }]}>Room / online link (optional)</Text><TextInput accessibilityLabel="Classroom or online link" value={room} onChangeText={onRoomChange} placeholder="e.g. LT-5 or Zoom" placeholderTextColor={colors.textLight} style={[styles.input, { color: colors.textDark, backgroundColor: colors.surface, borderColor: colors.border }]} />
      <DurationSelector colors={colors} selected={durationMinutes} isCustom={isCustomDuration} customValue={customDurationText} onSelect={onDuration} onCustom={onCustomDuration} onCustomChange={onCustomDurationChange} />
      <Selector label="Reminder" values={REMINDERS} selected={reminderMinutes} onSelect={onReminder} colors={colors} suffix=" min" offValue={0} />
      {preview && <View style={[styles.preview, { backgroundColor: colors.softInfo }]}><MaterialIcons name="event-available" size={20} color={colors.primary} /><View style={styles.flex}><Text selectable style={[styles.previewTitle, { color: colors.textDark }]}>Next class: {preview.next.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} · {preview.next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text><Text selectable style={[styles.muted, { color: colors.textLight }]}>{reminderMinutes ? `Reminder: ${preview.reminder.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (${reminderMinutes} min before)` : 'Reminder is off for this class.'}</Text></View></View>}
      {conflicts.length > 0 && <View style={[styles.conflictBox, { backgroundColor: colors.softDanger, borderColor: colors.danger }]}><MaterialIcons name="warning-amber" size={21} color={colors.danger} /><View style={styles.flex}><Text selectable style={[styles.conflictTitle, { color: colors.textDark }]}>Timetable conflict</Text>{conflicts.slice(0, 2).map((conflict) => <Text key={`${conflict.candidateId}_${conflict.scheduleId}`} selectable style={[styles.muted, { color: colors.textLight }]}>{conflict.subjectName} · {dayName(conflict.existing.weekday)} {formatTime(conflict.existing.hours, conflict.existing.minutes)}{conflict.type === 'room' ? ' · same room' : ''}</Text>)}</View></View>}
      {message ? <Text selectable accessibilityLiveRegion="polite" style={[styles.message, { color: conflicts.length ? colors.danger : colors.textLight }]}>{message}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ busy: isSaving }} accessibilityLabel={conflicts.length ? 'Save class despite conflict' : editing ? 'Save class changes' : 'Add class schedule'} disabled={isSaving} onPress={onSave} style={[styles.primaryButton, { backgroundColor: conflicts.length ? colors.warning : colors.primary, opacity: isSaving ? 0.65 : 1 }]}>{isSaving ? <ActivityIndicator color="#fff" /> : <><MaterialIcons name={conflicts.length ? 'priority-high' : editing ? 'save' : 'add'} size={20} color="#fff" /><Text style={styles.primaryText}>{conflicts.length ? 'Save anyway' : editing ? 'Save changes' : 'Add class schedule'}</Text></>}</Pressable>
    </View>
    <View style={styles.sectionHeading}><View><Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>Active classes</Text><Text selectable style={[styles.sectionSub, { color: colors.textLight }]}>Remove future classes without losing past attendance.</Text></View></View>
    {!activeSchedules.length ? <View style={[styles.smallEmpty, { backgroundColor: colors.card, borderColor: colors.border }]}><Text selectable style={{ color: colors.textLight }}>No active weekly classes for {subject.name}.</Text></View> : activeSchedules.map((schedule, index) => <ScheduleCard key={schedule.id} schedule={schedule} colors={colors} index={index} reduceMotion={reduceMotion} onEdit={onEdit} onArchive={onArchive} />)}
    {archivedSchedules.length > 0 && <><Pressable accessibilityRole="button" accessibilityState={{ expanded: showArchived }} onPress={onToggleArchived} style={[styles.archivedToggle, { backgroundColor: colors.surface }]}><Text style={[styles.archivedText, { color: colors.textDark }]}>{showArchived ? 'Hide' : 'Show'} archived schedules ({archivedSchedules.length})</Text><MaterialIcons name={showArchived ? 'expand-less' : 'expand-more'} size={20} color={colors.textLight} /></Pressable>{showArchived && archivedSchedules.map((schedule) => <View key={schedule.id} style={[styles.archivedCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.flex}><Text selectable style={[styles.cardTitle, { color: colors.textDark }]}>{dayName(schedule.weekday)} · {formatTime(schedule.hours, schedule.minutes)}</Text><Text selectable style={[styles.muted, { color: colors.textLight }]}>Archived — past attendance stays linked.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Restore future class" onPress={() => onRestore(schedule)}><Text style={[styles.link, { color: colors.primary }]}>Restore</Text></Pressable></View>)}</>}
  </View>;
}

function Selector({ label, values, selected, onSelect, colors, suffix, offValue }) { return <><Text selectable style={[styles.fieldLabel, { color: colors.textDark }]}>{label}</Text><View style={styles.selectorRow}>{values.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: selected === value }} onPress={() => onSelect(value)} style={[styles.selector, { backgroundColor: selected === value ? colors.primary : colors.surface, borderColor: selected === value ? colors.primary : colors.border }]}><Text style={{ color: selected === value ? '#fff' : colors.textDark, fontWeight: '700' }}>{value === offValue ? 'Off' : `${value}${suffix}`}</Text></Pressable>)}</View></>; }

function DurationSelector({ colors, selected, isCustom, customValue, onSelect, onCustom, onCustomChange }) { return <><Text selectable style={[styles.fieldLabel, { color: colors.textDark }]}>Class duration</Text><View style={styles.selectorRow}>{DURATIONS.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: !isCustom && selected === value }} onPress={() => onSelect(value)} style={[styles.selector, { backgroundColor: !isCustom && selected === value ? colors.primary : colors.surface, borderColor: !isCustom && selected === value ? colors.primary : colors.border }]}><Text style={{ color: !isCustom && selected === value ? '#fff' : colors.textDark, fontWeight: '700' }}>{value} min</Text></Pressable>)}<Pressable accessibilityRole="radio" accessibilityState={{ selected: isCustom }} accessibilityLabel="Custom class duration" onPress={onCustom} style={[styles.selector, { backgroundColor: isCustom ? colors.primary : colors.surface, borderColor: isCustom ? colors.primary : colors.border }]}><Text style={{ color: isCustom ? '#fff' : colors.textDark, fontWeight: '700' }}>Custom</Text></Pressable></View>{isCustom && <TextInput accessibilityLabel="Custom duration in minutes" keyboardType="number-pad" value={customValue} onChangeText={onCustomChange} placeholder="Minutes" placeholderTextColor={colors.textLight} style={[styles.input, { color: colors.textDark, backgroundColor: colors.surface, borderColor: colors.border }]} />}</>; }

function ScheduleCard({ schedule, colors, index, reduceMotion, onEdit, onArchive }) { return <MotionCard index={index} reduceMotion={reduceMotion} style={[styles.scheduleCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.timeBadge, { backgroundColor: colors.softInfo }]}><Text selectable style={[styles.timeBadgeText, { color: colors.primary }]}>{formatTime(schedule.hours, schedule.minutes)}</Text><Text selectable style={[styles.timeBadgeSub, { color: colors.textLight }]}>{schedule.durationMinutes || 60} min</Text></View><View style={styles.flex}><View style={styles.cardTitleRow}><Text selectable style={[styles.cardTitle, { color: colors.textDark }]}>{dayName(schedule.weekday)}</Text>{schedule.reminderSyncPending ? <MaterialIcons name="notifications-active" size={18} color={colors.warning} /> : schedule.reminderMinutes === 0 ? <MaterialIcons name="notifications-off" size={18} color={colors.textLight} /> : <MaterialIcons name="notifications" size={18} color={colors.secondary} />}</View><Text selectable style={[styles.muted, { color: colors.textLight }]}>{schedule.room || 'Room not specified'} · {schedule.reminderMinutes === 0 ? 'No reminder' : `${schedule.reminderMinutes ?? 5} min reminder`}</Text></View><View style={styles.actionRow}><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${dayName(schedule.weekday)} class`} onPress={() => onEdit(schedule)} style={[styles.smallButton, { backgroundColor: colors.surface }]}><MaterialIcons name="edit" size={18} color={colors.primary} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Remove future ${dayName(schedule.weekday)} class`} onPress={() => onArchive(schedule)} style={[styles.smallButton, { backgroundColor: colors.softDanger }]}><MaterialIcons name="delete-outline" size={19} color={colors.danger} /></Pressable></View></MotionCard>; }

const styles = StyleSheet.create({
  root: { flex: 1 }, scrollContent: { paddingTop: 16 }, header: { minHeight: 92, borderWidth: 1, borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, headerIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, headerText: { flex: 1 }, title: { fontSize: 24, fontWeight: '800' }, subtitle: { marginTop: 3, fontSize: 13 }, iconButton: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }, listGap: { gap: 12, marginTop: 18 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { fontSize: 19, fontWeight: '800' }, sectionSub: { marginTop: 2, fontSize: 13 }, countPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }, countPillText: { fontSize: 12, fontWeight: '800' }, timeline: { borderWidth: 1, borderRadius: 18, padding: 10, flexDirection: 'row', minHeight: 142 }, dayColumn: { flex: 1, paddingHorizontal: 4, borderRightWidth: 1, gap: 6 }, dayLabel: { textAlign: 'center', fontWeight: '800', fontSize: 12 }, timeBlock: { borderRadius: 8, padding: 5 }, timeBlockTitle: { fontSize: 10, fontWeight: '800' }, timeBlockTime: { fontSize: 10, marginTop: 2 }, noClass: { textAlign: 'center', paddingTop: 17 }, subjectCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' }, cardPress: { padding: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, pressed: { opacity: 0.72 }, subjectIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1 }, cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, cardTitle: { fontSize: 16, fontWeight: '800' }, muted: { fontSize: 12, marginTop: 3 }, nextLine: { fontSize: 13, fontWeight: '700', marginTop: 8 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 7 }, tinyStatus: { fontSize: 11, fontWeight: '800' }, emptyCard: { alignItems: 'center', padding: 25, borderWidth: 1, borderRadius: 18, gap: 8 }, emptyTitle: { fontSize: 18, fontWeight: '800' }, emptyText: { textAlign: 'center', fontSize: 13, lineHeight: 19 }, primaryButton: { minHeight: 47, paddingHorizontal: 16, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '800' }, retryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14 }, retryText: { fontSize: 13, fontWeight: '800' }, link: { fontSize: 13, fontWeight: '800', padding: 5 }, skeleton: { height: 108, borderRadius: 18, opacity: 0.65 }, syncBanner: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, gap: 9, borderRadius: 15 }, syncTitle: { fontSize: 13, fontWeight: '800' }, formCard: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 9 }, formHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }, fieldLabel: { fontSize: 13, fontWeight: '800', marginTop: 4 }, dayChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, dayChip: { minWidth: 47, paddingVertical: 10, paddingHorizontal: 8, borderWidth: 1, borderRadius: 11, alignItems: 'center' }, dayChipText: { fontSize: 12, fontWeight: '800' }, fieldRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' }, input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 }, pickerButton: { width: 46, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }, selectorRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' }, selector: { minWidth: 57, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' }, preview: { flexDirection: 'row', padding: 11, gap: 8, borderRadius: 13, marginTop: 2 }, previewTitle: { fontSize: 12, fontWeight: '800', lineHeight: 18 }, conflictBox: { flexDirection: 'row', gap: 9, padding: 11, borderWidth: 1, borderRadius: 13 }, conflictTitle: { fontSize: 13, fontWeight: '800' }, message: { fontSize: 13, lineHeight: 18 }, smallEmpty: { padding: 16, borderWidth: 1, borderRadius: 14 }, scheduleCard: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, timeBadge: { width: 72, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }, timeBadgeText: { fontSize: 12, fontWeight: '800', textAlign: 'center' }, timeBadgeSub: { fontSize: 10, marginTop: 3 }, actionRow: { gap: 6 }, smallButton: { width: 34, height: 32, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, archivedToggle: { padding: 13, borderRadius: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, archivedText: { fontSize: 13, fontWeight: '800' }, archivedCard: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, undoBar: { position: 'absolute', left: 16, right: 16, bottom: 24, minHeight: 64, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' }, undoTextWrap: { flex: 1 }, undoText: { color: '#fff', fontWeight: '800', fontSize: 13 }, undoSubtext: { color: '#D0D5DD', fontSize: 11, marginTop: 2 }, undoAction: { fontSize: 13, fontWeight: '900', padding: 8 }, undoProgress: { position: 'absolute', left: 0, bottom: 0, height: 3 },
});
