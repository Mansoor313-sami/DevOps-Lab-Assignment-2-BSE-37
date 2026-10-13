import { getMeta, setMeta } from './localDb';

import {
  getUserSnapshot,
  replaceUserSnapshot,
  updateUserSettings,
} from './localData';

import {
  downloadUserBackup,
  uploadUserBackup,
} from './firebaseRest';

import { checkConnection } from './network';

import { clearAllNotifications } from './notifications';

import { rebuildUserReminders } from './reminderSync';

const BACKUP_VERSION = 1;

const lastBackupKey = (userId) => `lastBackupAt_${userId}`;

export const getLastBackupAt = async (userId) => {
  if (!userId) {
    return null;
  }

  return getMeta(lastBackupKey(userId));
};

/* ------------------------------------------------------------------
   BACKUP
   Uploads a full snapshot of the local database. Manual only - there
   is no background/auto sync, so this never runs without the user
   asking for it.
------------------------------------------------------------------- */

export const backupUserData = async (userId) => {
  if (!userId) {
    return { success: false, reason: 'no-user' };
  }

  const online = await checkConnection(5000);

  if (!online) {
    return { success: false, reason: 'offline' };
  }

  try {
    const snapshot = await getUserSnapshot(userId);

    const backedUpAt = new Date().toISOString();

    await uploadUserBackup(userId, {
      version: BACKUP_VERSION,
      backedUpAt,
      ...snapshot,
    });

    await setMeta(lastBackupKey(userId), backedUpAt);

    return { success: true, backedUpAt };
  } catch (error) {
    console.log(error);
    return { success: false, reason: 'error', error };
  }
};

/* ------------------------------------------------------------------
   RESTORE (smart merge)

   For every record (a subject, a task, a class schedule, a date-sheet
   paper) the newer of the local copy and the cloud copy wins, judged
   by that record's own `updatedAt` (falling back to `createdAt`). This
   means restoring can never silently destroy something newer than the
   backup, while still pulling in anything the backup has that the
   local device does not.

   Attendance is merged per subject rather than per attendance record:
   an attendance object bundles counters (absences, totalClasses) with
   its `records` list, and those counters only make sense read together
   - so whichever side's attendance object for a subject is newer wins
   as a whole for that subject.
------------------------------------------------------------------- */

const getTimestamp = (record) => {
  const value = record?.updatedAt || record?.createdAt;
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
};

/* Merges two flat arrays of records (subjects, date sheets) by id.
   Strictly greater, not >= - when neither side has a usable timestamp
   (both resolve to 0), a >= comparison let the cloud copy win by
   default, so restoring a stale backup could silently overwrite newer
   local edits that just never got an updatedAt/createdAt stamped. A
   stale backup should never clobber fresher-but-unstamped local data,
   so local wins any tie, and cloud only wins when it is provably newer. */
const mergeById = (localList = [], cloudList = []) => {
  const byId = new Map();

  localList.forEach((item) => byId.set(item.id, item));

  cloudList.forEach((item) => {
    const existing = byId.get(item.id);

    if (!existing || getTimestamp(item) > getTimestamp(existing)) {
      byId.set(item.id, item);
    }
  });

  return Array.from(byId.values());
};

/* Merges two { subjectId: { itemId: item } } maps (tasks, schedules)
   one subject at a time, using mergeById on each subject's items. */
const mergeNestedById = (localMap = {}, cloudMap = {}) => {
  const result = {};

  const subjectIds = new Set([
    ...Object.keys(localMap || {}),
    ...Object.keys(cloudMap || {}),
  ]);

  subjectIds.forEach((subjectId) => {
    const localItems = Object.values(localMap[subjectId] || {});
    const cloudItems = Object.values(cloudMap[subjectId] || {});

    const merged = mergeById(localItems, cloudItems);

    result[subjectId] = {};

    merged.forEach((item) => {
      result[subjectId][item.id] = item;
    });
  });

  return result;
};

/* Merges two { subjectId: attendanceObject } maps, newest object wins
   whole, per subject. */
const mergeAttendance = (localMap = {}, cloudMap = {}) => {
  const result = {};

  const subjectIds = new Set([
    ...Object.keys(localMap || {}),
    ...Object.keys(cloudMap || {}),
  ]);

  subjectIds.forEach((subjectId) => {
    const local = localMap[subjectId];
    const cloud = cloudMap[subjectId];

    if (!local) {
      result[subjectId] = cloud;
      return;
    }

    if (!cloud) {
      result[subjectId] = local;
      return;
    }

    /* Same strictly-greater tie-break as mergeById above - prefer local
       whenever neither side's timestamp can prove which is actually
       newer. */
    result[subjectId] =
      getTimestamp(cloud) > getTimestamp(local) ? cloud : local;
  });

  return result;
};

/* Whole-object newest-wins, used for the single-row domains (profile,
   settings) where there is nothing meaningful to merge field by field. */
const mergeWholeObject = (local, cloud) => {
  if (!local) return cloud ?? null;
  if (!cloud) return local ?? null;

  return getTimestamp(cloud) > getTimestamp(local) ? cloud : local;
};

/* KNOWN LIMITATION - NO TOMBSTONES
   This is a union merge with no record of deletions. If a subject, task,
   schedule, or paper was deleted on this device after the backup was
   made, restoring will bring it right back, because nothing here can
   tell "never existed on the backup" apart from "existed and was
   deleted since". Fixing this properly needs tombstone records (a
   deleted-at marker kept for a while instead of removing the row
   outright) - out of scope for this pass, but worth knowing next time
   someone touches this file. */
const mergeSnapshots = (local, cloud) => ({
  subjects: mergeById(local.subjects, cloud.subjects),
  tasksBySubject: mergeNestedById(
    local.tasksBySubject,
    cloud.tasksBySubject
  ),
  attendance: mergeAttendance(local.attendance, cloud.attendance),
  classSchedules: mergeNestedById(
    local.classSchedules,
    cloud.classSchedules
  ),
  dateSheets: mergeById(local.dateSheets, cloud.dateSheets),
  notifications: mergeById(local.notifications, cloud.notifications),
  profile: mergeWholeObject(local.profile, cloud.profile),
  settings: mergeWholeObject(local.settings, cloud.settings),
});

export const restoreUserData = async (userId) => {
  if (!userId) {
    return { success: false, reason: 'no-user' };
  }

  const online = await checkConnection(5000);

  if (!online) {
    return { success: false, reason: 'offline' };
  }

  try {
    const cloud = await downloadUserBackup(userId);

    if (!cloud) {
      return { success: false, reason: 'no-backup' };
    }

    const local = await getUserSnapshot(userId);

    const merged = mergeSnapshots(local, cloud);

    await replaceUserSnapshot(userId, merged);

    /* RECONCILE NATIVE NOTIFICATION IDS
       Every notificationIds array inside the restored data was minted on
       whichever device made the backup - none of those ids exist in this
       device's OS notification store, so nothing on this device could
       ever cancel them, and a task/class/paper that was deleted before
       the restore would still fire its reminder forever. Cancel every
       native notification this device currently knows about and rebuild
       from the freshly merged local data so ids match this install
       again. This is a recoverable second step, same as everywhere else
       reminders are synced from local data - a failure here must not
       undo an otherwise successful data restore. */
    try {
      await clearAllNotifications();

      const { failures } = await rebuildUserReminders(userId);

      if (failures.length > 0) {
        await updateUserSettings(userId, { remindersNeedResync: true });
      }
    } catch (reminderError) {
      console.log(reminderError);

      try {
        await updateUserSettings(userId, { remindersNeedResync: true });
      } catch (settingsError) {
        console.log(settingsError);
      }
    }

    return { success: true, restoredAt: new Date().toISOString() };
  } catch (error) {
    console.log(error);
    return { success: false, reason: 'error', error };
  }
};
