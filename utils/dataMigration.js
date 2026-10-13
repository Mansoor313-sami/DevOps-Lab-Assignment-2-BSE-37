import { getMeta, setMeta } from './localDb';
import { hasLocalData, replaceUserSnapshot } from './localData';

import {
  getUserById as fbGetUserById,
  loadUserAttendance as fbLoadUserAttendance,
  loadUserClassSchedules as fbLoadUserClassSchedules,
  loadUserDateSheets as fbLoadUserDateSheets,
  loadUserNotifications as fbLoadUserNotifications,
  loadUserSettings as fbLoadUserSettings,
  loadUserSubjects as fbLoadUserSubjects,
  loadUserTasksBySubject as fbLoadUserTasksBySubject,
} from './firebaseRest';

/* ONE-TIME FIREBASE -> LOCAL MIGRATION
   Existing installs only have their data in Firebase. The very first
   time such a user logs in after this update, we pull everything down
   once and seed the local database, then every screen switches over to
   reading/writing local data from then on.

   Guarded by a flag in the local `meta` table (not AsyncStorage) so the
   flag itself lives right next to the data it describes. If the pull
   fails (e.g. no connection on that first post-update launch) the flag
   is deliberately left unset, so the app tries again on the next login
   or the next time connectivity is confirmed.

   Fetches are sequential (not Promise.all) on purpose: this lets the
   caller show a real, smoothly climbing progress bar keyed to each
   domain finishing, instead of everything resolving in one lump at the
   very end. */

const migrationKey = (userId) => `migrated_${userId}`;

/* Each step's weight is equal; the final "saving to your device" step
   (the local SQLite write) is included so the bar does not sit at a
   false 100% while the write is still happening. */
const MIGRATION_STEPS = [
  {
    key: 'subjects',
    label: 'Subjects',
    fetch: (userId) =>
      fbLoadUserSubjects(userId, { includeArchived: true }),
  },
  {
    key: 'tasksBySubject',
    label: 'Tasks',
    fetch: fbLoadUserTasksBySubject,
  },
  {
    key: 'attendance',
    label: 'Attendance records',
    fetch: fbLoadUserAttendance,
  },
  {
    key: 'classSchedules',
    label: 'Class schedules',
    fetch: fbLoadUserClassSchedules,
  },
  {
    key: 'dateSheets',
    label: 'Date sheets',
    fetch: fbLoadUserDateSheets,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    fetch: fbLoadUserNotifications,
  },
  {
    key: 'profile',
    label: 'Profile',
    fetch: fbGetUserById,
  },
  {
    key: 'settings',
    label: 'Settings',
    fetch: fbLoadUserSettings,
  },
];

const TOTAL_STEPS = MIGRATION_STEPS.length + 1;

export const isLocalDataMigrated = async (userId) => {
  if (!userId) {
    return false;
  }

  const flag = await getMeta(migrationKey(userId));

  return flag === 'true';
};

/* Fresh sign-ups have nothing to pull - Firebase only has the empty
   account that was just created. Skip the network round trip entirely
   and mark the device as migrated so local storage is used from the
   first screen onward, exactly like any other already-migrated user. */
export const markMigratedWithoutFetch = async (userId) => {
  if (!userId) {
    return { migrated: false, reason: 'no-user' };
  }

  await setMeta(migrationKey(userId), 'true');

  return { migrated: false, skipped: true };
};

/* Returns:
   { migrated: true }                         - pulled from Firebase and seeded local
   { migrated: false, alreadyDone: true }      - nothing to do, already migrated
   { migrated: false, reason: 'offline' }      - needs a retry once online
   { migrated: false, reason: 'error', error } - unexpected failure, safe to retry

   onProgress(step), when passed, is called after every fetch and after
   the final local save with:
   { fraction, completed, total, label, phase: 'fetching' | 'saving' | 'done' } */
export const ensureLocalDataMigrated = async (userId, onProgress) => {
  if (!userId) {
    return { migrated: false, reason: 'no-user' };
  }

  const report = (completed, label, phase) => {
    onProgress?.({
      fraction: completed / TOTAL_STEPS,
      completed,
      total: TOTAL_STEPS,
      label,
      phase,
    });
  };

  if (await isLocalDataMigrated(userId)) {
    report(TOTAL_STEPS, 'Already up to date', 'done');
    return { migrated: false, alreadyDone: true };
  }

  /* Defensive: if this device somehow already has local rows for this
     user (e.g. the flag write was interrupted after a previous
     successful migration), do not clobber them - just mark it done. */
  if (await hasLocalData(userId)) {
    await setMeta(migrationKey(userId), 'true');
    report(TOTAL_STEPS, 'Already up to date', 'done');
    return { migrated: false, alreadyHadLocalData: true };
  }

  const snapshot = {};
  let completed = 0;

  try {
    for (const step of MIGRATION_STEPS) {
      snapshot[step.key] = await step.fetch(userId);
      completed += 1;
      report(completed, step.label, 'fetching');
    }

    report(completed, 'Saving to your device', 'saving');

    await replaceUserSnapshot(userId, snapshot);

    completed += 1;

    await setMeta(migrationKey(userId), 'true');

    report(completed, 'Done', 'done');

    return { migrated: true };
  } catch (error) {
    console.log(error);

    const reason =
      error?.message?.toLowerCase?.().includes('network') ||
      error?.message === 'Failed to fetch'
        ? 'offline'
        : 'error';

    return { migrated: false, reason, error };
  }
};
