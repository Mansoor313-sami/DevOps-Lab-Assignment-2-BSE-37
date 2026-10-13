import {
  saveSubjectClassSchedules,
} from './localData';

import {
  cancelClassNotifications,
  scheduleClassNotification,
} from './notifications';

export const normalizeRoom = (room = '') =>
  room.trim().replace(/\s+/g, ' ').toLowerCase();

export const getScheduleEnd = (schedule) =>
  (Number(schedule.hours) * 60) +
  (Number(schedule.minutes) || 0) +
  (Number(schedule.durationMinutes) || 60);

/* ------------------------------------------------------------------
   DURATION AWARE CLASS TIMING

   Every screen that asks "is this class happening now?" or "when is
   the next one?" must answer with the schedule's real duration. A
   fixed one hour window made 90 minute classes and 3 hour labs end
   early, which then pushed a still running class into next week.
------------------------------------------------------------------- */

export const getScheduleDuration = (schedule) =>
  Math.max(Number(schedule?.durationMinutes) || 60, 1);

/* The stored weekday convention is getDay() + 1, so Sunday is 1. */

export const getScheduleWeekday = (date) =>
  new Date(date).getDay() + 1;

/* Start of this schedule on the given day, ignoring which weekday
   that day actually is. */

export const getScheduleTimeOnDate = (schedule, date = new Date()) => {
  const start = new Date(date);

  start.setHours(
    Number(schedule?.hours) || 0,
    Number(schedule?.minutes) || 0,
    0,
    0
  );

  return start;
};

export const isScheduleOnDate = (schedule, date = new Date()) =>
  Number(schedule?.weekday) === getScheduleWeekday(date);

/* A class counts as ongoing from its start until start + duration. */

export const isClassOngoingAt = (schedule, now = new Date()) => {
  if (!isScheduleOnDate(schedule, now)) {
    return false;
  }

  const start = getScheduleTimeOnDate(schedule, now).getTime();
  const end = start + getScheduleDuration(schedule) * 60000;
  const current = new Date(now).getTime();

  return current >= start && current < end;
};

/* Next occurrence of this schedule. A class that is still running
   counts as today, not next week. */

export const getNextClassOccurrence = (schedule, now = new Date()) => {
  const current = new Date(now);
  const next = getScheduleTimeOnDate(schedule, current);

  let dayDiff =
    Number(schedule?.weekday) - getScheduleWeekday(current);

  const endsAt =
    next.getTime() + getScheduleDuration(schedule) * 60000;

  if (dayDiff < 0 || (dayDiff === 0 && endsAt <= current.getTime())) {
    dayDiff += 7;
  }

  next.setDate(next.getDate() + dayDiff);

  return next;
};

/* ------------------------------------------------------------------
   ATTENDANCE WINDOW

   Attendance should not be markable for a class that has not started
   yet, nor for one that finished hours ago. The window opens shortly
   before the class and stays open for a while after it ends so a
   student can still mark it on the walk out.
------------------------------------------------------------------- */

export const ATTENDANCE_OPENS_BEFORE_MINUTES = 15;

export const ATTENDANCE_CLOSES_AFTER_MINUTES = 120;

/* A class can still be inside its marking grace window after midnight,
   once the actual weekday has already rolled over to the next day.
   Projecting the schedule onto "today" alone (the old behaviour) then
   computes a start time many hours in the future - today's occurrence,
   next week - instead of recognising the window left open from
   yesterday's class, and the class would not even be found among
   "today's" classes at all. Try yesterday's occurrence first whenever
   the schedule's weekday matches it, before falling back to today's, so
   a late-night class stays markable across the midnight boundary. */

const buildAttendanceWindow = (schedule, start, current) => {
  const startMs = start.getTime();
  const endMs = startMs + getScheduleDuration(schedule) * 60000;
  const opensMs = startMs - ATTENDANCE_OPENS_BEFORE_MINUTES * 60000;
  const closesMs = endMs + ATTENDANCE_CLOSES_AFTER_MINUTES * 60000;

  if (current < opensMs) {
    return {
      state: 'upcoming',
      canMark: false,
      startsAt: start,
      reason: `Opens at ${formatClockTime(new Date(opensMs))}`,
    };
  }

  if (current > closesMs) {
    return {
      state: 'closed',
      canMark: false,
      startsAt: start,
      reason: 'Attendance window closed',
    };
  }

  return {
    state: current < endMs ? 'open' : 'grace',
    canMark: true,
    startsAt: start,
    reason: '',
  };
};

export const getAttendanceWindowState = (
  schedule,
  now = new Date()
) => {
  const current = new Date(now).getTime();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const candidateDates = [];

  if (Number(schedule?.weekday) === getScheduleWeekday(yesterday)) {
    candidateDates.push(yesterday);
  }

  if (Number(schedule?.weekday) === getScheduleWeekday(now)) {
    candidateDates.push(now);
  }

  if (candidateDates.length === 0) {
    /* This schedule does not fall on today or yesterday - fall back to
       projecting it onto "today" so callers still get a sensible
       upcoming/closed answer instead of nothing. */
    candidateDates.push(now);
  }

  const results = candidateDates.map((date) =>
    buildAttendanceWindow(
      schedule,
      getScheduleTimeOnDate(schedule, date),
      current
    )
  );

  /* Prefer whichever candidate is actually markable right now;
     otherwise fall back to the last candidate (today's projection, so
     "upcoming"/"closed" messaging talks about today rather than a
     yesterday that has already fully closed). */
  return (
    results.find((result) => result.canMark) ||
    results[results.length - 1]
  );
};

export const formatClockTime = (date) =>
  new Date(date).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

/* ------------------------------------------------------------------
   EXAM TIMING
------------------------------------------------------------------- */

export const DEFAULT_EXAM_DURATION_MINUTES = 180;

export const getExamDuration = (paper) =>
  Math.max(
    Number(paper?.durationMinutes) ||
      DEFAULT_EXAM_DURATION_MINUTES,
    1
  );

export const getExamWindow = (paper) => {
  const start = new Date(paper?.examDate);

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  return {
    start,
    end: new Date(
      start.getTime() + getExamDuration(paper) * 60000
    ),
  };
};

/* upcoming while it has not started, ongoing until it ends, then
   ended - so a paper does not vanish the minute it begins. */

export const getExamState = (paper, now = new Date()) => {
  const window = getExamWindow(paper);

  if (!window) {
    return 'invalid';
  }

  const current = new Date(now).getTime();

  if (current < window.start.getTime()) {
    return 'upcoming';
  }

  if (current < window.end.getTime()) {
    return 'ongoing';
  }

  return 'ended';
};

export const scheduleOverlaps = (first, second) => {
  if (first.weekday !== second.weekday) {
    return false;
  }

  const firstStart = Number(first.hours) * 60 + Number(first.minutes || 0);
  const secondStart = Number(second.hours) * 60 + Number(second.minutes || 0);

  return firstStart < getScheduleEnd(second) &&
    secondStart < getScheduleEnd(first);
};

export const findScheduleConflicts = ({
  scheduleMap = {},
  subjects = [],
  candidates = [],
  ignoreIds = [],
}) => {
  const subjectById = Object.fromEntries(
    subjects.map((subject) => [subject.id, subject])
  );
  const ignored = new Set(ignoreIds);
  const conflicts = [];

  candidates.forEach((candidate) => {
    Object.entries(scheduleMap).forEach(([subjectId, byId]) => {
      Object.values(byId || {}).forEach((existing) => {
        if (existing.isActive === false || ignored.has(existing.id) ||
          !scheduleOverlaps(candidate, existing)) {
          return;
        }

        const sameSubject = subjectId === candidate.subjectId;
        const sameRoom = normalizeRoom(candidate.room) &&
          normalizeRoom(candidate.room) === normalizeRoom(existing.room);

        conflicts.push({
          candidateId: candidate.id,
          scheduleId: existing.id,
          subjectId,
          subjectName: subjectById[subjectId]?.name || 'Another subject',
          existing,
          type: sameSubject ? 'same-subject' : sameRoom ? 'room' : 'overlap',
        });
      });
    });
  });

  return conflicts;
};

/* Firebase is the source of truth. Reminders are a second, recoverable
   synchronisation step; no native reminder is made before the timetable save. */
export const persistScheduleReminders = async ({
  userId,
  subject,
  schedules,
  attendancePercentage,
}) => {
  const pendingSchedules = schedules.map((schedule) => ({
    ...schedule,
    reminderSyncPending: Boolean(
      schedule.isActive !== false || schedule.notificationIds?.length
    ),
  }));

  await saveSubjectClassSchedules(userId, subject.id, pendingSchedules);

  const newNotificationIds = [];

  try {
    const syncedSchedules = [];

    for (const schedule of pendingSchedules) {
      if (schedule.notificationIds?.length) {
        await cancelClassNotifications(schedule.notificationIds, userId);
      }

      if (schedule.isActive === false || Number(schedule.reminderMinutes) === 0) {
        syncedSchedules.push({
          ...schedule,
          notificationIds: [],
          reminderSyncPending: false,
        });
        continue;
      }

      const notificationId = await scheduleClassNotification(
        userId,
        subject.name,
        schedule,
        attendancePercentage
      );

      if (notificationId === null) {
        throw new Error('Class reminder could not be scheduled.');
      }

      if (notificationId) {
        newNotificationIds.push(notificationId);
      }

      syncedSchedules.push({
        ...schedule,
        notificationIds: notificationId ? [notificationId] : [],
        reminderSyncPending: false,
      });
    }

    await saveSubjectClassSchedules(userId, subject.id, syncedSchedules);

    return {
      schedules: syncedSchedules,
      reminderSyncFailed: false,
    };
  } catch (error) {
    await cancelClassNotifications(newNotificationIds, userId);

    return {
      schedules: pendingSchedules,
      reminderSyncFailed: true,
      error,
    };
  }
};
