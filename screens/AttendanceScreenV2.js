import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';

import { MaterialIcons } from '@expo/vector-icons';

import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import {
  Calendar,
} from 'react-native-calendars';

import {
  CARD_RADIUS,
  HEADER_TOP_PADDING,
  MAX_CONTENT_WIDTH,
  SCREEN_BOTTOM_PADDING,
  SCREEN_PADDING,
  SHADOW,
  TYPOGRAPHY,
} from '../constants/layout';

import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { SkeletonList } from '../components/Skeleton';
import { AnimatedBar, CountUp, ProgressRing } from '../components/AnimatedStats';

import {
  loadUserAttendance,
  loadUserClassSchedules,
  loadUserSubjects,
} from '../utils/localData';

import { DATA_DOMAINS, onDataChanged } from '../utils/dataEvents';

import { sendAttendanceAlertNotification } from '../utils/notifications';

import {
  ATTENDANCE_THRESHOLD,
  buildClassAttendanceRecord,
  getAttendanceDateKey,
  getAttendanceStats,
  getAttendanceTone,
  getClassAttendanceRecord,
  getSchedulesForDate,
  persistAttendance as persistAttendanceWithReminders,
} from '../utils/attendance';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const RECORD_PAGE_SIZE = 12;
const FILTERS = ['All', 'At risk', 'Today', 'Unmarked', 'Labs'];

const animateLayout = () =>
  LayoutAnimation.configureNext(
    LayoutAnimation.create(
      220,
      LayoutAnimation.Types.easeInEaseOut,
      LayoutAnimation.Properties.opacity
    )
  );

const formatTime = (schedule) =>
  schedule.timeLabel ||
  new Date(2000, 0, 1, schedule.hours || 0, schedule.minutes || 0)
    .toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });

const getRecordText = (record) => {
  const time = record.timeLabel ? ` · ${record.timeLabel}` : '';
  const room = record.room ? ` · Room ${record.room}` : '';
  const date = record.dateLabel ||
    new Date(record.createdAt).toLocaleDateString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
    });

  return `${record.dayLabel || ''}${record.dayLabel ? ', ' : ''}${date}${time}${room}`;
};

const getForecast = (stats) => {
  const presentClassesNeeded = Math.max(
    0,
    Math.ceil(5 * stats.absences - stats.totalClasses)
  );
  const afterOneMore = Math.round(
    Math.max(0, ((stats.totalClasses - stats.absences - 1) /
      stats.totalClasses) * 100) * 10
  ) / 10;

  return { presentClassesNeeded, afterOneMore };
};

const buildManualRecord = (type, absences) => {
  const now = new Date();

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    source: 'manual',
    absences,
    dateLabel: now.toLocaleDateString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
    }),
    dayLabel: now.toLocaleDateString(undefined, { weekday: 'long' }),
    timeLabel: now.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit',
    }),
    createdAt: now.toISOString(),
  };
};

export default function AttendanceScreen({
  goBack,
  canGoBack,
  currentUser,
  navigateTo,
}) {
  const { colors, isDarkMode } = useTheme();
  const { showError: showErrorToast, showSuccess: showSuccessToast } = useToast();

  const [subjects, setSubjects] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [classScheduleMap, setClassScheduleMap] = useState({});
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [totalClassesDraft, setTotalClassesDraft] = useState('30');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [processingKey, setProcessingKey] = useState('');
  const [editingRecord, setEditingRecord] = useState(null);
  const [visibleRecordCount, setVisibleRecordCount] = useState(RECORD_PAGE_SIZE);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [notice, setNotice] = useState('');
  const [undoItem, setUndoItem] = useState(null);

  const signatureRef = useRef('');
  const requestIdRef = useRef(0);
  const headerAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;
  const feedbackAnim = useRef(new Animated.Value(0)).current;
  const undoTimerRef = useRef(null);

  const loadAttendanceData = useCallback(async ({ silent = false } = {}) => {
    if (!currentUser?.id) {
      setIsInitialLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;

    try {
      const [nextSubjects, nextAttendance, nextSchedules] = await Promise.all([
        loadUserSubjects(currentUser.id),
        loadUserAttendance(currentUser.id),
        loadUserClassSchedules(currentUser.id),
      ]);

      if (requestId !== requestIdRef.current) {
        return;
      }

      const signature = JSON.stringify({ nextSubjects, nextAttendance, nextSchedules });
      setHasLoadError(false);

      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        animateLayout();
        setSubjects(nextSubjects || []);
        setAttendanceMap(nextAttendance || {});
        setClassScheduleMap(nextSchedules || {});
      }
    } catch (error) {
      console.log(error);
      if (requestId === requestIdRef.current) {
        setHasLoadError(true);
        if (!silent) {
          showErrorToast('Could not load attendance data. Pull down to retry.');
        }
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setIsInitialLoading(false);
      }
    }
  }, [currentUser, showErrorToast]);

  useEffect(() => {
    loadAttendanceData();
  }, [loadAttendanceData]);

  useEffect(() => {
    const relevantDomains = [
      DATA_DOMAINS.SUBJECTS,
      DATA_DOMAINS.ATTENDANCE,
      DATA_DOMAINS.CLASS_SCHEDULES,
    ];
    const unsubscribe = onDataChanged(({ domain }) => {
      if (!relevantDomains.includes(domain)) {
        return;
      }
      loadAttendanceData({ silent: true });
    });
    return unsubscribe;
  }, [loadAttendanceData]);

  useEffect(() => () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
    }
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged', setReduceMotion
    );
    return () => subscription?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      headerAnim.setValue(1);
      return;
    }
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [headerAnim, reduceMotion]);

  const getSubjectAttendance = useCallback((subject) =>
    attendanceMap[subject.id] || {
      subjectId: subject.id,
      totalClasses: 30,
      absences: 0,
      records: [],
      alertsSent: {},
    }, [attendanceMap]);

  const applyPersistedAttendance = async (subject, nextAttendance) => {
    const result = await persistAttendanceWithReminders({
      userId: currentUser.id,
      subject,
      nextAttendance,
      classScheduleMap,
    });

    signatureRef.current = '';
    setAttendanceMap((current) => ({
      ...current,
      [subject.id]: result.attendance,
    }));

    if (result.schedules) {
      setClassScheduleMap((current) => ({
        ...current,
        [subject.id]: result.schedules,
      }));
    }

    if (result.reminderRefreshFailed) {
      setNotice('Attendance saved. Class reminders need a refresh.');
    }

    return result.attendance;
  };

  const playSuccessFeedback = () => {
    feedbackAnim.setValue(0);
    if (reduceMotion) {
      feedbackAnim.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.spring(feedbackAnim, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.timing(feedbackAnim, {
        toValue: 0,
        duration: 800,
        delay: 600,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const maybeSendRiskAlert = async (subject, before, after) => {
    const alertsSent = after.alertsSent || {};
    const crossings = [
      { key: 'below_80', threshold: 80, label: 'warning' },
      { key: 'below_75', threshold: 75, label: 'critical' },
    ].filter(({ key, threshold }) =>
      before.percentage >= threshold &&
      after.percentage < threshold &&
      !alertsSent[key]
    );

    if (crossings.length === 0) {
      return after;
    }

    const nextAttendance = {
      ...after,
      alertsSent: {
        ...alertsSent,
        ...Object.fromEntries(crossings.map(({ key }) => [key, true])),
      },
    };

    const saved = await applyPersistedAttendance(subject, nextAttendance);
    const mostSevere = crossings[crossings.length - 1];

    sendAttendanceAlertNotification(
      currentUser.id,
      subject.name,
      saved.absences,
      getAttendanceStats(subject, saved).percentage,
      mostSevere.label
    ).catch(() => {});

    return saved;
  };

  const saveClassStatus = async (schedule, status, record = null) => {
    if (!selectedSubject || processingKey) {
      return;
    }

    const key = `class_${schedule.id}`;
    setProcessingKey(key);

    try {
      const current = getSubjectAttendance(selectedSubject);
      const beforeStats = getAttendanceStats(selectedSubject, current);
      const existing = record || getClassAttendanceRecord(current, schedule.id);
      const absenceDelta =
        (status === 'Absent' ? 1 : 0) -
        (existing?.type === 'Absent' ? 1 : 0);
      const nextAbsences = Math.min(
        Math.max(beforeStats.absences + absenceDelta, 0),
        beforeStats.totalClasses
      );
      const nextRecord = buildClassAttendanceRecord({
        subjectId: selectedSubject.id,
        schedule,
        status,
        absences: nextAbsences,
        previousRecord: existing,
      });
      const nextAttendance = {
        ...current,
        absences: nextAbsences,
        records: existing
          ? (current.records || []).map((item) =>
              item.id === existing.id ? nextRecord : item
            )
          : [nextRecord, ...(current.records || [])],
        alertsSent: current.alertsSent || {},
      };

      const saved = await applyPersistedAttendance(selectedSubject, nextAttendance);
      const finalAttendance = await maybeSendRiskAlert(
        selectedSubject,
        beforeStats,
        saved
      );

      setAttendanceMap((currentMap) => ({
        ...currentMap,
        [selectedSubject.id]: finalAttendance,
      }));
      Haptics.notificationAsync(
        getAttendanceStats(selectedSubject, finalAttendance).percentage <
          ATTENDANCE_THRESHOLD
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success
      ).catch(() => {});
      setEditingRecord(null);
      setNotice(existing
        ? `Updated to ${status}.`
        : `${status} saved for ${formatTime(schedule)}.`);
      playSuccessFeedback();
      animateLayout();
    } catch (error) {
      console.log(error);
      showErrorToast('Attendance could not be saved. Nothing was changed locally.');
    } finally {
      setProcessingKey('');
    }
  };

  const removeClassRecord = async (record) => {
    if (!selectedSubject || processingKey) {
      return;
    }

    setProcessingKey(`remove_${record.id}`);

    try {
      const current = getSubjectAttendance(selectedSubject);
      const stats = getAttendanceStats(selectedSubject, current);
      const nextAttendance = {
        ...current,
        absences: Math.max(
          0,
          stats.absences - (record.type === 'Absent' ? 1 : 0)
        ),
        records: (current.records || []).filter((item) => item.id !== record.id),
      };
      await applyPersistedAttendance(selectedSubject, nextAttendance);
      setEditingRecord(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      setUndoItem({
        subject: selectedSubject,
        previousAttendance: current,
      });
      undoTimerRef.current = setTimeout(() => {
        setUndoItem(null);
        undoTimerRef.current = null;
      }, 7000);
      setNotice('Class mark removed. Undo is available for 7 seconds.');
      animateLayout();
    } catch (error) {
      console.log(error);
      showErrorToast('Could not remove this class mark.');
    } finally {
      setProcessingKey('');
    }
  };

  const undoRemoval = async () => {
    if (!undoItem || processingKey) {
      return;
    }

    setProcessingKey('undo_remove');
    try {
      await applyPersistedAttendance(
        undoItem.subject,
        undoItem.previousAttendance
      );
      setNotice('Class mark restored.');
      setUndoItem(null);
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      animateLayout();
    } catch (error) {
      console.log(error);
      showErrorToast('Could not restore the class mark.');
    } finally {
      setProcessingKey('');
    }
  };

  const adjustManualAbsences = async (change) => {
    if (!selectedSubject || processingKey) {
      return;
    }

    const current = getSubjectAttendance(selectedSubject);
    const stats = getAttendanceStats(selectedSubject, current);
    const nextAbsences = Math.min(
      Math.max(stats.absences + change, 0),
      stats.totalClasses
    );

    if (nextAbsences === stats.absences) {
      return;
    }

    setProcessingKey(change > 0 ? 'manual_add' : 'manual_remove');
    try {
      await applyPersistedAttendance(selectedSubject, {
        ...current,
        absences: nextAbsences,
        records: [
          buildManualRecord(
            change > 0 ? 'Manual absence added' : 'Manual absence removed',
            nextAbsences
          ),
          ...(current.records || []),
        ],
      });
      setNotice('Manual correction saved.');
      animateLayout();
    } catch (error) {
      console.log(error);
      showErrorToast('Could not save the manual correction.');
    } finally {
      setProcessingKey('');
    }
  };

  const saveTotalClasses = async () => {
    if (!selectedSubject || processingKey) {
      return;
    }

    const totalClasses = Number(totalClassesDraft);
    if (!Number.isInteger(totalClasses) || totalClasses < 1 || totalClasses > 500) {
      showErrorToast('Enter a whole number from 1 to 500.');
      return;
    }

    setProcessingKey('settings');
    try {
      const current = getSubjectAttendance(selectedSubject);
      const nextAttendance = {
        ...current,
        totalClasses,
        absences: Math.min(Number(current.absences) || 0, totalClasses),
      };
      await applyPersistedAttendance(selectedSubject, nextAttendance);
      setNotice('Total planned classes updated. Historical record totals are preserved.');
    } catch (error) {
      console.log(error);
      showErrorToast('Could not save attendance settings.');
    } finally {
      setProcessingKey('');
    }
  };

  const exportCsv = async () => {
    if (!selectedSubject) {
      return;
    }

    const records = getSubjectAttendance(selectedSubject).records || [];
    const escape = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
    const csv = [
      ['Subject', 'Status', 'Date', 'Time', 'Room', 'Source', 'Total absences'],
      ...records.map((record) => [
        selectedSubject.name,
        record.type,
        record.dateLabel,
        record.timeLabel,
        record.room,
        record.source || 'legacy',
        record.absences,
      ]),
    ].map((row) => row.map(escape).join(',')).join('\n');

    try {
      await Share.share({
        title: `${selectedSubject.name} attendance CSV`,
        message: csv,
      });
    } catch (error) {
      console.log(error);
      showErrorToast('Could not prepare the attendance export.');
    }
  };

  const exportPdf = async () => {
    if (!selectedSubject) {
      return;
    }

    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const rows = (selectedAttendance.records || [])
      .map((record) => `<tr><td>${escapeHtml(record.type)}</td><td>${escapeHtml(record.dateLabel)}</td><td>${escapeHtml(record.timeLabel)}</td><td>${escapeHtml(record.room || '—')}</td><td>${escapeHtml(record.source || 'legacy')}</td><td>${escapeHtml(record.absences)}</td></tr>`)
      .join('');
    const html = `<html><head><style>body{font-family:Arial;padding:28px;color:#172033}h1{color:#5B5FEF}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:9px;border-bottom:1px solid #e5e7eb;text-align:left;font-size:12px}th{background:#f0edff}</style></head><body><h1>${escapeHtml(selectedSubject.name)} — Attendance</h1><p>${selectedStats.percentage}% attendance · ${selectedStats.absences} absences · ${selectedStats.totalClasses} planned classes</p><table><thead><tr><th>Status</th><th>Date</th><th>Time</th><th>Room</th><th>Source</th><th>Total absences</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No records yet.</td></tr>'}</tbody></table></body></html>`;

    try {
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
        return;
      }

      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `${selectedSubject.name} attendance report`,
          UTI: 'com.adobe.pdf',
        });
      } else {
        showSuccessToast('Attendance PDF created.');
      }
    } catch (error) {
      console.log(error);
      showErrorToast('Could not create the attendance PDF.');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    signatureRef.current = '';
    await loadAttendanceData({ silent: true });
    setIsRefreshing(false);
  };

  const openSubject = (subject) => {
    const attendance = getSubjectAttendance(subject);
    setSelectedSubject(subject);
    setTotalClassesDraft(String(attendance.totalClasses || 30));
    setVisibleRecordCount(RECORD_PAGE_SIZE);
    setNotice('');
    detailAnim.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(detailAnim, {
        toValue: 1,
        duration: 330,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  };

  const visibleSubjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const todayKey = getAttendanceDateKey();

    return subjects.filter((subject) => {
      const attendance = getSubjectAttendance(subject);
      const stats = getAttendanceStats(subject, attendance);
      const todaySchedules = getSchedulesForDate(classScheduleMap, subject.id);
      const hasTodayMark = todaySchedules.some((schedule) =>
        getClassAttendanceRecord(attendance, schedule.id, todayKey)
      );
      const queryMatch = !query ||
        subject.name.toLowerCase().includes(query) ||
        subject.type.toLowerCase().includes(query);
      const filterMatch = activeFilter === 'All' ||
        (activeFilter === 'At risk' && stats.percentage < ATTENDANCE_THRESHOLD) ||
        (activeFilter === 'Today' && todaySchedules.length > 0) ||
        (activeFilter === 'Unmarked' && todaySchedules.length > 0 && !hasTodayMark) ||
        (activeFilter === 'Labs' && subject.type === 'Lab');

      return queryMatch && filterMatch;
    });
  }, [activeFilter, classScheduleMap, getSubjectAttendance, searchQuery, subjects]);

  const selectedAttendance = selectedSubject
    ? getSubjectAttendance(selectedSubject)
    : null;
  const selectedStats = selectedAttendance
    ? getAttendanceStats(selectedSubject, selectedAttendance)
    : null;
  const selectedTone = selectedStats
    ? getAttendanceTone(selectedStats.percentage, colors)
    : colors.success;
  const todaySchedules = selectedSubject
    ? getSchedulesForDate(classScheduleMap, selectedSubject.id)
    : [];
  const forecast = selectedStats ? getForecast(selectedStats) : null;
  const shownRecords = (selectedAttendance?.records || []).slice(0, visibleRecordCount);
  const markedDates = useMemo(() => {
    const values = {};
    (selectedAttendance?.records || []).forEach((record) => {
      const key = record.classDateKey || getAttendanceDateKey(record.createdAt);
      if (!key || record.source === 'manual') {
        return;
      }
      values[key] = {
        marked: true,
        dotColor: record.type === 'Present' ? colors.success : colors.danger,
        selectedColor: record.type === 'Present' ? colors.success : colors.danger,
      };
    });
    return values;
  }, [colors.danger, colors.success, selectedAttendance]);

  const headerStyle = {
    opacity: headerAnim,
    transform: [{
      translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }),
    }],
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar backgroundColor={colors.background} barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Animated.View style={headerStyle}>
          <View style={[styles.header, { backgroundColor: isDarkMode ? colors.card : '#EEE9FF', borderColor: colors.border }]}>
            <View style={[styles.headerWave, isDarkMode && styles.headerWaveDark]} />
            {(canGoBack || selectedSubject) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={() => selectedSubject ? setSelectedSubject(null) : goBack?.()}
                style={({ pressed }) => [styles.backButton, { backgroundColor: colors.card }, pressed && styles.pressed]}
              >
                <MaterialIcons name="arrow-back" size={23} color={colors.primary} />
              </Pressable>
            )}
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.primary }]}>Attendance</Text>
              <Text style={[styles.subtitle, { color: colors.textLight }]}>Class-linked attendance, always in sync</Text>
            </View>
            <View style={[styles.heroIcon, { backgroundColor: colors.card }]}>
              <MaterialIcons name="fact-check" size={27} color={colors.primary} />
            </View>
          </View>
        </Animated.View>

        {!selectedSubject ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          >
            {isInitialLoading ? <SkeletonList count={4} /> : subjects.length === 0 ? (
              <EmptyState
                error={hasLoadError}
                colors={colors}
                onRetry={loadAttendanceData}
                onAdd={() => navigateTo?.('Subjects')}
              />
            ) : (
              <>
                <View style={[styles.search, { backgroundColor: colors.card }]}>
                  <MaterialIcons name="search" size={20} color={colors.textLight} />
                  <TextInput
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    accessibilityLabel="Search attendance subjects"
                    placeholder="Search subject or type"
                    placeholderTextColor={colors.textLight}
                    style={[styles.searchInput, { color: colors.textDark }]}
                  />
                  {searchQuery ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearchQuery('')}><MaterialIcons name="close" size={19} color={colors.textLight} /></Pressable> : null}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                  {FILTERS.map((filter) => (
                    <Pressable
                      key={filter}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activeFilter === filter }}
                      onPress={() => { animateLayout(); setActiveFilter(filter); }}
                      style={({ pressed }) => [styles.filterChip, { backgroundColor: activeFilter === filter ? colors.primary : colors.card }, pressed && styles.pressed]}
                    >
                      <Text style={[styles.filterText, { color: activeFilter === filter ? '#FFFFFF' : colors.textLight }]}>{filter}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {visibleSubjects.length === 0 ? <Text style={[styles.noResult, { color: colors.textLight }]}>No subjects match this filter.</Text> : visibleSubjects.map((subject, index) => (
                  <SubjectCard
                    key={subject.id}
                    subject={subject}
                    attendance={getSubjectAttendance(subject)}
                    schedules={getSchedulesForDate(classScheduleMap, subject.id)}
                    colors={colors}
                    isDarkMode={isDarkMode}
                    index={index}
                    reduceMotion={reduceMotion}
                    onPress={() => openSubject(subject)}
                  />
                ))}
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} colors={[colors.primary]} tintColor={colors.primary} />}
          >
            <Animated.View style={{ opacity: detailAnim, transform: [{ translateY: detailAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
              <View style={[styles.heroCard, { backgroundColor: colors.card }]}>
                <View style={styles.subjectHeroCopy}>
                  <Text style={[styles.detailTitle, { color: colors.textDark }]}>{selectedSubject.name}</Text>
                  <Text style={[styles.detailMeta, { color: colors.textLight }]}>{selectedSubject.type} · {selectedStats.absences} of {selectedStats.totalClasses} classes missed</Text>
                  <Text style={[styles.safeText, { color: selectedTone }]}>{selectedStats.remainingAbsences > 0 ? `${selectedStats.remainingAbsences} safe absences remaining` : 'No more safe absences remaining'}</Text>
                </View>
                <View style={styles.ringWrap}><ProgressRing percentage={selectedStats.percentage} size={102} thickness={9} color={selectedTone} trackColor={colors.surface} reduceMotion={reduceMotion}>
                  <CountUp value={selectedStats.percentage} suffix="%" reduceMotion={reduceMotion} style={[styles.ringText, { color: selectedTone }]} />
                </ProgressRing></View>
                <AnimatedBar percentage={selectedStats.percentage} color={selectedTone} trackColor={colors.surface} reduceMotion={reduceMotion} style={styles.heroBar} />
              </View>

              {selectedAttendance.remindersNeedRefresh ? (
                <Pressable accessibilityRole="button" onPress={() => applyPersistedAttendance(selectedSubject, selectedAttendance)} style={[styles.reminderWarning, { backgroundColor: colors.softWarning || colors.surface }]}>
                  <MaterialIcons name="notifications-active" size={18} color={colors.warning} />
                  <Text style={[styles.reminderWarningText, { color: colors.textDark }]}>Refresh class reminders</Text>
                </Pressable>
              ) : null}

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: colors.textDark }]}>Today’s classes</Text><Text style={[styles.sectionCaption, { color: colors.textLight }]}>{todaySchedules.length} scheduled</Text></View>
                {todaySchedules.length === 0 ? <Text style={[styles.helper, { color: colors.textLight }]}>No class is scheduled for this subject today. Use manual correction only when your timetable needs fixing.</Text> : todaySchedules.map((schedule) => {
                  const record = getClassAttendanceRecord(selectedAttendance, schedule.id);
                  const busy = processingKey === `class_${schedule.id}`;
                  return <View key={schedule.id} style={[styles.classRow, { borderColor: colors.border }]}>
                    <View style={[styles.timeBox, { backgroundColor: colors.surface }]}><Text style={[styles.timeText, { color: colors.primary }]}>{formatTime(schedule)}</Text></View>
                    <View style={styles.classCopy}><Text style={[styles.roomText, { color: colors.textDark }]}>Room {schedule.room || '—'}</Text><Text style={[styles.classStatus, { color: colors.textLight }]}>{record ? `${record.type} marked` : 'Not marked yet'}</Text></View>
                    {busy ? <ActivityIndicator color={colors.primary} /> : record ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${record.type} mark`} onPress={() => setEditingRecord({ record, schedule })} style={[styles.statusChip, { backgroundColor: record.type === 'Present' ? colors.softSuccess : colors.softDanger }]}><MaterialIcons name="edit" size={15} color={record.type === 'Present' ? colors.success : colors.danger} /><Text style={{ color: record.type === 'Present' ? colors.success : colors.danger, fontWeight: '800', fontSize: 12 }}>{record.type} · Edit</Text></Pressable> : <View style={styles.classActions}><Pressable accessibilityRole="button" accessibilityLabel="Mark present" onPress={() => saveClassStatus(schedule, 'Present')} style={[styles.iconAction, { backgroundColor: colors.softSuccess }]}><MaterialIcons name="check" size={20} color={colors.success} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Mark absent" onPress={() => saveClassStatus(schedule, 'Absent')} style={[styles.iconAction, { backgroundColor: colors.softDanger }]}><MaterialIcons name="close" size={20} color={colors.danger} /></Pressable></View>}
                  </View>;
                })}
              </View>

              <Animated.View pointerEvents="none" style={[styles.successBurst, { opacity: feedbackAnim, transform: [{ scale: feedbackAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}><MaterialIcons name="check-circle" size={42} color={colors.success} /></Animated.View>

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.textDark }]}>Attendance forecast</Text>
                <Text style={[styles.forecastText, { color: colors.textDark }]}>{forecast.presentClassesNeeded > 0 ? `Attend the next ${forecast.presentClassesNeeded} class${forecast.presentClassesNeeded === 1 ? '' : 'es'} to return to ${ATTENDANCE_THRESHOLD}%.` : 'You are currently in the safe attendance zone.'}</Text>
                <Text style={[styles.forecastHint, { color: colors.textLight }]}>One more absence would put you at {forecast.afterOneMore}%.</Text>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: colors.textDark }]}>Attendance calendar</Text><Text style={[styles.sectionCaption, { color: colors.textLight }]}>Green: present · Red: absent</Text></View>
                <Calendar markedDates={markedDates} markingType="dot" theme={{ calendarBackground: colors.card, dayTextColor: colors.textDark, monthTextColor: colors.textDark, textDisabledColor: colors.textLight, arrowColor: colors.primary, todayTextColor: colors.primary }} />
              </View>

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <View style={styles.sectionHeading}><Text style={[styles.sectionTitle, { color: colors.textDark }]}>Recent records</Text><View style={styles.exportActions}><Pressable accessibilityRole="button" accessibilityLabel="Export attendance as CSV" onPress={exportCsv} style={[styles.exportButton, { backgroundColor: colors.surface }]}><MaterialIcons name="table-chart" size={16} color={colors.primary} /><Text style={[styles.exportText, { color: colors.primary }]}>CSV</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Export attendance as PDF" onPress={exportPdf} style={[styles.exportButton, { backgroundColor: colors.surface }]}><MaterialIcons name="picture-as-pdf" size={16} color={colors.primary} /><Text style={[styles.exportText, { color: colors.primary }]}>PDF</Text></Pressable></View></View>
                {shownRecords.length === 0 ? <Text style={[styles.helper, { color: colors.textLight }]}>No class marks yet.</Text> : shownRecords.map((record) => <Pressable key={record.id} disabled={!record.scheduleId} accessibilityRole={record.scheduleId ? 'button' : undefined} accessibilityLabel={record.scheduleId ? `Edit ${record.type} record` : undefined} onPress={() => record.scheduleId && setEditingRecord({ record, schedule: (classScheduleMap[selectedSubject.id] || {})[record.scheduleId] })} style={[styles.recordRow, { borderColor: colors.border }]}><View style={[styles.recordDot, { backgroundColor: record.type === 'Present' ? colors.success : record.type === 'Absent' ? colors.danger : colors.textLight }]} /><View style={styles.recordCopy}><Text style={[styles.recordTitle, { color: colors.textDark }]}>{record.type}</Text><Text style={[styles.recordMeta, { color: colors.textLight }]}>{getRecordText(record)}</Text>{record.changeNote ? <Text style={[styles.changeNote, { color: colors.primary }]}>{record.changeNote}</Text> : null}</View><Text style={[styles.recordBadge, { color: colors.textLight }]}>Absences: {record.absences}</Text></Pressable>)}
                {(selectedAttendance.records || []).length > shownRecords.length ? <Pressable accessibilityRole="button" onPress={() => setVisibleRecordCount((count) => count + RECORD_PAGE_SIZE)} style={[styles.moreButton, { borderColor: colors.border }]}><Text style={{ color: colors.primary, fontWeight: '800' }}>Show older records</Text></Pressable> : null}
              </View>

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.textDark }]}>Manual correction</Text>
                <Text style={[styles.helper, { color: colors.textLight }]}>Use only for a timetable correction. These entries stay clearly labelled in history.</Text>
                <View style={styles.manualActions}><Pressable accessibilityRole="button" accessibilityLabel="Remove one absence manually" disabled={Boolean(processingKey)} onPress={() => adjustManualAbsences(-1)} style={[styles.manualButton, { backgroundColor: colors.surface }]}><MaterialIcons name="remove" size={18} color={colors.textDark} /><Text style={{ color: colors.textDark, fontWeight: '800' }}>Remove absence</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Add one absence manually" disabled={Boolean(processingKey)} onPress={() => adjustManualAbsences(1)} style={[styles.manualButton, { backgroundColor: colors.surface }]}><MaterialIcons name="add" size={18} color={colors.textDark} /><Text style={{ color: colors.textDark, fontWeight: '800' }}>Add absence</Text></Pressable></View>
              </View>

              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.sectionTitle, { color: colors.textDark }]}>Attendance settings</Text>
                <Text style={[styles.helper, { color: colors.textLight }]}>Set your semester’s total planned classes. This never deletes history.</Text>
                <TextInput value={totalClassesDraft} onChangeText={setTotalClassesDraft} keyboardType="number-pad" returnKeyType="done" accessibilityLabel="Total planned classes" style={[styles.totalInput, { backgroundColor: colors.surface, color: colors.textDark }]} />
                <Pressable accessibilityRole="button" accessibilityState={{ busy: processingKey === 'settings' }} disabled={Boolean(processingKey)} onPress={saveTotalClasses} style={[styles.saveButton, { backgroundColor: colors.primary }]}>{processingKey === 'settings' ? <ActivityIndicator color="#FFFFFF" /> : <><MaterialIcons name="save" size={18} color="#FFFFFF" /><Text style={styles.saveText}>Save settings</Text></>}</Pressable>
              </View>

              {notice ? <View style={styles.noticeRow}><Text selectable style={[styles.notice, { color: colors.primary }]}>{notice}</Text>{undoItem ? <Pressable accessibilityRole="button" accessibilityLabel="Undo removing class mark" onPress={undoRemoval} style={[styles.undoButton, { backgroundColor: colors.primary }]}><Text style={styles.undoText}>Undo</Text></Pressable> : null}</View> : null}
            </Animated.View>
          </ScrollView>
        )}
      </View>

      <Modal visible={Boolean(editingRecord)} transparent animationType="fade" onRequestClose={() => setEditingRecord(null)}>
        <View style={styles.modalOverlay}><View style={[styles.sheet, { backgroundColor: colors.card }]}><View style={[styles.sheetHandle, { backgroundColor: colors.border }]} /><Text style={[styles.sheetTitle, { color: colors.textDark }]}>Edit class mark</Text><Text style={[styles.sheetSubtitle, { color: colors.textLight }]}>{editingRecord ? getRecordText(editingRecord.record) : ''}</Text><Pressable disabled={Boolean(processingKey)} onPress={() => saveClassStatus(editingRecord.schedule, 'Present', editingRecord.record)} style={[styles.sheetAction, { backgroundColor: colors.softSuccess }]}><MaterialIcons name="check-circle" size={21} color={colors.success} /><Text style={{ color: colors.success, fontWeight: '900' }}>Mark Present</Text></Pressable><Pressable disabled={Boolean(processingKey)} onPress={() => saveClassStatus(editingRecord.schedule, 'Absent', editingRecord.record)} style={[styles.sheetAction, { backgroundColor: colors.softDanger }]}><MaterialIcons name="cancel" size={21} color={colors.danger} /><Text style={{ color: colors.danger, fontWeight: '900' }}>Mark Absent</Text></Pressable><Pressable disabled={Boolean(processingKey)} onPress={() => removeClassRecord(editingRecord.record)} style={[styles.sheetAction, { backgroundColor: colors.surface }]}><MaterialIcons name="delete-outline" size={21} color={colors.textDark} /><Text style={{ color: colors.textDark, fontWeight: '900' }}>Remove mark</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setEditingRecord(null)} style={styles.cancelSheet}><Text style={{ color: colors.textLight, fontWeight: '800' }}>Cancel</Text></Pressable></View></View>
      </Modal>
    </SafeAreaView>
  );
}

function EmptyState({ error, colors, onRetry, onAdd }) {
  return <View style={[styles.empty, { backgroundColor: colors.card }]}><MaterialIcons name={error ? 'wifi-off' : 'menu-book'} size={34} color={colors.textLight} /><Text style={[styles.emptyTitle, { color: colors.textDark }]}>{error ? 'Could not load attendance' : 'No subjects yet'}</Text><Text style={[styles.helper, { color: colors.textLight }]}>{error ? 'Check your connection and try again.' : 'Add a subject first to start class-linked attendance.'}</Text><Pressable accessibilityRole="button" onPress={error ? onRetry : onAdd} style={[styles.emptyButton, { backgroundColor: colors.primary }]}><Text style={styles.emptyButtonText}>{error ? 'Retry' : 'Add subject'}</Text></Pressable></View>;
}

function SubjectCard({ subject, attendance, schedules, colors, isDarkMode, index, reduceMotion, onPress }) {
  const anim = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const stats = getAttendanceStats(subject, attendance);
  const tone = getAttendanceTone(stats.percentage, colors);
  const markedToday = schedules.length > 0 && schedules.every((schedule) => getClassAttendanceRecord(attendance, schedule.id));

  useEffect(() => {
    if (!reduceMotion) {
      Animated.timing(anim, { toValue: 1, duration: 340, delay: Math.min(index * 45, 280), easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [anim, index, reduceMotion]);

  return <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}><Pressable accessibilityRole="button" accessibilityLabel={`${subject.name}, ${stats.percentage} percent attendance`} onPress={onPress} style={({ pressed }) => [styles.subjectCard, { backgroundColor: colors.card }, pressed && styles.pressed]}><View style={[styles.cardAccent, { backgroundColor: tone }]} /><View style={[styles.subjectIcon, { backgroundColor: isDarkMode ? 'rgba(91,95,239,0.18)' : '#EEF2FF' }]}><MaterialIcons name={subject.type === 'Lab' ? 'science' : 'menu-book'} size={23} color={colors.primary} /></View><View style={styles.subjectCopy}><Text numberOfLines={1} style={[styles.subjectName, { color: colors.textDark }]}>{subject.name}</Text><Text style={[styles.subjectType, { color: colors.textLight }]}>{subject.type}</Text></View><CountUp value={stats.percentage} suffix="%" reduceMotion={reduceMotion} style={[styles.cardPercent, { color: tone }]} /><AnimatedBar percentage={stats.percentage} color={tone} trackColor={colors.surface} reduceMotion={reduceMotion} style={styles.cardBar} /><View style={styles.subjectFooter}><Text style={[styles.footerText, { color: colors.textLight }]}>{stats.absences} absences · {stats.remainingAbsences} safe left</Text><Text style={[styles.footerText, { color: markedToday ? colors.success : schedules.length ? colors.warning : colors.textLight }]}>{markedToday ? 'Marked today' : schedules.length ? 'Class today' : 'No class today'}</Text></View></Pressable></Animated.View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: SCREEN_PADDING, paddingTop: HEADER_TOP_PADDING },
  scrollContent: { paddingBottom: SCREEN_BOTTOM_PADDING },
  header: { minHeight: 116, borderRadius: 24, borderWidth: 1, overflow: 'hidden', marginBottom: 18, justifyContent: 'center', paddingHorizontal: 18 },
  headerWave: { position: 'absolute', left: -50, right: -50, bottom: -36, height: 92, borderTopLeftRadius: 180, borderTopRightRadius: 180, backgroundColor: 'rgba(196,181,253,0.35)', transform: [{ rotate: '5deg' }] },
  headerWaveDark: { backgroundColor: 'rgba(99,102,241,0.15)' },
  headerCopy: { paddingLeft: 56, paddingRight: 66 },
  title: { fontSize: TYPOGRAPHY.screenTitle, fontWeight: '900' },
  subtitle: { marginTop: 4, fontSize: TYPOGRAPHY.small, fontWeight: '600' },
  backButton: { position: 'absolute', zIndex: 2, left: 14, top: 15, width: 42, height: 42, borderRadius: 14, justifyContent: 'center', alignItems: 'center', ...SHADOW },
  heroIcon: { position: 'absolute', right: 18, bottom: 22, width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', ...SHADOW },
  pressed: { opacity: 0.86, transform: [{ scale: 0.98 }] },
  search: { minHeight: 50, borderRadius: CARD_RADIUS, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, marginBottom: 12, ...SHADOW },
  searchInput: { flex: 1, minHeight: 48, fontSize: TYPOGRAPHY.body, fontWeight: '600', paddingVertical: 0 },
  filterRow: { gap: 8, paddingBottom: 16 },
  filterChip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center' },
  filterText: { fontSize: 12, fontWeight: '800' },
  noResult: { textAlign: 'center', paddingVertical: 38, fontWeight: '600' },
  subjectCard: { position: 'relative', overflow: 'hidden', padding: 18, borderRadius: CARD_RADIUS, marginBottom: 13, ...SHADOW },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  subjectIcon: { width: 44, height: 44, borderRadius: 15, justifyContent: 'center', alignItems: 'center', position: 'absolute', left: 18, top: 18 },
  subjectCopy: { minHeight: 45, paddingLeft: 58, paddingRight: 70 },
  subjectName: { fontSize: TYPOGRAPHY.cardTitle, fontWeight: '900' },
  subjectType: { marginTop: 4, fontSize: 12, fontWeight: '700' },
  cardPercent: { position: 'absolute', right: 18, top: 20, fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cardBar: { marginTop: 14 },
  subjectFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 11 },
  footerText: { flex: 1, fontSize: 11, fontWeight: '700' },
  heroCard: { borderRadius: CARD_RADIUS, padding: 20, marginBottom: 14, ...SHADOW },
  ringWrap: { position: 'absolute', right: 20, top: 20 },
  subjectHeroCopy: { paddingRight: 112, minHeight: 94, justifyContent: 'center' },
  detailTitle: { fontSize: 22, fontWeight: '900' },
  detailMeta: { marginTop: 5, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  safeText: { marginTop: 8, fontSize: 12, fontWeight: '900' },
  ringText: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  heroBar: { marginTop: 16 },
  card: { borderRadius: CARD_RADIUS, padding: 18, marginBottom: 14, ...SHADOW },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionTitle: { fontSize: TYPOGRAPHY.cardTitle, fontWeight: '900' },
  sectionCaption: { fontSize: 11, fontWeight: '700', textAlign: 'right' },
  helper: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  classRow: { minHeight: 64, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  timeBox: { width: 64, minHeight: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  timeText: { fontSize: 11, fontWeight: '900', textAlign: 'center' },
  classCopy: { flex: 1 }, roomText: { fontSize: 14, fontWeight: '800' }, classStatus: { marginTop: 3, fontSize: 11, fontWeight: '700' },
  classActions: { flexDirection: 'row', gap: 7 }, iconAction: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  statusChip: { minHeight: 36, borderRadius: 12, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 },
  successBurst: { position: 'absolute', right: 28, top: 314, zIndex: 4 },
  forecastText: { fontSize: 14, fontWeight: '800', lineHeight: 21 }, forecastHint: { marginTop: 7, fontSize: 12, fontWeight: '600' },
  recordRow: { minHeight: 62, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }, recordDot: { width: 9, height: 9, borderRadius: 5 }, recordCopy: { flex: 1 }, recordTitle: { fontSize: 13, fontWeight: '900' }, recordMeta: { marginTop: 3, fontSize: 11, fontWeight: '600' }, changeNote: { marginTop: 3, fontSize: 10, fontWeight: '800' }, recordBadge: { maxWidth: 78, fontSize: 10, fontWeight: '800', textAlign: 'right' },
  exportActions: { flexDirection: 'row', gap: 6 }, exportButton: { minHeight: 34, borderRadius: 11, paddingHorizontal: 9, alignItems: 'center', flexDirection: 'row', gap: 4 }, exportText: { fontSize: 11, fontWeight: '900' }, moreButton: { minHeight: 42, borderWidth: 1, marginTop: 10, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  manualActions: { flexDirection: 'row', gap: 9, marginTop: 14 }, manualButton: { flex: 1, minHeight: 45, borderRadius: 13, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 5 },
  totalInput: { minHeight: 48, marginTop: 12, borderRadius: 13, paddingHorizontal: 14, fontSize: 16, fontWeight: '800' }, saveButton: { minHeight: 48, marginTop: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, saveText: { color: '#FFFFFF', fontWeight: '900' },
  noticeRow: { paddingBottom: 18, flexDirection: 'row', alignItems: 'center', gap: 9 }, notice: { flex: 1, paddingHorizontal: 4, fontSize: 12, fontWeight: '800', textAlign: 'center' }, undoButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 11, justifyContent: 'center' }, undoText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  reminderWarning: { minHeight: 46, borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }, reminderWarningText: { fontSize: 12, fontWeight: '800' },
  empty: { borderRadius: CARD_RADIUS, marginTop: 40, padding: 30, alignItems: 'center', ...SHADOW }, emptyTitle: { marginTop: 10, fontSize: 20, fontWeight: '900' }, emptyButton: { marginTop: 16, minHeight: 42, borderRadius: 13, paddingHorizontal: 16, justifyContent: 'center' }, emptyButtonText: { color: '#FFFFFF', fontWeight: '900' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.48)', justifyContent: 'flex-end', padding: 14 }, sheet: { borderRadius: 24, padding: 20, ...SHADOW }, sheetHandle: { width: 40, height: 4, borderRadius: 4, alignSelf: 'center', marginBottom: 18 }, sheetTitle: { fontSize: 21, fontWeight: '900' }, sheetSubtitle: { marginTop: 5, marginBottom: 16, fontSize: 12, fontWeight: '600' }, sheetAction: { minHeight: 50, borderRadius: 14, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 }, cancelSheet: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
});
