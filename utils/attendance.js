import {
  saveSubjectAttendance,
  saveSubjectClassSchedules,
} from './localData';

import {
  cancelClassNotifications,
  scheduleClassNotification,
} from './notifications';

import {
  getAttendanceWindowState,
} from './schedules';

/* SHARED ATTENDANCE MATH
   Home, Subjects, Subject Detail, and Attendance all need the same
   numbers for the same subject. This used to be copy-pasted into
   all four screens and had drifted — the Attendance screen was
   colouring subjects by raw absence count while every other screen
   coloured by percentage, so the same subject could show green on
   one screen and red on another. One shared source now. */

export const ATTENDANCE_THRESHOLD = 80;

export const getAttendanceStats = (subject, attendance) => {

  const next =
    attendance || {
      attendancePerClass:
        subject.type === 'Lab' ? 2 : 1,
      totalClasses: 30,
      absences: 0,
    };

  /* Number(x) || 30 cannot tell a genuine, stored 0 apart from a
     missing value - a brand new subject that has honestly had zero
     classes so far was getting a fabricated 30-class percentage and an
     invented absence budget instead of an honest "no data yet" state.
     Only fall back to the default when totalClasses was never set. */

  const hasTotalClasses =
    next.totalClasses !== null &&
    next.totalClasses !== undefined;

  const totalClasses =
    hasTotalClasses
      ? Math.max(Number(next.totalClasses) || 0, 0)
      : 30;

  /* attendancePerClass has no legitimate zero - a class occurrence is
     always worth at least one mark - so it keeps a floor of 1, unlike
     totalClasses above. */

  const perClass =
    next.attendancePerClass !== null &&
    next.attendancePerClass !== undefined
      ? Math.max(Number(next.attendancePerClass) || 1, 1)
      : 1;

  const absences =
    Math.min(
      Math.max(Number(next.absences) || 0, 0),
      totalClasses
    );

  const hasNoClassesYet = totalClasses === 0;

  const totalMarks = totalClasses * perClass;

  const absentMarks = absences * perClass;

  const percentage =
    hasNoClassesYet
      ? 0
      : Math.max(
          0,
          ((totalMarks - absentMarks) / totalMarks) * 100
        );

  const allowedAbsences =
    Math.floor(totalClasses * 0.2);

  return {
    absences,
    perClass,
    totalClasses,
    totalMarks,
    absentMarks,
    allowedAbsences,
    remainingAbsences:
      Math.max(allowedAbsences - absences, 0),
    hasRecord: Boolean(attendance),
    hasNoClassesYet,
    percentage:
      Math.round(percentage * 10) / 10,
  };
};

export const getAttendanceTone = (percentage, colors) => {

  if (percentage < ATTENDANCE_THRESHOLD) {
    return colors.danger;
  }

  if (percentage < 85) {
    return colors.warning;
  }

  return colors.success;
};

export const getAttendanceDateKey = (date = new Date()) => {
  const value = new Date(date);

  if (Number.isNaN(value.getTime())) {
    return '';
  }

  return `${value.getFullYear()}-${String(
    value.getMonth() + 1
  ).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

export const getSchedulesForDate = (
  classScheduleMap,
  subjectId,
  date = new Date()
) => {
  const weekday = new Date(date).getDay() + 1;

  return Object.values(
    classScheduleMap?.[subjectId] || {}
  )
    .filter((schedule) =>
      schedule.isActive !== false &&
      schedule.weekday === weekday
    )
    .sort((first, second) =>
      (first.hours * 60 + first.minutes) -
      (second.hours * 60 + second.minutes)
    );
};

export const getClassAttendanceRecord = (
  attendance,
  scheduleId,
  dateKey = getAttendanceDateKey()
) =>
  (attendance?.records || []).find(
    (record) =>
      record.scheduleId === scheduleId &&
      (record.classDateKey ||
        getAttendanceDateKey(record.createdAt)) === dateKey
  ) || null;

export const buildClassAttendanceRecord = ({
  subjectId,
  schedule,
  status,
  absences,
  source = 'attendance',
  previousRecord,
}) => {
  const now = new Date();

  /* A class marked just after midnight, still inside its grace window,
     belongs to the day it actually started - not the calendar day the
     tap happened to land on. Reuse the same window resolution
     schedules.js uses for "can this still be marked" so the two never
     disagree about which day this record is for. */
  const { startsAt } =
    getAttendanceWindowState(schedule, now);

  const classDate =
    startsAt instanceof Date && !Number.isNaN(startsAt.getTime())
      ? startsAt
      : now;

  const dateKey = getAttendanceDateKey(classDate);

  return {
    id: previousRecord?.id ||
      `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    subjectId,
    scheduleId: schedule.id,
    classDateKey: dateKey,
    type: status,
    absences,
    source,
    room: schedule.room || '',
    timeLabel: schedule.timeLabel || '',
    dateLabel: classDate.toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }),
    dayLabel: classDate.toLocaleDateString(undefined, {
      weekday: 'long',
    }),
    createdAt: previousRecord?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    changeNote: previousRecord && previousRecord.type !== status
      ? `Changed from ${previousRecord.type} to ${status}`
      : previousRecord?.changeNote || '',
  };
};

const getAttendancePercentage = (attendance) => {
  /* Same explicit-null check as getAttendanceStats above - a real,
     stored 0 must not be treated as "missing" and silently replaced
     with a fabricated 30. */

  const hasTotalClasses =
    attendance.totalClasses !== null &&
    attendance.totalClasses !== undefined;

  const totalClasses =
    hasTotalClasses
      ? Math.max(Number(attendance.totalClasses) || 0, 0)
      : 30;

  const perClass =
    attendance.attendancePerClass !== null &&
    attendance.attendancePerClass !== undefined
      ? Math.max(Number(attendance.attendancePerClass) || 1, 1)
      : 1;

  const absences =
    Math.min(
      Math.max(Number(attendance.absences) || 0, 0),
      totalClasses
    );

  if (totalClasses === 0) {
    return 0;
  }

  const percentage =
    ((totalClasses * perClass - absences * perClass) /
      (totalClasses * perClass)) * 100;

  return Math.round(Math.max(percentage, 0) * 10) / 10;
};

/* Saves attendance and refreshes class reminders from one shared path so
   every screen keeps the percentage shown in reminders in sync. */
export const persistAttendance = async ({
  userId,
  subject,
  nextAttendance,
  classScheduleMap = {},
}) => {
  const attendance = {
    ...nextAttendance,
    remindersNeedRefresh: false,
    updatedAt: new Date().toISOString(),
  };

  await saveSubjectAttendance(
    userId,
    subject.id,
    attendance
  );

  const allSchedules =
    Object.values(classScheduleMap[subject.id] || {});

  const schedules = allSchedules.filter(
    (schedule) => schedule.isActive !== false
  );

  if (schedules.length === 0) {
    return {
      attendance,
      schedules: null,
      reminderRefreshFailed: false,
    };
  }

  const percentage =
    getAttendancePercentage(attendance);

  /* Declared outside the try block so the catch below can roll back
     whatever this pass already scheduled - see schedules.js's
     persistScheduleReminders, which does the same thing. Without this,
     a later failure (e.g. saveSubjectClassSchedules) left brand new
     native notifications minted but never referenced by anything,
     making them permanently uncancellable. */
  const newNotificationIds = [];

  try {
    const updatedSchedules = [];

    for (const schedule of schedules) {
      if (schedule.notificationIds?.length) {
        await cancelClassNotifications(
          schedule.notificationIds,
          userId
        );
      }

      /* Match schedules.js's persistScheduleReminders filter exactly -
         reminderMinutes === 0 is how this codebase represents a class
         reminder the user explicitly turned off. Marking attendance
         must never silently resurrect it. */
      if (Number(schedule.reminderMinutes) === 0) {
        updatedSchedules.push({
          ...schedule,
          notificationIds: [],
        });
        continue;
      }

      const notificationId =
        await scheduleClassNotification(
          userId,
          subject.name,
          schedule,
          percentage
        );

      if (notificationId) {
        newNotificationIds.push(notificationId);
      }

      updatedSchedules.push({
        ...schedule,
        notificationIds: notificationId
          ? [notificationId]
          : [],
      });
    }

    const mergedSchedules = allSchedules.map((schedule) =>
      updatedSchedules.find((updated) => updated.id === schedule.id) ||
        schedule
    );

    await saveSubjectClassSchedules(
      userId,
      subject.id,
      mergedSchedules
    );

    return {
      attendance,
      schedules: mergedSchedules,
      reminderRefreshFailed: false,
    };
  } catch (error) {
    console.log(error);

    await cancelClassNotifications(newNotificationIds, userId);

    const pendingAttendance = {
      ...attendance,
      remindersNeedRefresh: true,
    };

    try {
      await saveSubjectAttendance(
        userId,
        subject.id,
        pendingAttendance
      );
    } catch (saveError) {
      console.log(saveError);
    }

    return {
      attendance: pendingAttendance,
      schedules: null,
      reminderRefreshFailed: true,
    };
  }
};
