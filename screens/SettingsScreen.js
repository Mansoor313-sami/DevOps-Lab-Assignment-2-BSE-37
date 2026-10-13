import React, {
  useState,
  useEffect,
  useRef,
} from 'react';

import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  AccessibilityInfo,
  Animated,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import AsyncStorage from '@react-native-async-storage/async-storage';

import COLORS from '../constants/colors';

import {
  CARD_RADIUS,
  HEADER_TOP_PADDING,
  MAX_CONTENT_WIDTH,
  SCREEN_BOTTOM_PADDING,
  SCREEN_PADDING,
  SHADOW,
  useResponsive,
} from '../constants/layout';

import {
  getAppVersion,
} from '../utils/appInfo';

import {
  useTheme,
} from '../context/ThemeContext';

import {
  useToast,
} from '../context/ToastContext';

import {
  authenticateBiometric,
  getBiometricCapability,
  isAppLockEnabled,
  setAppLockEnabled,
} from '../utils/biometrics';

import {
  clearQuickUnlock,
  getQuickUnlock,
  saveQuickUnlock,
} from '../utils/quickUnlock';

/* NOTIFICATIONS */

import {
  cancelClassNotifications,
  cancelExamNotifications,
  cancelTaskNotifications,
  clearAllNotifications,
  NOTIFICATION_TONES,
  requestNotificationPermission,
  sendTestNotification,
  VIBRATION_MODES,
} from '../utils/notifications';

import {
  deleteUserAccount,
} from '../utils/firebaseRest';

import {
  getUserById,
  loadAllUserTasks,
  loadUserDateSheets,
  loadUserClassSchedules,
  loadUserSettings,
  updateUserProfile,
  updateUserSettings,
  wipeAllUserData,
  wipeSemesterData,
} from '../utils/localData';

import {
  backupUserData,
  getLastBackupAt,
  restoreUserData,
} from '../utils/backupRestore';

import {
  DATA_DOMAINS,
  onDataChanged,
} from '../utils/dataEvents';

import {
  rebuildUserReminders,
} from '../utils/reminderSync';

import {
  getWidgetThemePreference,
  setWidgetThemePreference,
} from '../utils/widgetBridge';

const APP_VERSION = getAppVersion();

const WIDGET_THEME_OPTIONS = [
  {
    id: 'system',
    label: 'System',
    description: 'Dynamic colors on Android 12+',
    icon: 'palette',
  },
  {
    id: 'light',
    label: 'Light',
    description: 'Always bright',
    icon: 'light-mode',
  },
  {
    id: 'dark',
    label: 'Dark',
    description: 'Always dark',
    icon: 'dark-mode',
  },
  {
    id: 'dim',
    label: 'Dim',
    description: 'Softer night surface',
    icon: 'bedtime',
  },
];

export default function SettingsScreen({
  goBack,
  canGoBack,
  onLogout,
  currentUser,
  onUserUpdate,
  navigateTo,
}) {

  const {
    colors,
    isDarkMode,
    toggleTheme,
  } = useTheme();

  const responsive = useResponsive();

  const {
    showError,
    showSuccess,
    requestPermission,
  } = useToast();

  /* STATES */

  const [userName, setUserName] =
    useState('');

  const [profileImage, setProfileImage] =
    useState(currentUser?.profileImage || '');

  const [tempName, setTempName] =
    useState('');

  const [nameModalVisible, setNameModalVisible] =
    useState(false);

  const [confirmVisible, setConfirmVisible] =
    useState(false);

  const [deleteConfirmVisible, setDeleteConfirmVisible] =
    useState(false);

  const [logoutConfirmVisible, setLogoutConfirmVisible] =
    useState(false);

  const [privacyVisible, setPrivacyVisible] =
    useState(false);

  const [notificationsEnabled, setNotificationsEnabled] =
    useState(true);

  const [notificationsLoaded, setNotificationsLoaded] =
    useState(false);

  const [notificationTone, setNotificationTone] =
    useState('default');

  const [notificationVibration, setNotificationVibration] =
    useState('medium');

  const [isSavingNotificationExperience, setIsSavingNotificationExperience] =
    useState(false);

  const [isSendingTestAlert, setIsSendingTestAlert] =
    useState(false);

  const [widgetThemeMode, setWidgetThemeMode] =
    useState('system');

  const [isSavingWidgetTheme, setIsSavingWidgetTheme] =
    useState(false);

  const [resetConfirmation, setResetConfirmation] =
    useState('');

  const [deleteConfirmation, setDeleteConfirmation] =
    useState('');

  const [isSavingName, setIsSavingName] =
    useState(false);

  const [isTogglingNotifications, setIsTogglingNotifications] =
    useState(false);

  const [isResettingData, setIsResettingData] =
    useState(false);

  const [isDeletingAccount, setIsDeletingAccount] =
    useState(false);

  const [isBackingUp, setIsBackingUp] =
    useState(false);

  const [isRestoring, setIsRestoring] =
    useState(false);

  const [lastBackupAt, setLastBackupAt] =
    useState(null);

  const [restoreConfirmVisible, setRestoreConfirmVisible] =
    useState(false);

  const [nameError, setNameError] =
    useState('');

  const heroFloat = useRef(new Animated.Value(0)).current;
  const profileEntrance = useRef(new Animated.Value(0)).current;
  const prefsSectionAnim = useRef(new Animated.Value(0)).current;
  const privacySectionAnim = useRef(new Animated.Value(0)).current;
  const aboutSectionAnim = useRef(new Animated.Value(0)).current;

  /* NAME PROMPT GUARD
     The settings-load effect below reopens the "enter your name" modal
     whenever the current user has no name, and it re-runs on every
     PROFILE/SETTINGS change event - including the ones a destructive
     flow (account deletion, semester reset) fires while wiping data.
     These refs stop the prompt from popping up on top of that flow and
     from reappearing more than once per session. */
  const suppressNamePromptRef = useRef(false);
  const nameModalShownRef = useRef(false);

  /* BACKUP TIMESTAMP
     Read once on open so "Last backed up ..." reflects reality
     immediately, no network involved - it is just a local flag. */
  useEffect(() => {
    let active = true;

    if (currentUser?.id) {
      getLastBackupAt(currentUser.id).then((value) => {
        if (active) {
          setLastBackupAt(value);
        }
      });
    }

    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    let active = true;
    let loop;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!active) return;

        if (reduceMotion) {
          profileEntrance.setValue(1);
          prefsSectionAnim.setValue(1);
          privacySectionAnim.setValue(1);
          aboutSectionAnim.setValue(1);
          return;
        }

        Animated.spring(profileEntrance, {
          toValue: 1,
          friction: 8,
          tension: 52,
          useNativeDriver: true,
        }).start();

        [prefsSectionAnim, privacySectionAnim, aboutSectionAnim]
          .forEach((anim, index) => {
            Animated.timing(anim, {
              toValue: 1,
              duration: 420,
              delay: 120 + index * 90,
              useNativeDriver: true,
            }).start();
          });

        loop = Animated.loop(Animated.sequence([
          Animated.timing(heroFloat, {
            toValue: 1,
            duration: 2200,
            useNativeDriver: true,
          }),
          Animated.timing(heroFloat, {
            toValue: 0,
            duration: 2200,
            useNativeDriver: true,
          }),
        ]));
        loop.start();
      })
      .catch(() => {
        profileEntrance.setValue(1);
        prefsSectionAnim.setValue(1);
        privacySectionAnim.setValue(1);
        aboutSectionAnim.setValue(1);
      });

    return () => {
      active = false;
      loop?.stop();
    };
  }, [heroFloat, profileEntrance]);

  const sectionEntranceStyle = (anim) => ({
    opacity: anim,
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [16, 0],
        }),
      },
    ],
  });

  /* APP LOCK */

  const [biometricInfo, setBiometricInfo] =
    useState(null);

  const [appLockEnabled, setAppLockState] =
    useState(false);

  const [isTogglingAppLock, setIsTogglingAppLock] =
    useState(false);

  const [quickUnlockEnabled, setQuickUnlockState] =
    useState(false);

  const [isTogglingQuickUnlock, setIsTogglingQuickUnlock] =
    useState(false);

  useEffect(() => {

    let cancelled = false;

    getBiometricCapability().then((info) => {
      if (!cancelled) {
        setBiometricInfo(info);
      }
    });

    isAppLockEnabled().then((enabled) => {
      if (!cancelled) {
        setAppLockState(enabled);
      }
    });

    getQuickUnlock().then((record) => {
      if (!cancelled) {
        setQuickUnlockState(Boolean(record));
      }
    });

    return () => {
      cancelled = true;
    };

  }, []);

  /* QUICK UNLOCK
     Stores the Firebase refresh token in the device keystore so
     the login screen can offer a fingerprint instead of a
     password. Enabling it needs a scan first. */

  const toggleQuickUnlock = async (nextValue) => {

    if (isTogglingQuickUnlock) {
      return;
    }

    setIsTogglingQuickUnlock(true);

    try {

      if (!nextValue) {

        await clearQuickUnlock();

        setQuickUnlockState(false);

        showSuccess(
          'Quick Unlock turned off and removed from this device.'
        );

        return;
      }

      if (!currentUser?.refreshToken) {

        showError(
          'Please sign out and sign in once, then turn this on again.'
        );

        return;
      }

      const result =
        await authenticateBiometric({
          promptMessage: 'Confirm to turn on Quick Unlock',
        });

      if (!result.success) {

        showError(
          'Quick Unlock was not turned on because the scan was cancelled.'
        );

        return;
      }

      const saved =
        await saveQuickUnlock(currentUser);

      if (!saved) {
        throw new Error('save failed');
      }

      setQuickUnlockState(true);

      showSuccess(
        `Quick Unlock is on. Next time you can sign in with ${biometricInfo?.label?.toLowerCase() || 'biometrics'}.`
      );

    } catch (error) {

      console.log(error);

      showError(
        'Could not update Quick Unlock. Please try again.'
      );

    } finally {

      setIsTogglingQuickUnlock(false);
    }
  };

  /* Turning the lock ON asks for a scan first, so nobody can
     enable a lock they cannot themselves open. */

  const toggleAppLock = async (nextValue) => {

    if (isTogglingAppLock) {
      return;
    }

    setIsTogglingAppLock(true);

    try {

      /* Disabling needs proof too, not just enabling - otherwise anyone
         holding an already-unlocked phone could turn the lock off
         permanently with no scan at all, which defeats the point of
         having it. */
      const result =
        await authenticateBiometric({
          promptMessage: nextValue
            ? 'Confirm to turn on App Lock'
            : 'Confirm to turn off App Lock',
        });

      if (!result.success) {

        showError(
          nextValue
            ? 'App Lock was not turned on because the scan was cancelled.'
            : 'App Lock was not turned off because the scan was cancelled.'
        );

        return;
      }

      const saved =
        await setAppLockEnabled(nextValue);

      if (!saved) {
        throw new Error('save failed');
      }

      setAppLockState(nextValue);

      showSuccess(
        nextValue
          ? 'App Lock is on. QuizMate will ask to unlock when you reopen it.'
          : 'App Lock is off.'
      );

    } catch (error) {

      console.log(error);

      showError(
        'Could not update App Lock. Please try again.'
      );

    } finally {

      setIsTogglingAppLock(false);
    }
  };

  /* LOAD */

  useEffect(() => {

    loadSettings();

  }, [currentUser]);

  useEffect(() => {

    const unsubscribe =
      onDataChanged(({ domain }) => {
        if (
          domain === DATA_DOMAINS.PROFILE ||
          domain === DATA_DOMAINS.SETTINGS
        ) {
          loadSettings();
        }
      });

    return unsubscribe;

  }, [currentUser]);

  /* LOAD SETTINGS */

  const loadSettings = async () => {

    try {

      if (!currentUser?.id) {
        return;
      }

      const [settings, freshUser, savedWidgetTheme] =
        await Promise.all([
          loadUserSettings(currentUser.id),
          getUserById(currentUser.id),
          getWidgetThemePreference(),
        ]);

      setWidgetThemeMode(savedWidgetTheme);

      /* Same source Profile screen reads from, so the picture
         shown here can never drift from the one actually saved -
         a stale cached currentUser prop is not trusted alone. */

      setProfileImage(freshUser?.profileImage || '');

      if (currentUser.name) {

        setUserName(currentUser.name);

      } else if (
        !suppressNamePromptRef.current &&
        !nameModalShownRef.current
      ) {

        nameModalShownRef.current = true;

        setNameModalVisible(true);
      }

      /* NOTIFICATIONS */

      if (
        settings.notificationsEnabled !==
        undefined
      ) {

        setNotificationsEnabled(
          settings.notificationsEnabled
        );
      }

      if (NOTIFICATION_TONES.some((item) => item.id === settings.notificationTone)) {
        setNotificationTone(settings.notificationTone);
      }

      if (VIBRATION_MODES.some((item) => item.id === settings.notificationVibration)) {
        setNotificationVibration(settings.notificationVibration);
      }

      setNotificationsLoaded(true);

    } catch (error) {

      console.log(error);

      showError(
        'Could not load your settings right now.'
      );
    }
  };

  /* SAVE NAME */

  const saveName = async () => {

    if (isSavingName) {
      return;
    }

    if (tempName.trim() === '') {
      setNameError('Please enter your name to continue.');
      return;
    }

    setNameError('');

    setIsSavingName(true);

    try {

      await updateUserProfile(
        currentUser.id,
        {
          name: tempName.trim(),
        }
      );

      const updatedUser = {
        ...currentUser,
        name: tempName.trim(),
      };

      /* The server save comes first. A local cache must never claim that a
         name changed when the profile write was rejected or interrupted. */
      await AsyncStorage.setItem(
        'userName',
        tempName.trim()
      );

      await AsyncStorage.setItem(
        'currentUser',
        JSON.stringify(updatedUser)
      );

      setUserName(
        tempName.trim()
      );

      onUserUpdate?.(updatedUser);

      setNameModalVisible(false);

      showSuccess('Name saved.');

    } catch (error) {

      console.log(error);

      showError(
        'Could not save your name. Please check your connection and try again.'
      );

    } finally {

      setIsSavingName(false);
    }
  };

  /* TOGGLE NOTIFICATIONS */

  const toggleNotifications = async () => {

    if (isTogglingNotifications) {
      return;
    }

    setIsTogglingNotifications(true);

    const previousValue = notificationsEnabled;
    let remoteChanged = false;

    try {
      const newValue = !notificationsEnabled;

      if (!newValue) {
        /* Persist the off state before touching any native reminder. The
           old order cleared every reminder first and saved the setting
           second - if that save then failed, the toggle reverted, the
           database still said "enabled", but every real reminder on the
           device was already gone with nothing left to rebuild them.
           Now, if the save itself fails, nothing has been destroyed yet
           and the toggle can simply stay on. */
        await updateUserSettings(currentUser.id, {
          notificationsEnabled: false,
          remindersNeedResync: false,
        });
        await AsyncStorage.setItem('notificationsEnabled', 'false');
        setNotificationsEnabled(false);

        const cleared = await clearAllNotifications();
        if (!cleared) {
          /* The setting is already safely off - only the native cleanup
             failed, so say so instead of implying every reminder is gone. */
          showError('Notifications are off, but some device reminders could not be cleared. Try again from Settings.');
          return;
        }

        showSuccess('All QuizMate reminders were removed from this device.');
        return;
      }

      const approved = await requestPermission({
        title: 'Enable notifications?',
        message: 'QuizMate will ask your device for notification permission, then schedule your saved class, task, and paper reminders.',
        confirmLabel: 'Allow notifications',
      });

      if (!approved) {
        return;
      }

      /* Scheduling checks the remote preference, so turn that on first,
         remove any stale native ids, then rebuild from the saved app data. */
      const permissionGranted = await requestNotificationPermission({
        notificationTone,
        notificationVibration,
      });
      if (!permissionGranted) {
        throw new Error('Notification permission was not granted.');
      }

      await updateUserSettings(currentUser.id, {
        notificationsEnabled: true,
        remindersNeedResync: true,
      });
      remoteChanged = true;

      const cleared = await clearAllNotifications();
      if (!cleared) throw new Error('Could not prepare device reminders.');

      const result = await rebuildUserReminders(currentUser.id);
      const hasFailures = result.failures.length > 0;

      await updateUserSettings(currentUser.id, {
        notificationsEnabled: true,
        remindersNeedResync: hasFailures,
      });
      await AsyncStorage.setItem('notificationsEnabled', 'true');
      setNotificationsEnabled(true);

      if (hasFailures) {
        showError(
          `Notifications are on, but ${result.failures.join(', ')} could not be rebuilt. Open the relevant item and save it again.`
        );
      } else {
        showSuccess(
          result.rebuilt
            ? `${result.rebuilt} reminders rebuilt from your saved data.`
            : 'Notifications are on. There are no upcoming reminders to schedule.'
        );
      }

    } catch (error) {

      console.log(error);

      if (remoteChanged) {
        try {
          await updateUserSettings(currentUser.id, {
            notificationsEnabled: previousValue,
            remindersNeedResync: false,
          });
        } catch (rollbackError) {
          console.log(rollbackError);
        }
      }

      showError(
        'Could not update notifications. Your previous setting is still shown.'
      );

    } finally {

      setIsTogglingNotifications(false);
    }
  };

  const saveNotificationExperience = async (updates) => {

    if (!notificationsEnabled) {
      showError('Enable notifications first, then choose the tone or vibration style.');
      return;
    }

    if (isSavingNotificationExperience) {
      return;
    }

    const nextTone = updates.notificationTone || notificationTone;
    const nextVibration = updates.notificationVibration || notificationVibration;
    setIsSavingNotificationExperience(true);

    try {
      await updateUserSettings(currentUser.id, {
        notificationTone: nextTone,
        notificationVibration: nextVibration,
        remindersNeedResync: true,
      });

      setNotificationTone(nextTone);
      setNotificationVibration(nextVibration);

      const cleared = await clearAllNotifications();
      if (!cleared) {
        throw new Error('Could not refresh device reminders.');
      }

      const result = await rebuildUserReminders(currentUser.id);
      await updateUserSettings(currentUser.id, {
        remindersNeedResync: result.failures.length > 0,
      });

      showSuccess(
        result.failures.length
          ? 'Your notification preference was saved. Some reminders need a retry.'
          : nextTone === 'custom'
            ? 'Custom tone mode is ready. Open device settings below to choose your phone tone.'
            : 'Notification preference saved and upcoming reminders refreshed.'
      );
    } catch (error) {
      console.log(error);
      showError('Could not save the notification preference. Please try again.');
    } finally {
      setIsSavingNotificationExperience(false);
    }
  };

  const saveWidgetTheme = async (mode) => {

    if (
      isSavingWidgetTheme ||
      mode === widgetThemeMode
    ) {
      return;
    }

    const previousMode = widgetThemeMode;

    setWidgetThemeMode(mode);
    setIsSavingWidgetTheme(true);

    try {
      await setWidgetThemePreference(mode);
      showSuccess(`Widget appearance set to ${mode}.`);
    } catch (error) {
      console.log(error);
      setWidgetThemeMode(previousMode);
      showError('Could not update the widget appearance. Please try again.');
    } finally {
      setIsSavingWidgetTheme(false);
    }
  };

  const sendNotificationTest = async () => {

    if (!notificationsEnabled || isSendingTestAlert) {
      if (!notificationsEnabled) {
        showError('Enable notifications before sending a test alert.');
      }
      return;
    }

    const approved = await requestPermission({
      title: 'Send a test alert?',
      message: 'QuizMate will send a real device notification using your selected tone and vibration mode.',
      confirmLabel: 'Send test',
    });

    if (!approved) {
      return;
    }

    setIsSendingTestAlert(true);
    try {
      const granted = await requestNotificationPermission({
        notificationTone,
        notificationVibration,
      });
      if (!granted) {
        showError('Notification permission was not granted. Enable it in device settings and try again.');
        return;
      }

      const sent = await sendTestNotification(currentUser.id);
      if (!sent) {
        throw new Error('Test notification could not be scheduled.');
      }
      showSuccess('Test alert sent. It should arrive in about one second.');
    } catch (error) {
      console.log(error);
      showError('Could not send the test alert. Please try again.');
    } finally {
      setIsSendingTestAlert(false);
    }
  };

  const cancelUserScheduledNotifications =
    async () => {

      if (!currentUser?.id) {
        return;
      }

      const { tasks } =
        await loadAllUserTasks(
          currentUser.id
        );

      const taskNotificationIds =
        tasks.flatMap(
          (task) =>
            task.notificationIds || []
        );

      await cancelTaskNotifications(
        taskNotificationIds,
        currentUser.id
      );

      const dateSheets =
        await loadUserDateSheets(
          currentUser.id
        );

      const examNotificationIds =
        dateSheets.flatMap(
          (paper) =>
            paper.notificationIds || []
        );

      await cancelExamNotifications(
        examNotificationIds,
        currentUser.id
      );

      const classSchedules =
        await loadUserClassSchedules(
          currentUser.id
        );

      const notificationIds =
        Object.values(classSchedules).flatMap(
          (subjectSchedules) =>
            Object.values(
              subjectSchedules || {}
            ).flatMap(
              (schedule) =>
                schedule.notificationIds || []
            )
        );

      await cancelClassNotifications(
        notificationIds,
        currentUser.id
      );
    };

  /* CLOUD BACKUP */

  const handleBackupNow = async () => {

    if (isBackingUp || !currentUser?.id) {
      return;
    }

    setIsBackingUp(true);

    try {

      const result = await backupUserData(currentUser.id);

      if (result.success) {
        setLastBackupAt(result.backedUpAt);
        showSuccess('Your data was backed up to the cloud.');
        return;
      }

      if (result.reason === 'offline') {
        showError('You are offline. Connect to the internet and try again.');
        return;
      }

      showError('Backup failed. Please try again.');

    } catch (error) {

      console.log(error);

      showError('Backup failed. Please try again.');

    } finally {

      setIsBackingUp(false);
    }
  };

  /* CLOUD RESTORE
     Merges the cloud backup into local storage - the newer copy of
     each subject, task, class schedule, and paper wins, so nothing
     added on this device since the last backup is thrown away. */

  const handleRestoreBackup = async () => {

    if (isRestoring || !currentUser?.id) {
      return;
    }

    setRestoreConfirmVisible(false);

    setIsRestoring(true);

    try {

      const result = await restoreUserData(currentUser.id);

      if (result.success) {
        showSuccess('Your backup was restored.');
        return;
      }

      if (result.reason === 'offline') {
        showError('You are offline. Connect to the internet and try again.');
        return;
      }

      if (result.reason === 'no-backup') {
        showError('No cloud backup was found for this account yet.');
        return;
      }

      showError('Restore failed. Please try again.');

    } catch (error) {

      console.log(error);

      showError('Restore failed. Please try again.');

    } finally {

      setIsRestoring(false);
    }
  };

  /* RESET */

  const resetSemesterData = async () => {

    if (isResettingData) {
      return;
    }

    setIsResettingData(true);

    suppressNamePromptRef.current = true;

    try {

      if (!currentUser?.id) {
        return;
      }

      await cancelUserScheduledNotifications();

      const cleared = await clearAllNotifications();
      if (!cleared) {
        throw new Error('Could not clear device reminders.');
      }

      await wipeSemesterData(
        currentUser.id
      );

      await AsyncStorage.removeItem('subjects');

      setConfirmVisible(false);

      setResetConfirmation('');

      setTempName('');

      showSuccess(
        'Subjects, tasks, attendance, timetable, papers, and alert history were cleared.'
      );

    } catch (error) {

      console.log(error);

      showError(
        'Could not reset your semester data. Please try again.'
      );

    } finally {

      setIsResettingData(false);

      suppressNamePromptRef.current = false;
    }
  };

  /* DELETE ACCOUNT */

  const deleteAccount = async () => {

    if (isDeletingAccount) {
      return;
    }

    setIsDeletingAccount(true);

    suppressNamePromptRef.current = true;

    try {

      if (!currentUser?.id) {
        return;
      }

      /* The capability probe is async and may still be in flight if this
         modal was opened moments after the screen mounted - trusting a
         possibly-null cached value here would silently skip the
         biometric gate and leave only the typed "DELETE" confirmation.
         Re-run the probe when we don't already have a resolved answer. */
      let capability = biometricInfo;

      if (capability === null) {
        capability = await getBiometricCapability();
        setBiometricInfo(capability);
      }

      if (capability?.isAvailable) {
        const confirmation = await authenticateBiometric({
          promptMessage: 'Confirm permanent QuizMate account deletion',
        });

        if (!confirmation.success) {
          showError('Account deletion was cancelled because confirmation was not completed.');
          return;
        }
      }

      /* The account itself must be gone before any local cleanup runs.
         deleteUserAccount can fail - most commonly because Firebase
         demands a fresh sign-in - and when it does, the user must stay
         fully signed in with every reminder intact rather than have
         everything silently destroyed for an account that still exists. */
      await deleteUserAccount(
        currentUser.id
      );

      try {
        await cancelUserScheduledNotifications();
      } catch (error) {
        console.log(error);
      }

      const cleared = await clearAllNotifications();
      if (!cleared) {
        console.log('Could not clear device reminders after account deletion.');
      }

      /* Local data has no reason to survive a deleted account. */
      try {
        await wipeAllUserData(currentUser.id);
      } catch (error) {
        console.log(error);
      }

      await AsyncStorage.multiRemove([
        'isLoggedIn',
        'currentUser',
        'userName',
        'subjects',
        'notificationsEnabled',
      ]);

      /* The saved refresh token must not outlive the account. */

      await clearQuickUnlock();

      await setAppLockEnabled(false);

      setDeleteConfirmVisible(false);

      setDeleteConfirmation('');

      onLogout?.();

    } catch (error) {

      console.log(error);

      const message = error?.message || '';

      if (message.includes('CREDENTIAL_TOO_OLD_LOGIN_AGAIN')) {

        showError(
          'For your security, please sign out and sign in again, then retry deleting your account.'
        );

      } else {

        showError(
          'Could not delete your account. Please check your connection and try again.'
        );
      }

    } finally {

      setIsDeletingAccount(false);

      suppressNamePromptRef.current = false;
    }
  };

  /* Delete Account already clears the saved biometric login shortcut
     so it can't outlive the account. Plain Logout used to skip this,
     which meant a fingerprint could still unlock someone else's
     account on a shared device even after "logging out". */

  const logout = async () => {

    setLogoutConfirmVisible(false);

    try {
      await clearQuickUnlock();
      setQuickUnlockState(false);
    } catch (error) {
      console.log(error);
    }

    onLogout?.();
  };

  /* AVATAR */

  const avatarLetter =
    userName.length > 0

      ? userName[0].toUpperCase()

      : 'A';

  return (

    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor:
            colors.background,
        },
      ]}
    >

      <StatusBar
        backgroundColor={
          colors.background
        }
        barStyle={
          isDarkMode
            ? 'light-content'
            : 'dark-content'
        }
      />

      <View
        style={[
          styles.container,
          {
            backgroundColor:
              colors.background,
          },
        ]}
      >

        {/* HEADER */}

        <View
          style={[
            styles.header,
            {
              backgroundColor:
                isDarkMode ? colors.card : '#EEE9FF',
              borderColor:
                isDarkMode
                  ? 'rgba(165,180,252,0.14)'
                  : 'rgba(124,58,237,0.08)',
            },
          ]}
        >
          <View style={[styles.headerWaveOne, isDarkMode && styles.headerWaveDark]} />
          <View style={[styles.headerWaveTwo, isDarkMode && styles.headerWaveTwoDark]} />
          <View
            style={[
              styles.headerCurve,
              isDarkMode && styles.headerCurveDark,
              { width: responsive.width * 0.58 },
            ]}
          />
          <Animated.View
            style={[
              styles.settingsHeroIcon,
              isDarkMode && styles.settingsHeroIconDark,
              {
                transform: [{
                  translateY: heroFloat.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -7],
                  }),
                }, {
                  rotate: heroFloat.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '7deg'],
                  }),
                }],
              },
            ]}
            accessibilityElementsHidden
          >
            <MaterialIcons name="tune" size={28} color={colors.primary} />
          </Animated.View>
          <Animated.View
            style={[
              styles.heroSparkleOne,
              {
                opacity: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0.42, 1] }),
                transform: [{ rotate: '45deg' }, {
                  scale: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1.16] }),
                }],
              },
            ]}
            accessibilityElementsHidden
          />
          <Animated.View
            style={[
              styles.heroSparkleTwo,
              {
                opacity: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [1, 0.42] }),
                transform: [{ rotate: '45deg' }, {
                  translateY: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }),
                }],
              },
            ]}
            accessibilityElementsHidden
          />

          {canGoBack && (

            <Pressable
              style={({ hovered, pressed }) => [
                styles.backButton,
                {
                  backgroundColor:
                    colors.card,
                },
                hovered && styles.iconButtonHover,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={goBack}
            >
              <MaterialIcons
                name="arrow-back"
                size={26}
                color={colors.primary}
              />
            </Pressable>

          )}

          <View style={styles.titleBlock}>
            <Text
              style={[
                styles.heading,
                {
                  color: colors.primary,
                },
              ]}
            >
              Settings
            </Text>
            <Text
              style={[
                styles.heroSubtitle,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Tune your QuizMate experience
            </Text>
          </View>

        </View>

        <ScrollView

          showsVerticalScrollIndicator={false}

          contentContainerStyle={{
            paddingBottom: SCREEN_BOTTOM_PADDING,
          }}
        >

          {/* PROFILE CARD */}

          <Animated.View
            style={[
              styles.profileCard,
              {
                backgroundColor:
                  colors.card,
                borderColor:
                  isDarkMode
                    ? 'rgba(165,180,252,0.12)'
                    : 'rgba(91,95,239,0.08)',
              },
              {
                opacity: profileEntrance,
                transform: [{
                  translateY: profileEntrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                }, {
                  scale: profileEntrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                }],
              },
            ]}
          >
            <View style={[styles.profileWave, isDarkMode && styles.profileWaveDark]} />
            <View style={styles.profileSparkleOne} />

            <View
              style={[
                styles.avatarWrap,
                {
                  width: responsive.width * 0.34,
                  height: responsive.width * 0.34,
                  borderRadius: responsive.width * 0.17,
                },
                SHADOW,
              ]}
            >

              {profileImage ? (

                <Image
                  source={{ uri: profileImage }}
                  style={[
                    styles.profileImage,
                    { borderRadius: responsive.width * 0.17 },
                  ]}
                />

              ) : (

                <View
                  style={[
                    styles.avatar,
                    {
                      backgroundColor:
                        colors.primary,
                      borderRadius: responsive.width * 0.17,
                    },
                  ]}
                >

                  <Text style={styles.avatarText}>
                    {avatarLetter}
                  </Text>

                </View>

              )}

            </View>

            <Text
              style={[
                styles.name,
                {
                  color: colors.textDark,
                },
              ]}
            >
              {userName || 'Student'}
            </Text>

            <Text
              style={[
                styles.email,
                {
                  color: colors.textLight,
                },
              ]}
            >
              QuizMate User
            </Text>

          </Animated.View>

          {/* SETTINGS */}

          <Animated.View style={[styles.section, sectionEntranceStyle(prefsSectionAnim)]}>

            <Text
              style={[
                styles.sectionTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              Preferences
            </Text>

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor: colors.card,
                  borderColor: hovered
                    ? 'rgba(91,95,239,0.24)'
                    : isDarkMode
                      ? 'rgba(165,180,252,0.10)'
                      : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="switch"
              accessibilityLabel="Use dark appearance on this device"
              accessibilityState={{ checked: isDarkMode }}
              onPress={toggleTheme}
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                <MaterialIcons name={isDarkMode ? 'dark-mode' : 'light-mode'} size={22} color={colors.primary} />
              </View>
              <View style={styles.optionLeft}>
                <Text style={[styles.optionTitle, { color: colors.textDark }]}>Appearance</Text>
                <Text style={[styles.optionSubtitle, { color: colors.textLight }]}>
                  {isDarkMode ? 'Dark theme is on for this device' : 'Light theme is on for this device'}
                </Text>
              </View>
              <Switch
                value={isDarkMode}
                onValueChange={toggleTheme}
                accessibilityLabel="Use dark appearance on this device"
                thumbColor={isDarkMode ? colors.primary : '#CBD5E1'}
                trackColor={{ false: '#CBD5E1', true: '#C4B5FD' }}
              />
            </Pressable>

            {Platform.OS === 'android' && (
              <View
              style={[
                styles.notificationExperience,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.notificationExperienceHeading}>
                <View style={[styles.notificationExperienceIcon, { backgroundColor: colors.softInfo }]}>
                  <MaterialIcons name="widgets" size={20} color={colors.primary} />
                </View>
                <View style={styles.optionLeft}>
                  <Text selectable style={[styles.notificationExperienceTitle, { color: colors.textDark }]}>Home-screen widget</Text>
                  <Text selectable style={[styles.optionSubtitle, { color: colors.textLight }]}>Choose the appearance used by the Android QuizMate widget on this device.</Text>
                </View>
              </View>

              <Text selectable style={[styles.notificationExperienceLabel, { color: colors.textDark }]}>Widget appearance</Text>
              <View style={styles.notificationChoices}>
                {WIDGET_THEME_OPTIONS.map((option) => {
                  const selected = widgetThemeMode === option.id;

                  return (
                    <Pressable
                      key={option.id}
                      disabled={isSavingWidgetTheme}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: isSavingWidgetTheme }}
                      accessibilityLabel={`${option.label}. ${option.description}`}
                      onPress={() => saveWidgetTheme(option.id)}
                      style={[
                        styles.notificationChoice,
                        {
                          backgroundColor: selected ? colors.primary : colors.card,
                          borderColor: selected ? colors.primary : colors.border,
                          opacity: isSavingWidgetTheme ? 0.6 : 1,
                        },
                      ]}
                    >
                      <MaterialIcons name={option.icon} size={18} color={selected ? '#fff' : colors.primary} />
                      <View style={styles.optionLeft}>
                        <Text selectable style={[styles.notificationChoiceTitle, { color: selected ? '#fff' : colors.textDark }]}>{option.label}</Text>
                        <Text selectable style={[styles.notificationChoiceSub, { color: selected ? 'rgba(255,255,255,0.82)' : colors.textLight }]}>{option.description}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              </View>
            )}

            {/* NOTIFICATIONS */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && !isTogglingNotifications && styles.optionCardHover,
                pressed && !isTogglingNotifications && styles.buttonPressed,
              ]}
              disabled={!notificationsLoaded || isTogglingNotifications}
              accessibilityRole="switch"
              accessibilityLabel="Enable QuizMate reminders"
              accessibilityState={{ checked: notificationsEnabled, busy: isTogglingNotifications }}
              onPress={toggleNotifications}
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                <MaterialIcons name="notifications-active" size={22} color={colors.primary} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  Notifications
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  {notificationsLoaded
                    ? 'Tasks, papers, and class reminders'
                    : 'Checking saved preference...'}
                </Text>

              </View>

              {isTogglingNotifications ? (

                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                />

              ) : (

                <Switch

                  value={
                    notificationsEnabled
                  }

                  onValueChange={
                    toggleNotifications
                  }

                  disabled={!notificationsLoaded}

                  pointerEvents="none"

                  accessibilityLabel="Enable QuizMate reminders"
                  accessibilityState={{ checked: notificationsEnabled, busy: isTogglingNotifications }}

                  thumbColor={
                    notificationsEnabled

                      ? colors.primary

                      : '#CBD5E1'
                  }

                  trackColor={{
                    false: '#CBD5E1',
                    true: '#C4B5FD',
                  }}
                />

              )}

            </Pressable>

            <View
              style={[
                styles.notificationExperience,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  opacity: notificationsEnabled ? 1 : 0.58,
                },
              ]}
            >
              <View style={styles.notificationExperienceHeading}>
                <View style={[styles.notificationExperienceIcon, { backgroundColor: colors.softInfo }]}>
                  <MaterialIcons name="tune" size={20} color={colors.primary} />
                </View>
                <View style={styles.optionLeft}>
                  <Text selectable style={[styles.notificationExperienceTitle, { color: colors.textDark }]}>Alert style</Text>
                  <Text selectable style={[styles.optionSubtitle, { color: colors.textLight }]}>Applied to new class, task, and paper reminders</Text>
                </View>
              </View>

              <Text selectable style={[styles.notificationExperienceLabel, { color: colors.textDark }]}>Notification tone</Text>
              <View style={styles.notificationChoices}>
                {NOTIFICATION_TONES.map((tone) => {
                  const selected = notificationTone === tone.id;
                  return (
                    <Pressable
                      key={tone.id}
                      disabled={!notificationsEnabled || isSavingNotificationExperience}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: !notificationsEnabled || isSavingNotificationExperience }}
                      accessibilityLabel={`${tone.label}. ${tone.description}`}
                      onPress={() => saveNotificationExperience({ notificationTone: tone.id })}
                      style={[styles.notificationChoice, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}
                    >
                      <MaterialIcons name={tone.id === 'silent' ? 'vibration' : tone.id === 'custom' ? 'tune' : 'music-note'} size={18} color={selected ? '#fff' : colors.primary} />
                      <View style={styles.optionLeft}><Text selectable style={[styles.notificationChoiceTitle, { color: selected ? '#fff' : colors.textDark }]}>{tone.label}</Text><Text selectable style={[styles.notificationChoiceSub, { color: selected ? 'rgba(255,255,255,0.82)' : colors.textLight }]}>{tone.description}</Text></View>
                    </Pressable>
                  );
                })}
              </View>

              <Text selectable style={[styles.notificationExperienceLabel, { color: colors.textDark }]}>Vibration mode</Text>
              <View style={styles.vibrationChoices}>
                {VIBRATION_MODES.map((mode) => {
                  const selected = notificationVibration === mode.id;
                  return <Pressable key={mode.id} disabled={!notificationsEnabled || isSavingNotificationExperience} accessibilityRole="radio" accessibilityState={{ selected, disabled: !notificationsEnabled || isSavingNotificationExperience }} onPress={() => saveNotificationExperience({ notificationVibration: mode.id })} style={[styles.vibrationChoice, { backgroundColor: selected ? colors.primary : colors.card, borderColor: selected ? colors.primary : colors.border }]}><Text selectable style={[styles.vibrationChoiceText, { color: selected ? '#fff' : colors.textDark }]}>{mode.label}</Text></Pressable>;
                })}
              </View>

              <Pressable disabled={!notificationsEnabled || isSendingTestAlert || isSavingNotificationExperience} accessibilityRole="button" accessibilityState={{ disabled: !notificationsEnabled || isSendingTestAlert || isSavingNotificationExperience, busy: isSendingTestAlert }} onPress={sendNotificationTest} style={[styles.testAlertButton, { backgroundColor: colors.primary, opacity: !notificationsEnabled || isSavingNotificationExperience ? 0.55 : 1 }]}>
                {isSendingTestAlert ? <ActivityIndicator color="#fff" /> : <><MaterialIcons name="notifications-active" size={19} color="#fff" /><Text style={styles.testAlertText}>Send test alert</Text></>}
              </Pressable>
              <Pressable disabled={!notificationsEnabled} accessibilityRole="button" onPress={() => Linking.openSettings()} style={styles.deviceToneButton}>
                <MaterialIcons name="settings" size={17} color={colors.primary} />
                <Text selectable style={[styles.deviceToneText, { color: colors.primary }]}>Choose another device tone in Settings</Text>
              </Pressable>
            </View>

            {/* APP LOCK vs QUICK UNLOCK CLARIFIER */}

            <Text
              style={[
                styles.groupHint,
                { color: colors.textLight },
              ]}
            >
              App Lock guards this device when QuizMate reopens.
              Quick Unlock is a faster way to sign in — the two work
              independently.
            </Text>

            {/* APP LOCK */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                !biometricInfo?.isAvailable &&
                  styles.optionCardMuted,
                hovered && biometricInfo?.isAvailable && !isTogglingAppLock && styles.optionCardHover,
                pressed && biometricInfo?.isAvailable && !isTogglingAppLock && styles.buttonPressed,
              ]}
              disabled={!biometricInfo?.isAvailable || isTogglingAppLock}
              accessibilityRole="switch"
              accessibilityLabel="Require biometric unlock to open QuizMate"
              accessibilityState={{ checked: appLockEnabled, busy: isTogglingAppLock }}
              onPress={() => toggleAppLock(!appLockEnabled)}
            >
              <View style={styles.optionAccent} />
              <View
                style={[
                  styles.optionIcon,
                  {
                    backgroundColor:
                      colors.background,
                  },
                ]}
              >
                <MaterialIcons
                  name="fingerprint"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color: colors.textDark,
                    },
                  ]}
                >
                  App Lock
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color: colors.textLight,
                    },
                  ]}
                >
                  {biometricInfo?.isAvailable
                    ? `Require ${biometricInfo.label.toLowerCase()} to open QuizMate`
                    : biometricInfo?.reason ||
                      'Checking device support...'}
                </Text>

              </View>

              {isTogglingAppLock ? (

                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                />

              ) : (

                <Switch

                  accessibilityLabel="Require biometric unlock to open QuizMate"

                  disabled={
                    !biometricInfo?.isAvailable
                  }

                  value={appLockEnabled}

                  onValueChange={toggleAppLock}

                  pointerEvents="none"

                  thumbColor={
                    appLockEnabled
                      ? colors.primary
                      : '#CBD5E1'
                  }

                  trackColor={{
                    false: '#CBD5E1',
                    true: '#C4B5FD',
                  }}
                />

              )}

            </Pressable>

            {/* QUICK UNLOCK */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                !biometricInfo?.isAvailable &&
                  styles.optionCardMuted,
                hovered && biometricInfo?.isAvailable && !isTogglingQuickUnlock && styles.optionCardHover,
                pressed && biometricInfo?.isAvailable && !isTogglingQuickUnlock && styles.buttonPressed,
              ]}
              disabled={!biometricInfo?.isAvailable || isTogglingQuickUnlock}
              accessibilityRole="switch"
              accessibilityLabel="Sign in with biometrics instead of a password"
              accessibilityState={{ checked: quickUnlockEnabled, busy: isTogglingQuickUnlock }}
              onPress={() => toggleQuickUnlock(!quickUnlockEnabled)}
            >
              <View style={styles.optionAccent} />
              <View
                style={[
                  styles.optionIcon,
                  {
                    backgroundColor:
                      colors.background,
                  },
                ]}
              >
                <MaterialIcons
                  name="lock-open"
                  size={22}
                  color={colors.primary}
                />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color: colors.textDark,
                    },
                  ]}
                >
                  Quick Unlock
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color: colors.textLight,
                    },
                  ]}
                >
                  {biometricInfo?.isAvailable
                    ? `Sign in with ${biometricInfo.label.toLowerCase()} instead of your password`
                    : biometricInfo?.reason ||
                      'Checking device support...'}
                </Text>

              </View>

              {isTogglingQuickUnlock ? (

                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                />

              ) : (

                <Switch

                  accessibilityLabel="Sign in with biometrics instead of a password"

                  disabled={
                    !biometricInfo?.isAvailable
                  }

                  value={quickUnlockEnabled}

                  onValueChange={toggleQuickUnlock}

                  pointerEvents="none"

                  thumbColor={
                    quickUnlockEnabled
                      ? colors.primary
                      : '#CBD5E1'
                  }

                  trackColor={{
                    false: '#CBD5E1',
                    true: '#C4B5FD',
                  }}
                />

              )}

            </Pressable>

          </Animated.View>

          {/* PRIVACY */}

          <Animated.View style={[styles.section, sectionEntranceStyle(privacySectionAnim)]}>

            <Text
              style={[
                styles.sectionTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              Privacy & Data
            </Text>

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() =>
                setPrivacyVisible(true)
              }
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                <MaterialIcons name="privacy-tip" size={22} color={colors.primary} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  Privacy Policy
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  See what data QuizMate stores and why
                </Text>

              </View>

              <MaterialIcons
                name="chevron-right"
                size={24}
                color={colors.textLight}
              />

            </Pressable>

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(239,68,68,0.22)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => {
                setDeleteConfirmation('');
                setDeleteConfirmVisible(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Delete account permanently"
            >
              <View style={[styles.optionAccent, { backgroundColor: COLORS.danger }]} />
              <View style={[styles.optionIcon, { backgroundColor: '#FEE2E2' }]}>
                <MaterialIcons name="delete-forever" size={22} color={colors.danger} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        COLORS.danger,
                    },
                  ]}
                >
                  Delete Account
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  Permanently delete profile and saved data
                </Text>

              </View>

            </Pressable>

          </Animated.View>

          {/* ABOUT */}

          <Animated.View style={[styles.section, sectionEntranceStyle(aboutSectionAnim)]}>

            <Text
              style={[
                styles.sectionTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              About
            </Text>

            {/* VERSION */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`QuizMate version ${APP_VERSION}. Opens What's New`}
              onPress={() => navigateTo?.("What's New")}
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                <MaterialIcons name="info" size={22} color={colors.primary} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  App Version
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  QuizMate v{APP_VERSION} - Tap to see what's new
                </Text>

              </View>

              <MaterialIcons
                name="chevron-right"
                size={24}
                color={colors.textLight}
              />

            </Pressable>

            {/* CLOUD BACKUP */}

            <Pressable
              disabled={isBackingUp}
              accessibilityRole="button"
              accessibilityLabel="Back up your data to the cloud"
              accessibilityState={{ busy: isBackingUp }}
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && !isBackingUp && styles.optionCardHover,
                pressed && !isBackingUp && styles.buttonPressed,
                isBackingUp && styles.buttonDisabled,
              ]}
              onPress={handleBackupNow}
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                {isBackingUp ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <MaterialIcons name="cloud-upload" size={22} color={colors.primary} />
                )}
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  Cloud Backup
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  {isBackingUp
                    ? 'Backing up...'
                    : lastBackupAt
                      ? `Last backed up ${new Date(lastBackupAt).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })}`
                      : 'Save all your data to the cloud'}
                </Text>

              </View>

              {!isBackingUp && (
                <MaterialIcons
                  name="chevron-right"
                  size={24}
                  color={colors.textLight}
                />
              )}

            </Pressable>

            {/* CLOUD RESTORE */}

            <Pressable
              disabled={isRestoring}
              accessibilityRole="button"
              accessibilityLabel="Restore your data from the cloud backup"
              accessibilityState={{ busy: isRestoring }}
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(91,95,239,0.24)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && !isRestoring && styles.optionCardHover,
                pressed && !isRestoring && styles.buttonPressed,
                isRestoring && styles.buttonDisabled,
              ]}
              onPress={() => setRestoreConfirmVisible(true)}
            >
              <View style={styles.optionAccent} />
              <View style={[styles.optionIcon, { backgroundColor: colors.background }]}>
                {isRestoring ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <MaterialIcons name="cloud-download" size={22} color={colors.primary} />
                )}
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  Restore Backup
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  {isRestoring
                    ? 'Restoring...'
                    : 'Bring your cloud backup onto this device'}
                </Text>

              </View>

              {!isRestoring && (
                <MaterialIcons
                  name="chevron-right"
                  size={24}
                  color={colors.textLight}
                />
              )}

            </Pressable>

            {/* RESET */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(239,68,68,0.22)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => {
                setResetConfirmation('');
                setConfirmVisible(true);
              }}
            >
              <View style={[styles.optionAccent, { backgroundColor: COLORS.danger }]} />
              <View style={[styles.optionIcon, { backgroundColor: '#FEE2E2' }]}>
                <MaterialIcons name="restart-alt" size={22} color={colors.danger} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        colors.textDark,
                    },
                  ]}
                >
                  Reset Semester Data
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  Clear subjects, tasks, attendance, timetable, papers, and alerts
                </Text>

              </View>

            </Pressable>

            {/* LOGOUT */}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.optionCard,
                {
                  backgroundColor:
                    colors.card,
                  borderColor:
                    hovered
                      ? 'rgba(239,68,68,0.22)'
                      : isDarkMode
                        ? 'rgba(165,180,252,0.10)'
                        : 'rgba(91,95,239,0.07)',
                },
                hovered && styles.optionCardHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => setLogoutConfirmVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="Log out of QuizMate"
            >
              <View style={[styles.optionAccent, { backgroundColor: COLORS.danger }]} />
              <View style={[styles.optionIcon, { backgroundColor: '#FEE2E2' }]}>
                <MaterialIcons name="logout" size={22} color={colors.danger} />
              </View>

              <View style={styles.optionLeft}>

                <Text
                  style={[
                    styles.optionTitle,
                    {
                      color:
                        COLORS.danger,
                    },
                  ]}
                >
                  Logout
                </Text>

                <Text
                  style={[
                    styles.optionSubtitle,
                    {
                      color:
                        colors.textLight,
                    },
                  ]}
                >
                  Return to login screen
                </Text>

              </View>

            </Pressable>

          </Animated.View>

          {/* FOOTER */}

          <Text
            style={[
              styles.footer,
              {
                color: colors.textLight,
              },
            ]}
          >
            Made by Sami for COMSATS Students
          </Text>

        </ScrollView>

      </View>

      {/* NAME MODAL */}

      <Modal
        visible={nameModalVisible}
        transparent={true}
        animationType="fade"
      >

        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
          keyboardVerticalOffset={20}
        >

          <ScrollView
            contentContainerStyle={
              styles.modalScrollContent
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >

          <View
            style={[
              styles.modalBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <Text
              style={[
                styles.modalTitle,
                {
                  color: colors.primary,
                },
              ]}
            >
              Welcome
            </Text>

            <Text
              style={[
                styles.modalMessage,
                {
                  color: colors.textDark,
                },
              ]}
            >
              Enter your name to continue
            </Text>

            <TextInput

              placeholder="Your Name"

              placeholderTextColor={
                COLORS.textLight
              }

              style={[
                styles.input,
                {
                  backgroundColor:
                    colors.background,
                  color:
                    colors.textDark,
                },
              ]}

              value={tempName}

              onChangeText={(text) => {
                setTempName(text);
                if (nameError) {
                  setNameError('');
                }
              }}
            />

            {nameError ? (
              <Text
                style={[
                  styles.fieldError,
                  { color: colors.danger },
                ]}
              >
                {nameError}
              </Text>
            ) : null}

            <Pressable
              style={({ hovered, pressed }) => [
                styles.saveButton,
                {
                  backgroundColor:
                    colors.primary,
                },
                isSavingName && styles.buttonDisabled,
                hovered && !isSavingName && styles.primaryButtonHover,
                pressed && !isSavingName && styles.buttonPressed,
              ]}

              disabled={isSavingName}

              onPress={saveName}
            >

              {isSavingName ? (

                <View style={styles.loadingRow}>
                  <ActivityIndicator
                    size="small"
                    color="#FFFFFF"
                  />
                  <Text style={[styles.saveText, styles.loadingText]}>
                    Saving...
                  </Text>
                </View>

              ) : (

                <Text style={styles.saveText}>
                  Continue
                </Text>

              )}

            </Pressable>

          </View>

          </ScrollView>

        </KeyboardAvoidingView>

      </Modal>

      {/* PRIVACY MODAL */}

      <Modal
        visible={privacyVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() =>
          setPrivacyVisible(false)
        }
      >

        <View style={styles.modalContainer}>

          <View
            style={[
              styles.modalBox,
              styles.privacyModalBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <Text
              style={[
                styles.modalTitle,
                {
                  color: colors.primary,
                },
              ]}
            >
              Privacy Policy
            </Text>

            <ScrollView
              style={styles.privacyScroll}
              showsVerticalScrollIndicator={false}
            >
              <Text
                style={[
                  styles.privacyText,
                  {
                    color: colors.textDark,
                  },
                ]}
              >
                QuizMate stores your student account data so your subjects,
                tasks, attendance, class schedules, date sheets, profile, and
                alerts can stay available after reinstalling the app.
              </Text>

              <Text
                style={[
                  styles.privacyText,
                  {
                    color: colors.textDark,
                  },
                ]}
              >
                Data we collect: name, email, registration number, semester,
                department, phone, bio, profile picture, subjects, deadlines,
                attendance records, class schedules, date sheet papers, and
                notification history.
              </Text>

              <Text
                style={[
                  styles.privacyText,
                  {
                    color: colors.textDark,
                  },
                ]}
              >
                We use this data only to run QuizMate features. We do not sell
                student data. Contact options open WhatsApp, Gmail, Instagram,
                or Facebook only when you choose them.
              </Text>

              <Text
                style={[
                  styles.privacyText,
                  {
                    color: colors.textDark,
                  },
                ]}
              >
                You can delete your account from Settings. Deleting your
                account permanently removes your profile and saved QuizMate data
                from Firebase. Theme, App Lock, and Quick Unlock are stored only
                on this device; you can turn them off any time from Settings.
              </Text>
            </ScrollView>

            <Pressable
              style={({ hovered, pressed }) => [
                styles.saveButton,
                {
                  backgroundColor:
                    colors.primary,
                },
                hovered && styles.primaryButtonHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() =>
                setPrivacyVisible(false)
              }
            >
              <Text style={styles.saveText}>
                Close
              </Text>
            </Pressable>

          </View>

        </View>

      </Modal>

      {/* RESTORE MODAL */}

      <Modal
        visible={restoreConfirmVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          /* Always dismissible, even mid-restore - the request keeps
             running in the background regardless (its finally block
             still clears isRestoring when it settles), this just stops
             the UI from trapping the user behind a spinner if it stalls. */
          setRestoreConfirmVisible(false);
        }}
      >

        <View style={styles.modalContainer}>

          <View
            style={[
              styles.modalBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <Text
              style={[
                styles.modalTitle,
                {
                  color: colors.primary,
                },
              ]}
            >
              Restore Backup
            </Text>

            <Text
              style={[
                styles.modalMessage,
                {
                  color: colors.textDark,
                },
              ]}
            >
              This brings down your most recent cloud backup and merges it
              with what is on this device. For every subject, task, class
              schedule, and paper, whichever copy was changed more recently
              is kept, so nothing newer than the backup is lost.
            </Text>

            <View style={styles.buttonRow}>

              <Pressable
                style={({ hovered, pressed }) => [
                  styles.cancelButton,
                  hovered && styles.secondaryButtonHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => {
                  /* Always dismissible, even mid-restore - see the
                     onRequestClose comment above. */
                  setRestoreConfirmVisible(false);
                }}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                disabled={isRestoring}
                style={({ hovered, pressed }) => [
                  styles.yesButton,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                  isRestoring && styles.buttonDisabled,
                  hovered && !isRestoring && styles.primaryButtonHover,
                  pressed && !isRestoring && styles.buttonPressed,
                ]}
                onPress={handleRestoreBackup}
              >
                {isRestoring ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.yesText}>
                    Restore
                  </Text>
                )}
              </Pressable>

            </View>

          </View>

        </View>

      </Modal>

      {/* RESET MODAL */}

      <Modal
        visible={confirmVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!isResettingData) setConfirmVisible(false);
        }}
      >

        <View style={styles.modalContainer}>

          <View
            style={[
              styles.modalBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <Text
              style={[
                styles.modalTitle,
                {
                  color: colors.primary,
                },
              ]}
            >
              Reset App
            </Text>

            <Text
              style={[
                styles.modalMessage,
                {
                  color: colors.textDark,
                },
              ]}
            >
              This permanently clears subjects, tasks, attendance, class
              schedules, date sheet papers, and alert history. Your profile and
              Settings stay intact. Type RESET to continue.
            </Text>

            <TextInput
              value={resetConfirmation}
              onChangeText={setResetConfirmation}
              autoCapitalize="characters"
              placeholder="Type RESET"
              placeholderTextColor={COLORS.textLight}
              style={[styles.input, { backgroundColor: colors.background, color: colors.textDark }]}
              accessibilityLabel="Type RESET to confirm clearing semester data"
            />

            <View style={styles.buttonRow}>

              {/* CANCEL */}

              <Pressable
                disabled={isResettingData}
                style={({ hovered, pressed }) => [
                  styles.cancelButton,
                  hovered && styles.secondaryButtonHover,
                  pressed && styles.buttonPressed,
                ]}

                onPress={() => {
                  setConfirmVisible(false);
                  setResetConfirmation('');
                }}
              >

                <Text style={styles.cancelText}>
                  Cancel
                </Text>

              </Pressable>

              {/* YES */}

              <Pressable
                style={({ hovered, pressed }) => [
                  styles.yesButton,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                  isResettingData && styles.buttonDisabled,
                  resetConfirmation.trim().toUpperCase() !== 'RESET' && styles.buttonDisabled,
                  hovered && !isResettingData && styles.primaryButtonHover,
                  pressed && !isResettingData && styles.buttonPressed,
                ]}

                disabled={isResettingData || resetConfirmation.trim().toUpperCase() !== 'RESET'}

                onPress={resetSemesterData}
              >

                {isResettingData ? (

                  <View style={styles.loadingRow}>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                    <Text style={[styles.yesText, styles.loadingText]}>
                      Resetting...
                    </Text>
                  </View>

                ) : (

                  <Text style={styles.yesText}>
                    Reset data
                  </Text>

                )}

              </Pressable>

            </View>

          </View>

        </View>

      </Modal>

      {/* LOGOUT MODAL */}

      <Modal
        visible={logoutConfirmVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLogoutConfirmVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.primary }]}>Log out?</Text>
            <Text style={[styles.modalMessage, { color: colors.textDark }]}>
              You will return to the sign-in screen. Existing reminders stay on
              this device so upcoming work is not silently missed. Turn off
              Notifications first if you use a shared device.
              {quickUnlockEnabled
                ? ' Quick Unlock will also be turned off on this device.'
                : ''}
            </Text>
            <View style={styles.buttonRow}>
              <Pressable
                style={({ hovered, pressed }) => [
                  styles.cancelButton,
                  hovered && styles.secondaryButtonHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => setLogoutConfirmVisible(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ hovered, pressed }) => [
                  styles.yesButton,
                  { backgroundColor: colors.primary },
                  hovered && styles.primaryButtonHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={logout}
              >
                <Text style={styles.yesText}>Log out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* DELETE ACCOUNT MODAL */}

      <Modal
        visible={deleteConfirmVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() =>
          setDeleteConfirmVisible(false)
        }
      >

        <View style={styles.modalContainer}>

          <View
            style={[
              styles.modalBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <Text
              style={[
                styles.modalTitle,
                {
                  color: COLORS.danger,
                },
              ]}
            >
              Delete Account
            </Text>

            <Text
              style={[
                styles.modalMessage,
                {
                  color: colors.textDark,
                },
              ]}
            >
              This will permanently delete your QuizMate account, profile,
              subjects, tasks, attendance, class schedules, date sheets, and
              saved alerts. This action cannot be undone. Type DELETE to
              continue.
            </Text>

            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              placeholder="Type DELETE"
              placeholderTextColor={COLORS.textLight}
              style={[styles.input, { backgroundColor: colors.background, color: colors.textDark }]}
              accessibilityLabel="Type DELETE to confirm permanent account deletion"
            />

            <View style={styles.buttonRow}>

              <Pressable
                style={({ hovered, pressed }) => [
                  styles.cancelButton,
                  hovered && styles.secondaryButtonHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => {
                  /* Always dismissible, even mid-delete - the request
                     keeps running in the background regardless (its
                     finally block still clears isDeletingAccount when it
                     settles), this just stops the UI from trapping the
                     user behind a spinner if it stalls. */
                  setDeleteConfirmVisible(false);
                  setDeleteConfirmation('');
                }}
              >
                <Text style={styles.cancelText}>
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                style={({ hovered, pressed }) => [
                  styles.deleteButton,
                  isDeletingAccount && styles.buttonDisabled,
                  deleteConfirmation.trim().toUpperCase() !== 'DELETE' && styles.buttonDisabled,
                  hovered && !isDeletingAccount && styles.deleteButtonHover,
                  pressed && !isDeletingAccount && styles.buttonPressed,
                ]}
                disabled={isDeletingAccount || deleteConfirmation.trim().toUpperCase() !== 'DELETE'}
                onPress={deleteAccount}
              >
                {isDeletingAccount ? (

                  <View style={styles.loadingRow}>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                    <Text style={[styles.yesText, styles.loadingText]}>
                      Deleting...
                    </Text>
                  </View>

                ) : (

                  <Text style={styles.yesText}>
                    Delete account
                  </Text>

                )}
              </Pressable>

            </View>

          </View>

        </View>

      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  /* SAFE AREA */

  safeArea: {
    flex: 1,
    backgroundColor:
      COLORS.background,
  },

  /* CONTAINER */

  container: {
    flex: 1,

    backgroundColor:
      COLORS.background,

    paddingHorizontal: SCREEN_PADDING,

    paddingTop: HEADER_TOP_PADDING,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },

  /* HEADER */

  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 25,
  },

  headerWaveOne: {
    position: 'absolute',
    left: -44,
    right: -52,
    top: 34,
    height: 68,
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 190,
    transform: [{ rotate: '-7deg' }],
  },

  headerWaveDark: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },

  headerWaveTwo: {
    position: 'absolute',
    left: -36,
    right: -42,
    bottom: -20,
    height: 78,
    backgroundColor: 'rgba(221,214,254,0.48)',
    borderTopLeftRadius: 180,
    borderTopRightRadius: 120,
    transform: [{ rotate: '6deg' }],
  },

  headerWaveTwoDark: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },

  headerCurve: {
    position: 'absolute',
    right: -20,
    top: 28,
    width: 220,
    height: 44,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.14)',
    borderRadius: 130,
    transform: [{ rotate: '-13deg' }],
  },

  headerCurveDark: {
    borderColor: 'rgba(165,180,252,0.18)',
  },

  settingsHeroIcon: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  settingsHeroIconDark: {
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(165,180,252,0.14)',
  },

  heroSparkleOne: {
    position: 'absolute',
    right: 98,
    top: 22,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: 'rgba(196,181,253,0.78)',
    transform: [{ rotate: '45deg' }],
  },

  heroSparkleTwo: {
    position: 'absolute',
    right: 116,
    bottom: 24,
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor: 'rgba(250,204,21,0.62)',
    transform: [{ rotate: '45deg' }],
  },

  menuButton: {

    width: 48,

    height: 48,

    borderRadius: 16,

    backgroundColor:
      COLORS.primary,

    justifyContent: 'center',

    alignItems: 'center',

    elevation: 4,
  },

  backButton: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 48,

    height: 48,

    borderRadius: 16,

    backgroundColor:
      COLORS.white,

    justifyContent: 'center',

    alignItems: 'center',

    zIndex: 4,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  heading: {

    fontSize: 30,

    fontWeight: 'bold',

    color: COLORS.primary,

  },

  titleBlock: {
    paddingLeft: 64,
    paddingRight: 70,
    minHeight: 78,
    justifyContent: 'center',
    zIndex: 3,
  },

  heroSubtitle: {
    marginTop: 5,
    fontSize: 14,
    fontWeight: '600',
  },

  /* PROFILE */

  profileCard: {
    position: 'relative',
    backgroundColor:
      COLORS.white,

    paddingVertical: 28,

    paddingHorizontal: 20,

    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
    ...SHADOW,
  },

  profileWave: {
    position: 'absolute',
    left: -38,
    right: -48,
    bottom: -34,
    height: 98,
    backgroundColor: 'rgba(221,214,254,0.34)',
    borderTopLeftRadius: 180,
    borderTopRightRadius: 130,
    transform: [{ rotate: '5deg' }],
  },

  profileWaveDark: {
    backgroundColor: 'rgba(124,58,237,0.11)',
  },

  profileSparkleOne: {
    position: 'absolute',
    right: 46,
    top: 28,
    width: 11,
    height: 11,
    borderRadius: 4,
    backgroundColor: 'rgba(196,181,253,0.76)',
    transform: [{ rotate: '45deg' }],
  },

  avatarWrap: {
    overflow: 'hidden',
    zIndex: 2,
  },

  avatar: {

    width: '100%',

    height: '100%',

    backgroundColor:
      COLORS.primary,

    justifyContent: 'center',

    alignItems: 'center',
  },

  profileImage: {
    width: '100%',
    height: '100%',
  },

  avatarText: {

    color: COLORS.white,

    fontSize: 30,

    fontWeight: 'bold',
  },

  name: {

    marginTop: 15,

    fontSize: 21,

    fontWeight: 'bold',

    color: COLORS.textDark,

    textAlign: 'center',
    zIndex: 2,
  },

  email: {

    marginTop: 5,

    color: COLORS.textLight,

    fontSize: 14,

    textAlign: 'center',
    zIndex: 2,
  },

  /* SECTIONS */

  section: {
    marginTop: 30,
  },

  sectionTitle: {

    fontSize: 20,

    fontWeight: 'bold',

    color: COLORS.textDark,

    marginBottom: 15,
  },

  /* OPTION CARD */

  optionCard: {
    position: 'relative',
    backgroundColor:
      COLORS.white,

    padding: 18,

    borderRadius: CARD_RADIUS,

    marginBottom: 14,

    flexDirection: 'row',

    justifyContent:
      'space-between',

    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  optionCardHover: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    transform: [{ translateY: -3 }],
  },

  optionAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    backgroundColor: COLORS.primary,
    opacity: 0.88,
  },

  optionIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },

  optionLeft: {
    flex: 1,
    paddingRight: 10,
  },

  optionTitle: {

    fontSize: 15,

    fontWeight: 'bold',

    color: COLORS.textDark,
  },

  optionSubtitle: {

    marginTop: 5,

    color: COLORS.textLight,

    fontSize: 13,

    lineHeight: 20,
  },

  notificationExperience: {
    marginTop: -4,
    marginBottom: 14,
    padding: 15,
    borderWidth: 1,
    borderRadius: 18,
  },

  notificationExperienceHeading: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  notificationExperienceIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  notificationExperienceTitle: {
    fontSize: 15,
    fontWeight: '900',
  },

  notificationExperienceLabel: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '900',
  },

  notificationChoices: {
    gap: 8,
  },

  notificationChoice: {
    minHeight: 58,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  notificationChoiceTitle: {
    fontSize: 13,
    fontWeight: '900',
  },

  notificationChoiceSub: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 15,
  },

  vibrationChoices: {
    flexDirection: 'row',
    gap: 8,
  },

  vibrationChoice: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  vibrationChoiceText: {
    fontSize: 12,
    fontWeight: '900',
  },

  testAlertButton: {
    minHeight: 48,
    marginTop: 17,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },

  testAlertText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },

  deviceToneButton: {
    minHeight: 38,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },

  deviceToneText: {
    fontSize: 12,
    fontWeight: '800',
  },

  groupHint: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 10,
    paddingHorizontal: 4,
  },

  fieldError: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '700',
  },

  /* FOOTER */

  footer: {

    textAlign: 'center',

    marginTop: 30,

    marginBottom: 20,

    color: COLORS.textLight,

    fontSize: 13,

    lineHeight: 22,
  },

  /* MODAL */

  modalContainer: {

    flex: 1,

    backgroundColor:
      'rgba(0,0,0,0.4)',

    justifyContent: 'center',

    alignItems: 'center',

    paddingHorizontal: 20,
  },

  modalScrollContent: {

    flexGrow: 1,

    justifyContent: 'center',

    alignItems: 'center',

    width: '100%',

    paddingVertical: 24,
  },

  modalBox: {

    width: '100%',
    maxWidth: 420,

    backgroundColor:
      COLORS.white,

    borderRadius: CARD_RADIUS,

    padding: 25,
  },

  privacyModalBox: {
    maxHeight: '82%',
  },

  privacyScroll: {
    marginTop: 12,
    maxHeight: 330,
  },

  privacyText: {
    marginBottom: 13,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
  },

  modalTitle: {

    fontSize: 22,

    fontWeight: 'bold',

    color: COLORS.primary,
  },

  modalMessage: {

    marginTop: 15,

    fontSize: 15,

    color: COLORS.textDark,

    lineHeight: 24,
  },

  input: {

    backgroundColor:
      COLORS.background,

    borderRadius: 16,

    paddingHorizontal: 18,

    paddingVertical: 16,

    fontSize: 15,

    color: COLORS.textDark,

    marginTop: 20,
  },

  saveButton: {

    marginTop: 25,

    backgroundColor:
      COLORS.primary,

    paddingVertical: 15,

    borderRadius: 16,

    alignItems: 'center',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  saveText: {

    color: COLORS.white,

    fontWeight: 'bold',

    fontSize: 15,
  },

  buttonRow: {

    flexDirection: 'row',

    justifyContent:
      'space-between',

    marginTop: 30,
  },

  cancelButton: {

    backgroundColor:
      '#E2E8F0',

    paddingVertical: 14,

    paddingHorizontal: 28,

    borderRadius: 16,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  cancelText: {

    color: COLORS.textDark,

    fontWeight: 'bold',
  },

  yesButton: {

    backgroundColor:
      COLORS.primary,

    paddingVertical: 14,

    paddingHorizontal: 35,

    borderRadius: 16,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  deleteButton: {

    backgroundColor:
      COLORS.danger,

    paddingVertical: 14,

    paddingHorizontal: 30,

    borderRadius: 16,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
  },

  deleteButtonHover: {
    shadowColor: COLORS.danger,
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    transform: [{ translateY: -3 }],
  },

  yesText: {

    color: COLORS.white,

    fontWeight: 'bold',
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  optionCardMuted: {
    opacity: 0.62,
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  loadingText: {
    marginLeft: 2,
  },

  iconButtonHover: {
    borderWidth: 1,
    borderColor: 'rgba(91,95,239,0.22)',
    transform: [{ translateY: -2 }],
  },

  primaryButtonHover: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    transform: [{ translateY: -3 }],
  },

  secondaryButtonHover: {
    borderWidth: 1,
    borderColor: 'rgba(91,95,239,0.18)',
    transform: [{ translateY: -2 }],
  },

  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },

});
