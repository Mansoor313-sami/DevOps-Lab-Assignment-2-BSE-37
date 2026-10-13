import * as Notifications from 'expo-notifications';

import * as Device from 'expo-device';

import { Platform } from 'react-native';

import {
  addUserNotification,
  deleteUserNotificationsByIds,
  loadUserSettings,
} from './localData';

/* HANDLER */

Notifications.setNotificationHandler({

  handleNotification: async () => ({

    shouldShowBanner: true,

    shouldShowList: true,

    shouldShowAlert: true,

    shouldPlaySound: true,

    shouldSetBadge: false,

  }),

});

export const NOTIFICATION_TONES = [
  { id: 'default', label: 'Device default', description: 'Use the notification tone selected on this phone.' },
  { id: 'calm', label: 'QuizMate Calm', description: 'A soft two-note chime for routine reminders.' },
  { id: 'focus', label: 'QuizMate Focus', description: 'A clear three-note pattern for study tasks.' },
  { id: 'urgent', label: 'QuizMate Urgent', description: 'A distinct four-note alert for time-sensitive reminders.' },
  { id: 'custom', label: 'Custom device tone', description: 'Choose any tone installed on your phone in notification settings.' },
  { id: 'silent', label: 'Vibrate only', description: 'No notification sound; vibration still follows your selected mode.' },
];

const TONE_FILES = {
  calm: 'quizmate_calm.wav',
  focus: 'quizmate_focus.wav',
  urgent: 'quizmate_urgent.wav',
};

export const VIBRATION_MODES = [
  { id: 'short', label: 'Short', pattern: [0, 140] },
  { id: 'medium', label: 'Medium', pattern: [0, 180, 110, 180] },
  { id: 'long', label: 'Long', pattern: [0, 320, 130, 320, 130, 320] },
];

const CHANNELS = {
  default: { name: 'QuizMate alerts', color: '#7C3AED' },
  deadlines: { name: 'Task deadlines', color: '#5B5FEF' },
  classes: { name: 'Class reminders', color: '#0EA5A4' },
  exams: { name: 'Date sheet alerts', color: '#F97316' },
};

const normalizeNotificationPreferences = (settings = {}) => ({
  tone: NOTIFICATION_TONES.some((item) => item.id === settings.notificationTone)
    ? settings.notificationTone
    : 'default',
  vibration: VIBRATION_MODES.some((item) => item.id === settings.notificationVibration)
    ? settings.notificationVibration
    : 'medium',
});

const getVibrationPattern = (vibration) =>
  VIBRATION_MODES.find((item) => item.id === vibration)?.pattern || VIBRATION_MODES[1].pattern;

const getChannelId = (kind, preferences) =>
  `quizmate-${kind}-${preferences.tone}-${preferences.vibration}`;

const getSoundForTone = (tone) =>
  tone === 'silent'
    ? false
    : TONE_FILES[tone] || 'default';

const configureNotificationChannels = async (preferences) => {
  if (Platform.OS !== 'android') return;

  const activeChannelIds =
    new Set(
      Object.keys(CHANNELS).map((kind) => getChannelId(kind, preferences))
    );

  /* Each channel id embeds the current tone + vibration preference, so
     changing either one mints a brand new id and leaves the previous
     channel sitting on the device forever with nobody deleting it -
     channels would otherwise accumulate without bound every time the
     user changes their alert style. Sweep away any quizmate-* channel
     that no longer matches the current preference before creating the
     new ones. */
  try {
    const existingChannels =
      await Notifications.getNotificationChannelsAsync();

    for (const existing of existingChannels || []) {
      if (
        existing?.id?.startsWith('quizmate-') &&
        !activeChannelIds.has(existing.id)
      ) {
        try {
          await Notifications.deleteNotificationChannelAsync(existing.id);
        } catch (error) {
          console.log(error);
        }
      }
    }
  } catch (error) {
    console.log(error);
  }

  await Promise.all(Object.entries(CHANNELS).map(([kind, channel]) =>
    Notifications.setNotificationChannelAsync(getChannelId(kind, preferences), {
      name: `${channel.name} · ${preferences.vibration} vibration`,
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: getVibrationPattern(preferences.vibration),
      lightColor: channel.color,
      sound: preferences.tone === 'silent' ? null : getSoundForTone(preferences.tone),
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    })
  ));
};

export async function getNotificationExperience(userId = '') {
  let settings = {};
  if (userId) {
    try {
      settings = await loadUserSettings(userId);
    } catch (error) {
      console.log(error);
    }
  }
  const preferences = normalizeNotificationPreferences(settings);
  await configureNotificationChannels(preferences);
  return {
    preferences,
    sound: getSoundForTone(preferences.tone),
    channelId: (kind = 'default') => getChannelId(kind, preferences),
  };
}

/* REQUEST PERMISSION */

export async function requestNotificationPermission(preferences = {}) {

  if (Device.isDevice) {

    const { status: existingStatus } =

      await Notifications.getPermissionsAsync();

    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {

      const { status } =

        await Notifications.requestPermissionsAsync();

      finalStatus = status;
    }

    if (finalStatus !== 'granted') {

      console.log(
        'Notification permission denied'
      );

      return false;
    }
  }

/* ANDROID CHANNEL
   The real, in-use channels are created by configureNotificationChannels()
   below with ids that embed the current tone/vibration preference - every
   scheduled trigger passes one of those computed ids. The bare
   'default'/'deadlines'/'classes'/'exams' channels this block used to
   create were never referenced by anything, so they just sat there
   unused - and their sound: true was invalid besides (Android channel
   config wants a sound filename string or null, not a boolean). Removed
   rather than fixed, since nothing needs them. */

  await configureNotificationChannels(normalizeNotificationPreferences(preferences));

  return true;
}

/* TEST NOTIFICATION */

const saveNotificationHistory = async (
  userId,
  notification
) => {
  if (!userId) {
    return;
  }

  try {
    await addUserNotification(
      userId,
      notification
    );
  } catch (error) {
    console.log(error);
  }
};

const canSendNotifications = async (userId) => {
  if (!userId) {
    return true;
  }

  try {
    const settings =
      await loadUserSettings(userId);

    return (
      settings.notificationsEnabled !== false
    );
  } catch (error) {
    console.log(error);
    return true;
  }
};

export async function sendTestNotification(userId) {

  try {
    const enabled =
      await canSendNotifications(userId);

    if (!enabled) {
      return false;
    }

    const experience = await getNotificationExperience(userId);

    const title = 'QuizMate';
    const body =
      `Test alert sent with ${experience.preferences.vibration} vibration.`;

    await Notifications.scheduleNotificationAsync({

      content: {

        title,

        body,

        sound: experience.sound,
      },

      trigger: Platform.OS === 'android'
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
            repeats: false,
            channelId: experience.channelId('default'),
          }
        : null,
    });

    await saveNotificationHistory(userId, {
      type: 'default',
      title,
      message: body,
      scheduledFor: new Date().toISOString(),
    });

    return true;

  } catch (error) {

    console.log(error);
    return false;
  }
}

/* FORMAT TIME */

const convertTimeTo24Hour = (timeString) => {

  if (!timeString) {

    return {
      hours: 9,
      minutes: 0,
    };
  }

  /* Case-insensitive and tolerant of extra/odd whitespace (e.g.
     "9 pm", "9:00   PM") - the previous strict split(' ') parser only
     matched an exact "H:MM AM"/"H:MM PM" shape, so anything else (a
     different case, no minutes, stray spaces) silently produced NaN
     hours/minutes with no error at all, and the reminder that depended
     on it just never got created. */

  const match =
    String(timeString)
      .trim()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);

  const hours =
    match ? parseInt(match[1], 10) : NaN;

  const minutes =
    match && match[2] ? parseInt(match[2], 10) : 0;

  if (
    !match ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {

    console.log(
      `Could not parse reminder time "${timeString}" - defaulting to 9:00 AM.`
    );

    return {
      hours: 9,
      minutes: 0,
    };
  }

  const modifier =
    match[3] ? match[3].toUpperCase() : '';

  let finalHours = hours;

  if (
    modifier === 'PM' &&
    finalHours !== 12
  ) {

    finalHours += 12;
  }

  if (
    modifier === 'AM' &&
    finalHours === 12
  ) {

    finalHours = 0;
  }

  return {
    hours: finalHours,
    minutes,
  };
};

const parseDeadlineDate = (taskOrDeadline) => {

  const task =
    typeof taskOrDeadline === 'object' && taskOrDeadline
      ? taskOrDeadline
      : null;

  if (task?.deadlineAt) {
    const isoDate = new Date(task.deadlineAt);

    if (!Number.isNaN(isoDate.getTime())) {
      return {
        day: isoDate.getDate(),
        month: isoDate.getMonth(),
        year: isoDate.getFullYear(),
      };
    }
  }

  const deadline =
    task ? task.deadline : taskOrDeadline;

  if (typeof deadline !== 'string') {
    return null;
  }

  const parts =
    deadline.split(' ');

  const day =
    parseInt(parts[0]);

  const monthName =
    parts[1];

  const year =
    parseInt(parts[2]);

  const months = {

    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,

  };

  const month =
    months[monthName];

  if (
    Number.isNaN(day) ||
    Number.isNaN(year) ||
    month === undefined
  ) {
    return null;
  }

  return {
    day,
    month,
    year,
  };
};

export const getDeadlineDateKey = (deadline) => {

  const parsedDeadline =
    parseDeadlineDate(deadline);

  if (!parsedDeadline) {
    return null;
  }

  const {
    day,
    month,
    year,
  } = parsedDeadline;

  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const isDeadlineToday = (deadline) => {

  const parsedDeadline =
    parseDeadlineDate(deadline);

  if (!parsedDeadline) {
    return false;
  }

  const {
    day,
    month,
    year,
  } = parsedDeadline;

  const deadlineDate =
    new Date(year, month, day);

  return (
    deadlineDate.toDateString() ===
    new Date().toDateString()
  );
};

export async function sendDeadlineStartedNotification(
  taskTitle,
  subjectName = '',
  userId = ''
) {
  const enabled =
    await canSendNotifications(userId);

  if (!enabled) {
    return;
  }

  const subjectPrefix =
    subjectName
      ? `${subjectName}: `
      : '';

  const title =
    'Deadline Started';

  const body =
    `${subjectPrefix}${taskTitle} is pending today.`;

  await Notifications.scheduleNotificationAsync({

    content: {

      title,

      body,

      sound: true,
    },

    trigger: null,
  });

  await saveNotificationHistory(userId, {
    type: 'today',
    title,
    message: body,
    subjectName,
    taskTitle,
    scheduledFor: new Date().toISOString(),
  });
}

export async function sendAttendanceAlertNotification(
  userId,
  subjectName,
  absences,
  percentage,
  severity = ''
) {
  const enabled =
    await canSendNotifications(userId);

  if (!enabled) {
    return;
  }

  const title =
    severity === 'critical' ||
    absences >= 6
      ? 'Attendance Critical'
      : 'Attendance Warning';

  const body =
    `${subjectName} has ${absences} absences. Current attendance is ${percentage}%.`;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: null,
    });

    await saveNotificationHistory(userId, {
      type: absences >= 6 ? 'overdue' : 'warning',
      title,
      message: body,
      subjectName,
      scheduledFor: new Date().toISOString(),
    });
  } catch (error) {
    console.log(error);
  }
}

const normalizeReminderDate = (reminder) => {
  const date =
    reminder instanceof Date
      ? reminder
      : new Date(
          reminder?.date ||
            reminder?.dateTime ||
            reminder?.scheduledFor
        );

  return Number.isNaN(date.getTime())
    ? null
    : date;
};

const scheduleCustomReminders = async ({
  userId,
  reminders = [],
  title,
  buildBody,
  channelId,
  sound = 'default',
  type = 'upcoming',
  subjectName = '',
  taskTitle = '',
}) => {
  const notificationIds = [];
  const now = new Date();

  try {

    for (const reminder of reminders) {
      const reminderDate =
        normalizeReminderDate(reminder);

      if (!reminderDate || reminderDate <= now) {
        continue;
      }

      const body =
        typeof buildBody === 'function'
          ? buildBody(reminderDate, reminder)
          : '';

      const notificationId =
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            sound,
          },
          trigger: {
            type:
              Notifications.SchedulableTriggerInputTypes.DATE,
            date: reminderDate,
            channelId,
          },
        });

      notificationIds.push(notificationId);

      await saveNotificationHistory(userId, {
        type,
        title,
        message: body,
        subjectName,
        taskTitle,
        notificationId,
        scheduledFor: reminderDate.toISOString(),
      });
    }

    return notificationIds;

  } catch (error) {

    /* If reminder k throws, whatever was already scheduled in this
       batch must not be discarded silently - cancel it before letting
       the failure propagate, so the caller's own rollback never has to
       guess which ids are already gone. */
    await cancelTaskNotifications(notificationIds, userId);

    throw error;
  }
};

const getReminderTime = (
  weekday,
  hours,
  minutes,
  reminderMinutes = 5
) => {
  /* Work in total minutes across the whole week and reduce with modulo
     instead of a single "+= 60, -1 hour" correction - the old correction
     only ever compensated for crossing one hour boundary, so any
     reminderMinutes value of 60 or more (today's fixed option list never
     hits this, but the math should still be correct in general) could
     leave nextReminderMinutes negative. */

  const MINUTES_PER_DAY = 24 * 60;
  const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

  const startTotalMinutes =
    ((weekday - 1) * MINUTES_PER_DAY) +
    (hours * 60) +
    minutes;

  const reminderTotalMinutes =
    ((startTotalMinutes - reminderMinutes) % MINUTES_PER_WEEK +
      MINUTES_PER_WEEK) %
      MINUTES_PER_WEEK;

  const reminderWeekday =
    Math.floor(reminderTotalMinutes / MINUTES_PER_DAY) + 1;

  const minutesOfDay =
    reminderTotalMinutes % MINUTES_PER_DAY;

  return {
    weekday: reminderWeekday,
    hours: Math.floor(minutesOfDay / 60),
    minutes: minutesOfDay % 60,
  };
};

const getNextWeeklyDate = (
  weekday,
  hours,
  minutes
) => {
  const now = new Date();
  const nextDate = new Date(now);
  const currentWeekday =
    now.getDay() + 1;
  let dayDiff =
    weekday - currentWeekday;

  nextDate.setHours(hours, minutes, 0, 0);

  if (
    dayDiff < 0 ||
    (dayDiff === 0 && nextDate <= now)
  ) {
    dayDiff += 7;
  }

  nextDate.setDate(
    nextDate.getDate() + dayDiff
  );

  return nextDate;
};

export async function scheduleClassNotification(
  userId,
  subjectName,
  schedule,
  attendancePercentage = null
) {
  try {
    const enabled =
      await canSendNotifications(userId);

    if (!enabled) {
      return '';
    }

    const experience = await getNotificationExperience(userId);

    const {
      weekday,
      hours,
      minutes,
      room,
      timeLabel,
      reminderMinutes = 5,
    } = schedule;

    const reminder =
      getReminderTime(
        weekday,
        hours,
        minutes,
        reminderMinutes
      );

    const attendanceText =
      attendancePercentage === null ||
      attendancePercentage === undefined
        ? ''
        : ` Current attendance: ${attendancePercentage}%.`;

    const body =
      `Your ${subjectName} class will start in ${reminderMinutes} minutes at ${room || 'the scheduled room'}.${attendanceText}`;

    const notificationId =
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Class Reminder',
          body,
          sound: experience.sound,
        },
        trigger: {
          type:
            Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: reminder.weekday,
          hour: reminder.hours,
          minute: reminder.minutes,
          channelId: experience.channelId('classes'),
        },
      });

    await saveNotificationHistory(userId, {
      type: 'upcoming',
      title: 'Class Reminder',
      message: body,
      subjectName,
      notificationId,
      scheduledFor:
        getNextWeeklyDate(
          reminder.weekday,
          reminder.hours,
          reminder.minutes
        ).toISOString(),
      taskTitle: timeLabel || '',
    });

    return notificationId;
  } catch (error) {
    console.log(error);
    /* Empty string means reminders are deliberately unavailable/disabled;
       null means scheduling itself failed and callers should offer retry. */
    return null;
  }
}

export async function cancelClassNotifications(
  notificationIds = [],
  userId = ''
) {
  await cancelTaskNotifications(
    notificationIds,
    userId
  );
}

export async function scheduleExamNotifications(
  userId,
  paper,
  customReminders = []
) {
  const notificationIds = [];

  try {
    const enabled =
      await canSendNotifications(userId);

    if (!enabled) {
      return [];
    }

    const experience = await getNotificationExperience(userId);

    const examDate =
      new Date(paper.examDate);

    if (Number.isNaN(examDate.getTime())) {
      return notificationIds;
    }

    const paperType =
      paper.subjectType
        ? `${paper.subjectType} `
        : '';

    const dayStart =
      new Date(examDate);

    dayStart.setHours(0, 0, 0, 0);

    const fiveMinutesBefore =
      new Date(examDate);

    fiveMinutesBefore.setMinutes(
      fiveMinutesBefore.getMinutes() - 5
    );

    const now = new Date();

    if (dayStart > now) {
      const dayTitle =
        'Paper Day Started';

      const dayBody =
        `${paper.subjectName} ${paperType}paper is today at ${paper.timeLabel} in ${paper.room}.`;

      const dayNotificationId =
        await Notifications.scheduleNotificationAsync({
          content: {
            title: dayTitle,
            body: dayBody,
            sound: experience.sound,
          },
          trigger: {
            type:
              Notifications.SchedulableTriggerInputTypes.DATE,
            date: dayStart,
            channelId: experience.channelId('exams'),
          },
        });

      notificationIds.push(
        dayNotificationId
      );

      await saveNotificationHistory(userId, {
        type: 'today',
        title: dayTitle,
        message: dayBody,
        subjectName: paper.subjectName,
        notificationId: dayNotificationId,
        scheduledFor: dayStart.toISOString(),
      });
    }

    /* Do not emit an immediate paper-day alert for a paper added or edited
       today. Re-saving the form must never create repeated notifications. */

    if (fiveMinutesBefore > now) {
      const reminderTitle =
        'Paper Reminder';

      const reminderBody =
        `${paper.subjectName} ${paperType}paper will start in 5 minutes at ${paper.room}.`;

      const reminderNotificationId =
        await Notifications.scheduleNotificationAsync({
          content: {
            title: reminderTitle,
            body: reminderBody,
            sound: experience.sound,
          },
          trigger: {
            type:
              Notifications.SchedulableTriggerInputTypes.DATE,
            date: fiveMinutesBefore,
            channelId: experience.channelId('exams'),
          },
        });

      notificationIds.push(
        reminderNotificationId
      );

      await saveNotificationHistory(userId, {
        type: 'upcoming',
        title: reminderTitle,
        message: reminderBody,
        subjectName: paper.subjectName,
        notificationId:
          reminderNotificationId,
        scheduledFor:
          fiveMinutesBefore.toISOString(),
      });
    }

    const customIds =
      await scheduleCustomReminders({
        userId,
        reminders: customReminders,
        title: 'Paper Reminder',
        channelId: experience.channelId('exams'),
        sound: experience.sound,
        type: 'upcoming',
        subjectName: paper.subjectName,
        taskTitle: `${paper.subjectName} Paper`,
        buildBody: () =>
          `${paper.subjectName} ${paperType}paper reminder: paper is scheduled at ${paper.timeLabel} in ${paper.room}.`,
      });

    notificationIds.push(...customIds);

    return notificationIds;
  } catch (error) {
    console.log(error);
    await cancelExamNotifications(notificationIds, userId);
    return null;
  }
}

export async function cancelExamNotifications(
  notificationIds = [],
  userId = ''
) {
  await cancelTaskNotifications(
    notificationIds,
    userId
  );
}

/* AUTOMATIC TASK DEADLINE NOTIFICATION */

export async function scheduleTaskNotification(

  taskTitle,
  deadline,
  time = '',
  subjectName = '',
  userId = '',
  customReminders = []
) {

  /* Declared outside the try block, like scheduleExamNotifications does,
     so the catch below can see and roll back whatever this call already
     scheduled before a later step failed - the old catch just returned
     [], discarding every already-minted id, which left those OS
     notifications permanently uncancellable. */
  const notificationIds = [];

  try {
    const enabled =
      await canSendNotifications(userId);

    if (!enabled) {
      return [];
    }

    const experience = await getNotificationExperience(userId);

    const subjectPrefix =
      subjectName
        ? `${subjectName}: `
        : '';

    /* DATE FORMAT:
       25 May 2026
    */

    const parsedDeadline =
      parseDeadlineDate(deadline);

    const deadlineLabel =
      typeof deadline === 'object'
        ? deadline.deadline || ''
        : deadline;

    if (!parsedDeadline) {
      return notificationIds;
    }

    if (customReminders.length > 0) {
      const customIds =
        await scheduleCustomReminders({
          userId,
          reminders: customReminders,
          title: 'Task Reminder',
          channelId: experience.channelId('deadlines'),
          sound: experience.sound,
          type: 'upcoming',
          subjectName,
          taskTitle,
          buildBody: () =>
            `${subjectPrefix}${taskTitle} reminder. Deadline: ${deadlineLabel}${time ? ` at ${time}` : ''}.`,
        });

      notificationIds.push(...customIds);
    }

    const {
      day,
      month,
      year,
    } = parsedDeadline;

    /* TIME */

    const {
      hours,
      minutes,
    } =
      convertTimeTo24Hour(
        time
      );

    /* MAIN DEADLINE DATE */

    const deadlineDate =
      new Date(
        year,
        month,
        day,
        hours,
        minutes,
        0
      );

    /* START OF DEADLINE DAY */

    const deadlineStartDate =
      new Date(
        year,
        month,
        day,
        0,
        0,
        0
      );

    const now =
      new Date();

    /* ONE DAY BEFORE */

    const reminderDate =
      new Date(deadlineDate);

    reminderDate.setDate(
      reminderDate.getDate() - 1
    );

    /* REMINDER TIME */

    reminderDate.setHours(
      9
    );

    reminderDate.setMinutes(
      0
    );

    /* TOMORROW REMINDER */

    if (
      customReminders.length === 0 &&
      reminderDate > new Date()
    ) {

      const reminderId =
        await Notifications.scheduleNotificationAsync({

        content: {

          title:
            'Upcoming Deadline',

          body:
            `${subjectPrefix}${taskTitle} is due tomorrow.`,

          sound: experience.sound,
        },

        trigger: {
          type:
            Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminderDate,
          channelId: experience.channelId('deadlines'),
        },
      });

      notificationIds.push(reminderId);

      await saveNotificationHistory(userId, {
        type: 'upcoming',
        title: 'Upcoming Deadline',
        message:
          `${subjectPrefix}${taskTitle} is due tomorrow.`,
        subjectName,
        taskTitle,
        notificationId: reminderId,
        scheduledFor:
          reminderDate.toISOString(),
      });
    }

    /* DEADLINE DAY START ALERT
       Skip entirely once the deadline day has already begun (including
       today), rather than firing an immediate trigger: null notification.
       That immediate-fire branch used to mean re-saving the same task
       three times sent three duplicate "Deadline Started" alerts, and
       turning notifications back on with several tasks already due today
       fired all of them at once. Mirrors the identical guard the paper-day
       alert above already uses ("Do not emit an immediate paper-day alert
       for a paper added or edited today"). */

    if (
      customReminders.length === 0 &&
      deadlineStartDate > now
    ) {

      const startAlertId =
        await Notifications.scheduleNotificationAsync({

          content: {

            title:
              'Deadline Started',

            body:
              `${subjectPrefix}${taskTitle} is pending today.`,

            sound: experience.sound,
          },

          trigger: {
            type:
              Notifications.SchedulableTriggerInputTypes.DATE,
            date: deadlineStartDate,
            channelId: experience.channelId('deadlines'),
          },
        });

      notificationIds.push(startAlertId);

      await saveNotificationHistory(userId, {
        type: 'today',
        title: 'Deadline Started',
        message:
          `${subjectPrefix}${taskTitle} is pending today.`,
        subjectName,
        taskTitle,
        notificationId: startAlertId,
        scheduledFor:
          deadlineStartDate.toISOString(),
      });
    }

    /* EXACT TIME NOTIFICATION */

    if (
      customReminders.length === 0 &&
      time &&
      deadlineDate > new Date()
    ) {

      const exactAlertId =
        await Notifications.scheduleNotificationAsync({

        content: {

          title:
            'Task Deadline',

          body:
            `${subjectPrefix}${taskTitle} deadline is now.`,

          sound: experience.sound,
        },

        trigger: {
          type:
            Notifications.SchedulableTriggerInputTypes.DATE,
          date: deadlineDate,
          channelId: experience.channelId('deadlines'),
        },
      });

      notificationIds.push(exactAlertId);

      await saveNotificationHistory(userId, {
        type: 'default',
        title: 'Task Deadline',
        message:
          `${subjectPrefix}${taskTitle} deadline is now.`,
        subjectName,
        taskTitle,
        notificationId: exactAlertId,
        scheduledFor:
          deadlineDate.toISOString(),
      });
    }

    return notificationIds;

  } catch (error) {

    console.log(error);

    /* Roll back whatever this call already scheduled instead of just
       discarding the ids - otherwise those notifications keep existing
       on the device with nothing left able to cancel them, and they
       still fire after the task itself is deleted. */
    await cancelTaskNotifications(notificationIds, userId);

    return null;
  }
}

/* CANCEL TASK NOTIFICATIONS */

export async function cancelTaskNotifications(
  notificationIds = [],
  userId = ''
) {

  /* Each cancellation gets its own try/catch so one stale/already
     cancelled id (common after a restore) cannot abort the rest of the
     batch - the previous single shared try/catch meant one bad id
     silently stopped every remaining cancellation AND the history
     cleanup below, leaving callers to think everything succeeded. */

  for (const notificationId of notificationIds) {

    try {

      await Notifications.cancelScheduledNotificationAsync(
        notificationId
      );

    } catch (error) {

      console.log(error);
    }
  }

  if (userId) {

    try {

      await deleteUserNotificationsByIds(
        userId,
        notificationIds
      );

    } catch (error) {

      console.log(error);
    }
  }
}

/* CLEAR ALL NOTIFICATIONS */

export async function clearAllNotifications() {

  try {

    await Notifications.cancelAllScheduledNotificationsAsync();

    return true;

  } catch (error) {

    console.log(error);

    return false;
  }
}
