import { saveUserDateSheets } from './localData';
import { cancelExamNotifications, scheduleExamNotifications } from './notifications';

export const sortPapers = (papers = []) => [...papers].sort(
  (first, second) => new Date(first.examDate) - new Date(second.examDate)
);

/* Paper data is written first. Native alerts are a recoverable second step,
   so a failed Firebase request can never leave an invisible paper reminder. */
export const persistPaperReminders = async ({ userId, papers, paper }) => {
  const pendingPaper = {
    ...paper,
    reminderSyncPending: paper.isArchived !== true,
  };
  const pendingPapers = sortPapers(papers.map((item) =>
    item.id === paper.id ? pendingPaper : item
  ));

  await saveUserDateSheets(userId, pendingPapers);

  const previousIds = paper.notificationIds || [];
  const shouldSchedule = paper.isArchived !== true;

  try {
    if (previousIds.length) await cancelExamNotifications(previousIds, userId);
    const notificationIds = shouldSchedule
      ? await scheduleExamNotifications(userId, pendingPaper, pendingPaper.customReminders || [])
      : [];
    if (notificationIds === null) throw new Error('Exam reminders could not be scheduled.');

    const syncedPaper = {
      ...pendingPaper,
      notificationIds,
      reminderSyncPending: false,
    };
    const syncedPapers = sortPapers(pendingPapers.map((item) =>
      item.id === paper.id ? syncedPaper : item
    ));
    await saveUserDateSheets(userId, syncedPapers);
    return { papers: syncedPapers, reminderSyncFailed: false };
  } catch (error) {
    return { papers: pendingPapers, reminderSyncFailed: true, error };
  }
};
