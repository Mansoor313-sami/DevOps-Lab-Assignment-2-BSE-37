import {
  loadAllUserTasks,
  loadUserAttendance,
  loadUserClassSchedules,
  loadUserDateSheets,
  saveSubjectTasks,
} from './localData';

import {
  scheduleTaskNotification,
} from './notifications';

import { persistPaperReminders } from './dateSheets';
import { getAttendanceStats } from './attendance';
import { persistScheduleReminders } from './schedules';

/* Rebuilds native reminders from the local database after the user has
   deliberately turned global notifications back on. Local storage remains
   the source of truth; every item is saved with its new native ids only
   after its scheduling step. */
export const rebuildUserReminders = async (userId) => {
  const [taskData, papers, scheduleMap, attendanceMap] = await Promise.all([
    loadAllUserTasks(userId),
    loadUserDateSheets(userId),
    loadUserClassSchedules(userId),
    loadUserAttendance(userId),
  ]);

  let rebuilt = 0;
  const failures = [];

  for (const subject of taskData.subjects) {
    const subjectTasks = taskData.tasks.filter(
      (task) => task.subjectId === subject.id
    );
    const syncedTasks = [];

    for (const task of subjectTasks) {
      const { subjectId, subjectName, ...storedTask } = task;

      if (task.status === 'Completed') {
        syncedTasks.push({ ...storedTask, notificationIds: [] });
        continue;
      }

      try {
        const notificationIds = await scheduleTaskNotification(
          task.title,
          task,
          task.time || '',
          subject.name,
          userId,
          task.reminders || []
        );

        /* scheduleTaskNotification returns null (not an empty array) to
           signal a genuine scheduling failure, same convention as
           scheduleClassNotification - an empty array means "nothing
           needed scheduling", which is a real success. Without this
           check, a failure that used to be silently swallowed inside
           scheduleTaskNotification would never reach this catch, so
           "failures" stayed empty and a total failure got reported to
           the user as "0 reminders rebuilt" instead of an honest error. */
        if (notificationIds === null) {
          throw new Error('Task reminders could not be scheduled.');
        }

        syncedTasks.push({ ...storedTask, notificationIds });
        rebuilt += notificationIds.length;
      } catch (error) {
        console.log(error);
        failures.push(task.title || 'a task');
        syncedTasks.push({ ...storedTask, reminderSyncPending: true });
      }
    }

    if (subjectTasks.length) {
      await saveSubjectTasks(userId, subject.id, syncedTasks);
    }
  }

  let syncedPapers = papers;
  for (const paper of papers) {
    if (paper.isArchived) continue;
    const result = await persistPaperReminders({
      userId,
      papers: syncedPapers,
      paper: { ...paper, notificationIds: [] },
    });
    syncedPapers = result.papers;
    if (result.reminderSyncFailed) {
      failures.push(`${paper.subjectName} paper`);
    } else {
      rebuilt += syncedPapers.find((item) => item.id === paper.id)
        ?.notificationIds?.length || 0;
    }
  }

  for (const subject of taskData.subjects) {
    const schedules = Object.values(scheduleMap[subject.id] || {});
    if (!schedules.length) continue;

    const result = await persistScheduleReminders({
      userId,
      subject,
      schedules,
      attendancePercentage: getAttendanceStats(
        subject,
        attendanceMap[subject.id]
      ).percentage,
    });

    if (result.reminderSyncFailed) {
      failures.push(`${subject.name} classes`);
    } else {
      rebuilt += result.schedules.reduce(
        (total, schedule) => total + (schedule.notificationIds?.length || 0),
        0
      );
    }
  }

  return { rebuilt, failures };
};
