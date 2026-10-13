/* DATA CHANGE EVENTS
   A tiny in-memory pub/sub so screens can react the instant local data
   changes, instead of relying on network polling (there is no network
   involved any more) or a navigation focus event (this app swaps screens
   inside App.js rather than using a stack navigator, so there is no
   built-in "screen focus" hook to lean on).

   Every local write in utils/localData.js emits one of these after the
   SQLite write commits. Screens that show a domain's data subscribe and
   silently reload from the (already fast, local) database. */

const listeners = new Set();

export const DATA_DOMAINS = {
  SUBJECTS: 'subjects',
  TASKS: 'tasks',
  ATTENDANCE: 'attendance',
  CLASS_SCHEDULES: 'classSchedules',
  DATE_SHEETS: 'dateSheets',
  NOTIFICATIONS: 'notifications',
  PROFILE: 'profile',
  SETTINGS: 'settings',
};

export const onDataChanged = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const emitDataChanged = (domain, userId) => {
  listeners.forEach((listener) => {
    try {
      listener({ domain, userId });
    } catch (error) {
      console.log(error);
    }
  });
};
