import { withDb } from './localDb';
import { DATA_DOMAINS, emitDataChanged } from './dataEvents';

/* LOCAL DATA REPOSITORY
   Offline-first replacement for the data-reading/writing half of
   utils/firebaseRest.js. Every exported function here has the same name
   and the same argument/return shape as its firebaseRest.js counterpart,
   so screens can switch their import from one file to the other with no
   other code changes.

   Nothing in this file ever touches the network. All of it resolves
   against the on-device SQLite database, so callers can treat every
   function as effectively instant. */

const nowIso = () => new Date().toISOString();

const parseRow = (row) => JSON.parse(row.data);

/* ------------------------------------------------------------------
   SUBJECTS
------------------------------------------------------------------- */

export const loadUserSubjects = async (
  userId,
  { includeArchived = false } = {}
) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT data FROM subjects WHERE userId = ? ORDER BY updatedAt DESC',
      [userId]
    );

    const all = rows.map(parseRow);

    return includeArchived
      ? all
      : all.filter((subject) => !subject.archived);
  });

export const saveUserSubjects = (userId, subjects) =>
  withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'DELETE FROM subjects WHERE userId = ?',
        [userId]
      );

      for (const subject of subjects) {
        const stamped = {
          ...subject,
          updatedAt: subject.updatedAt || nowIso(),
        };

        await db.runAsync(
          'INSERT INTO subjects (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [
            subject.id,
            userId,
            JSON.stringify(stamped),
            stamped.updatedAt,
          ]
        );
      }
    });

    emitDataChanged(DATA_DOMAINS.SUBJECTS, userId);
  });

/* ------------------------------------------------------------------
   TASKS
------------------------------------------------------------------- */

export const loadUserTasksBySubject = async (userId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT subjectId, data FROM tasks WHERE userId = ?',
      [userId]
    );

    const bySubject = {};

    rows.forEach((row) => {
      const task = JSON.parse(row.data);

      bySubject[row.subjectId] = bySubject[row.subjectId] || {};
      bySubject[row.subjectId][task.id] = task;
    });

    return bySubject;
  });

export const loadSubjectTasks = async (userId, subjectId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT data FROM tasks WHERE userId = ? AND subjectId = ?',
      [userId, subjectId]
    );

    return rows.map(parseRow);
  });

export const saveSubjectTasks = (userId, subjectId, tasks) =>
  withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'DELETE FROM tasks WHERE userId = ? AND subjectId = ?',
        [userId, subjectId]
      );

      for (const task of tasks) {
        const stamped = {
          ...task,
          updatedAt: task.updatedAt || nowIso(),
        };

        await db.runAsync(
          'INSERT INTO tasks (id, userId, subjectId, data, updatedAt) VALUES (?, ?, ?, ?, ?)',
          [
            task.id,
            userId,
            subjectId,
            JSON.stringify(stamped),
            stamped.updatedAt,
          ]
        );
      }
    });

    emitDataChanged(DATA_DOMAINS.TASKS, userId);
  });

export const deleteSubjectTasks = (userId, subjectId) =>
  withDb(async (db) => {
    await db.runAsync(
      'DELETE FROM tasks WHERE userId = ? AND subjectId = ?',
      [userId, subjectId]
    );

    emitDataChanged(DATA_DOMAINS.TASKS, userId);
  });

/* Mirrors firebaseRest's loadAllUserTasks: subjects plus every task
   flattened into one array, each task carrying its subject's name. */
export const loadAllUserTasks = async (userId) => {
  const subjects = await loadUserSubjects(userId);
  const tasksBySubject = await loadUserTasksBySubject(userId);

  let allTasks = [];

  subjects.forEach((subject) => {
    const subjectTasks = tasksBySubject?.[subject.id] || {};

    allTasks = [
      ...allTasks,
      ...Object.values(subjectTasks).map((task) => ({
        ...task,
        subjectName: subject.name,
        subjectId: subject.id,
      })),
    ];
  });

  return {
    subjects,
    tasks: allTasks,
  };
};

/* ------------------------------------------------------------------
   ATTENDANCE
------------------------------------------------------------------- */

export const loadUserAttendance = async (userId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT subjectId, data FROM attendance WHERE userId = ?',
      [userId]
    );

    const bySubject = {};

    rows.forEach((row) => {
      bySubject[row.subjectId] = JSON.parse(row.data);
    });

    return bySubject;
  });

export const saveSubjectAttendance = (userId, subjectId, attendance) =>
  withDb(async (db) => {
    const stamped = {
      ...attendance,
      updatedAt: attendance.updatedAt || nowIso(),
    };

    await db.runAsync(
      `INSERT INTO attendance (subjectId, userId, data, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(subjectId, userId) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [subjectId, userId, JSON.stringify(stamped), stamped.updatedAt]
    );

    emitDataChanged(DATA_DOMAINS.ATTENDANCE, userId);
  });

export const deleteSubjectAttendance = (userId, subjectId) =>
  withDb(async (db) => {
    await db.runAsync(
      'DELETE FROM attendance WHERE userId = ? AND subjectId = ?',
      [userId, subjectId]
    );

    emitDataChanged(DATA_DOMAINS.ATTENDANCE, userId);
  });

/* ------------------------------------------------------------------
   CLASS SCHEDULES
------------------------------------------------------------------- */

export const loadUserClassSchedules = async (userId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT subjectId, data FROM class_schedules WHERE userId = ?',
      [userId]
    );

    const bySubject = {};

    rows.forEach((row) => {
      const schedule = JSON.parse(row.data);

      bySubject[row.subjectId] = bySubject[row.subjectId] || {};
      bySubject[row.subjectId][schedule.id] = schedule;
    });

    return bySubject;
  });

export const saveSubjectClassSchedules = (userId, subjectId, schedules) =>
  withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'DELETE FROM class_schedules WHERE userId = ? AND subjectId = ?',
        [userId, subjectId]
      );

      for (const schedule of schedules) {
        const stamped = {
          ...schedule,
          updatedAt: schedule.updatedAt || nowIso(),
        };

        await db.runAsync(
          'INSERT INTO class_schedules (id, userId, subjectId, data, updatedAt) VALUES (?, ?, ?, ?, ?)',
          [
            schedule.id,
            userId,
            subjectId,
            JSON.stringify(stamped),
            stamped.updatedAt,
          ]
        );
      }
    });

    emitDataChanged(DATA_DOMAINS.CLASS_SCHEDULES, userId);
  });

export const deleteSubjectClassSchedules = (userId, subjectId) =>
  withDb(async (db) => {
    await db.runAsync(
      'DELETE FROM class_schedules WHERE userId = ? AND subjectId = ?',
      [userId, subjectId]
    );

    emitDataChanged(DATA_DOMAINS.CLASS_SCHEDULES, userId);
  });

/* ------------------------------------------------------------------
   DATE SHEETS
------------------------------------------------------------------- */

export const loadUserDateSheets = async (userId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT data FROM date_sheets WHERE userId = ?',
      [userId]
    );

    return rows.map(parseRow);
  });

export const saveUserDateSheets = (userId, dateSheets) =>
  withDb(async (db) => {
    await db.withTransactionAsync(async () => {
      await db.runAsync(
        'DELETE FROM date_sheets WHERE userId = ?',
        [userId]
      );

      for (const paper of dateSheets) {
        const stamped = {
          ...paper,
          updatedAt: paper.updatedAt || nowIso(),
        };

        await db.runAsync(
          'INSERT INTO date_sheets (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [paper.id, userId, JSON.stringify(stamped), stamped.updatedAt]
        );
      }
    });

    emitDataChanged(DATA_DOMAINS.DATE_SHEETS, userId);
  });

/* ------------------------------------------------------------------
   NOTIFICATIONS (alert history + unread badge)
   Purely a device-local record of what has already been shown - there
   is never a good reason for this to touch the network.
------------------------------------------------------------------- */

const createNotificationId = () =>
  `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const addUserNotification = (userId, notification) =>
  withDb(async (db) => {
    const id = notification.id || createNotificationId();

    const nextNotification = {
      id,
      type: notification.type || 'default',
      title: notification.title,
      message: notification.message,
      subjectName: notification.subjectName || '',
      taskTitle: notification.taskTitle || '',
      notificationId: notification.notificationId || '',
      entityType: notification.entityType || '',
      entityId: notification.entityId || '',
      readAt: notification.readAt || null,
      scheduledFor: notification.scheduledFor || nowIso(),
      createdAt: nowIso(),
    };

    await db.runAsync(
      'INSERT INTO notifications (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
      [
        id,
        userId,
        JSON.stringify(nextNotification),
        nextNotification.createdAt,
      ]
    );

    emitDataChanged(DATA_DOMAINS.NOTIFICATIONS, userId);

    return nextNotification;
  });

export const loadUserNotifications = async (userId) =>
  withDb(async (db) => {
    const rows = await db.getAllAsync(
      'SELECT data FROM notifications WHERE userId = ? ORDER BY updatedAt DESC',
      [userId]
    );

    return rows.map(parseRow);
  });

export const saveUserNotification = (userId, notification) =>
  withDb(async (db) => {
    await db.runAsync(
      `INSERT INTO notifications (id, userId, data, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id, userId) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [
        notification.id,
        userId,
        JSON.stringify(notification),
        notification.updatedAt || nowIso(),
      ]
    );

    emitDataChanged(DATA_DOMAINS.NOTIFICATIONS, userId);
  });

export const deleteUserNotification = (userId, notificationId) =>
  withDb(async (db) => {
    await db.runAsync(
      'DELETE FROM notifications WHERE userId = ? AND id = ?',
      [userId, notificationId]
    );

    emitDataChanged(DATA_DOMAINS.NOTIFICATIONS, userId);
  });

export const clearUserNotifications = (userId) =>
  withDb(async (db) => {
    await db.runAsync(
      'DELETE FROM notifications WHERE userId = ?',
      [userId]
    );

    emitDataChanged(DATA_DOMAINS.NOTIFICATIONS, userId);
  });

/* Matches records by their *native* notificationId (the scheduled OS
   notification's id), not the record's own id - this mirrors the
   original Firebase implementation exactly, since cancelling a native
   reminder needs to clean up the history row it produced. */
export const deleteUserNotificationsByIds = (userId, notificationIds = []) =>
  withDb(async (db) => {
    if (notificationIds.length === 0) {
      return;
    }

    const rows = await db.getAllAsync(
      'SELECT id, data FROM notifications WHERE userId = ?',
      [userId]
    );

    const matchingIds = rows
      .filter((row) =>
        notificationIds.includes(JSON.parse(row.data).notificationId)
      )
      .map((row) => row.id);

    if (matchingIds.length === 0) {
      return;
    }

    await db.withTransactionAsync(async () => {
      for (const id of matchingIds) {
        await db.runAsync(
          'DELETE FROM notifications WHERE userId = ? AND id = ?',
          [userId, id]
        );
      }
    });

    emitDataChanged(DATA_DOMAINS.NOTIFICATIONS, userId);
  });

/* ------------------------------------------------------------------
   PROFILE
   Name, semester, department, phone, bio, profile photo. Identity
   fields that also live in Firebase Auth (email, regNo) are never
   changed from here - only utils/firebaseRest.js touches those, and
   only as part of an explicit, online-only identity change.
------------------------------------------------------------------- */

export const getUserById = async (userId) =>
  withDb(async (db) => {
    const row = await db.getFirstAsync(
      'SELECT data FROM profile WHERE userId = ?',
      [userId]
    );

    return row ? JSON.parse(row.data) : null;
  });

const saveProfileRecord = (userId, updates) =>
  withDb(async (db) => {
    const existing = await db.getFirstAsync(
      'SELECT data FROM profile WHERE userId = ?',
      [userId]
    );

    const current = existing ? JSON.parse(existing.data) : { id: userId };

    const next = {
      ...current,
      ...updates,
      id: userId,
      updatedAt: nowIso(),
    };

    await db.runAsync(
      `INSERT INTO profile (userId, data, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [userId, JSON.stringify(next), next.updatedAt]
    );

    emitDataChanged(DATA_DOMAINS.PROFILE, userId);

    return next;
  });

/* PATCH-style: merges a partial update in (used for a quick name-only
   edit). Nothing meaningful is returned, matching the original. */
export const updateUserProfile = (userId, updates) =>
  saveProfileRecord(userId, updates);

/* Full-form save from the Profile screen. Returns the merged profile
   fields only - callers that also need to keep the auth session object
   (idToken/refreshToken) in AsyncStorage are responsible for merging
   this result into their own copy of currentUser, since that session
   state does not belong in this local data layer. */
export const saveUserProfile = (userId, updates) =>
  saveProfileRecord(userId, updates);

/* ------------------------------------------------------------------
   SETTINGS
------------------------------------------------------------------- */

const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  notificationTone: 'default',
  notificationVibration: 'medium',
};

export const loadUserSettings = async (userId) =>
  withDb(async (db) => {
    const row = await db.getFirstAsync(
      'SELECT data FROM settings WHERE userId = ?',
      [userId]
    );

    return row
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) }
      : { ...DEFAULT_SETTINGS };
  });

export const updateUserSettings = (userId, updates) =>
  withDb(async (db) => {
    const existing = await db.getFirstAsync(
      'SELECT data FROM settings WHERE userId = ?',
      [userId]
    );

    const current = existing
      ? JSON.parse(existing.data)
      : { ...DEFAULT_SETTINGS };

    const next = {
      ...current,
      ...updates,
      updatedAt: nowIso(),
    };

    await db.runAsync(
      `INSERT INTO settings (userId, data, updatedAt)
       VALUES (?, ?, ?)
       ON CONFLICT(userId) DO UPDATE SET
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
      [userId, JSON.stringify(next), next.updatedAt]
    );

    emitDataChanged(DATA_DOMAINS.SETTINGS, userId);
  });

/* ------------------------------------------------------------------
   WHOLE-USER SNAPSHOT
   Used by the migration step (Firebase -> local, once) and by
   Cloud Backup / Restore (local <-> Firebase backups/{userId}).
------------------------------------------------------------------- */

export const hasLocalData = async (userId) =>
  withDb(async (db) => {
    const row = await db.getFirstAsync(
      `SELECT
         (SELECT COUNT(*) FROM subjects WHERE userId = ?) +
         (SELECT COUNT(*) FROM tasks WHERE userId = ?) +
         (SELECT COUNT(*) FROM attendance WHERE userId = ?) +
         (SELECT COUNT(*) FROM class_schedules WHERE userId = ?) +
         (SELECT COUNT(*) FROM date_sheets WHERE userId = ?) +
         (SELECT COUNT(*) FROM profile WHERE userId = ?) AS total`,
      [userId, userId, userId, userId, userId, userId]
    );

    return Number(row?.total || 0) > 0;
  });

export const getUserSnapshot = async (userId) => {
  const [
    subjects,
    tasksBySubject,
    attendance,
    classSchedules,
    dateSheets,
    notifications,
    profile,
    settings,
  ] = await Promise.all([
    loadUserSubjects(userId, { includeArchived: true }),
    loadUserTasksBySubject(userId),
    loadUserAttendance(userId),
    loadUserClassSchedules(userId),
    loadUserDateSheets(userId),
    loadUserNotifications(userId),
    getUserById(userId),
    loadUserSettings(userId),
  ]);

  return {
    subjects,
    tasksBySubject,
    attendance,
    classSchedules,
    dateSheets,
    notifications,
    profile,
    settings,
  };
};

/* Wipes and rewrites every table for this user in one transaction.
   Used to seed the local DB from Firebase on first login, and as the
   base step before a Restore merge. `profile`/`settings` are only
   overwritten when the snapshot actually carries them, so a partial
   snapshot (e.g. the semester-only shape wipeSemesterData passes)
   cannot accidentally blank out the user's name or preferences. */
export const replaceUserSnapshot = (userId, snapshot) =>
  withDb(async (db) => {
    const {
      subjects = [],
      tasksBySubject = {},
      attendance = {},
      classSchedules = {},
      dateSheets = [],
      notifications = [],
      profile = undefined,
      settings = undefined,
    } = snapshot || {};

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM subjects WHERE userId = ?', [userId]);
      await db.runAsync('DELETE FROM tasks WHERE userId = ?', [userId]);
      await db.runAsync('DELETE FROM attendance WHERE userId = ?', [userId]);
      await db.runAsync('DELETE FROM class_schedules WHERE userId = ?', [
        userId,
      ]);
      await db.runAsync('DELETE FROM date_sheets WHERE userId = ?', [
        userId,
      ]);
      await db.runAsync('DELETE FROM notifications WHERE userId = ?', [
        userId,
      ]);

      for (const subject of subjects) {
        await db.runAsync(
          'INSERT INTO subjects (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [
            subject.id,
            userId,
            JSON.stringify(subject),
            subject.updatedAt || subject.createdAt || nowIso(),
          ]
        );
      }

      for (const [subjectId, byId] of Object.entries(tasksBySubject)) {
        for (const task of Object.values(byId || {})) {
          await db.runAsync(
            'INSERT INTO tasks (id, userId, subjectId, data, updatedAt) VALUES (?, ?, ?, ?, ?)',
            [
              task.id,
              userId,
              subjectId,
              JSON.stringify(task),
              task.updatedAt || task.createdAt || nowIso(),
            ]
          );
        }
      }

      for (const [subjectId, record] of Object.entries(attendance)) {
        if (!record) continue;

        await db.runAsync(
          'INSERT INTO attendance (subjectId, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [
            subjectId,
            userId,
            JSON.stringify(record),
            record.updatedAt || nowIso(),
          ]
        );
      }

      for (const [subjectId, byId] of Object.entries(classSchedules)) {
        for (const schedule of Object.values(byId || {})) {
          await db.runAsync(
            'INSERT INTO class_schedules (id, userId, subjectId, data, updatedAt) VALUES (?, ?, ?, ?, ?)',
            [
              schedule.id,
              userId,
              subjectId,
              JSON.stringify(schedule),
              schedule.updatedAt || nowIso(),
            ]
          );
        }
      }

      for (const paper of dateSheets) {
        await db.runAsync(
          'INSERT INTO date_sheets (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [
            paper.id,
            userId,
            JSON.stringify(paper),
            paper.updatedAt || nowIso(),
          ]
        );
      }

      for (const notification of notifications) {
        await db.runAsync(
          'INSERT INTO notifications (id, userId, data, updatedAt) VALUES (?, ?, ?, ?)',
          [
            notification.id,
            userId,
            JSON.stringify(notification),
            notification.updatedAt ||
              notification.createdAt ||
              nowIso(),
          ]
        );
      }

      if (profile !== undefined && profile !== null) {
        const stampedProfile = {
          ...profile,
          id: userId,
          updatedAt: profile.updatedAt || nowIso(),
        };

        await db.runAsync(
          `INSERT INTO profile (userId, data, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(userId) DO UPDATE SET
             data = excluded.data,
             updatedAt = excluded.updatedAt`,
          [userId, JSON.stringify(stampedProfile), stampedProfile.updatedAt]
        );
      }

      if (settings !== undefined && settings !== null) {
        const stampedSettings = {
          ...settings,
          updatedAt: settings.updatedAt || nowIso(),
        };

        await db.runAsync(
          `INSERT INTO settings (userId, data, updatedAt)
           VALUES (?, ?, ?)
           ON CONFLICT(userId) DO UPDATE SET
             data = excluded.data,
             updatedAt = excluded.updatedAt`,
          [userId, JSON.stringify(stampedSettings), stampedSettings.updatedAt]
        );
      }
    });

    Object.values(DATA_DOMAINS).forEach((domain) =>
      emitDataChanged(domain, userId)
    );
  });

/* Used by "Reset Semester Data" in Settings: clears subjects, tasks,
   attendance, class schedules, date sheets, and alert history - the
   exact scope the original Firebase reset covered. Profile and
   Settings are deliberately untouched (replaceUserSnapshot only
   overwrites profile/settings when the snapshot actually carries
   them, and this snapshot does not). */
export const wipeSemesterData = (userId) =>
  replaceUserSnapshot(userId, {
    subjects: [],
    tasksBySubject: {},
    attendance: {},
    classSchedules: {},
    dateSheets: [],
    notifications: [],
  });

/* Used when the account itself is being deleted: clears every local
   table for this user, including profile, settings, and notification
   history - nothing about the account should survive on the device. */
export const wipeAllUserData = (userId) =>
  withDb(async (db) => {
    await wipeSemesterData(userId);

    await db.runAsync('DELETE FROM profile WHERE userId = ?', [userId]);
    await db.runAsync('DELETE FROM settings WHERE userId = ?', [userId]);

    emitDataChanged(DATA_DOMAINS.PROFILE, userId);
    emitDataChanged(DATA_DOMAINS.SETTINGS, userId);
  });
