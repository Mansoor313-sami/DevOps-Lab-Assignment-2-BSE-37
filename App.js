import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as ExpoSplashScreen from 'expo-splash-screen';

/* Hold the native splash until the JS splash has painted, so
   the handoff is seamless instead of flashing a blank frame. */

ExpoSplashScreen.preventAutoHideAsync().catch(() => {});

import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  BackHandler,
  ScrollView,
  AppState,
  Platform,
  Linking,
  Animated,
} from 'react-native';

/* SCREENS */

import SplashScreen from './screens/SplashScreen';

import LockScreen from './screens/LockScreen';

import AuthScreen from './screens/AuthScreen';

import HomeScreen from './screens/HomeScreen';

import SubjectsScreen from './screens/SubjectsScreen';

import CalendarScreen from './screens/CalendarScreen';

import AttendanceScreen from './screens/AttendanceScreenV2';

import ClassManagementScreen from './screens/ClassManagementScreenV2';

import DateSheetManagementScreen from './screens/DateSheetManagementScreenV2';

import NotificationsScreen from './screens/NotificationsScreenV2';

import ProfileScreen from './screens/ProfileScreenV2';

import ContactUsScreen from './screens/ContactUsScreenV2';

import WhatsNewScreen from './screens/WhatsNewScreen';

import HowToUseScreen from './screens/HowToUseScreen';

import SettingsScreen from './screens/SettingsScreen';

import SubjectDetailScreen from './screens/SubjectDetailScreen';

/* COLORS */

import COLORS from './constants/colors';

import {
  THEME_COLORS,
} from './constants/colors';

import {
  ThemeContext,
} from './context/ThemeContext';

import {
  ToastProvider,
} from './context/ToastContext';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  BOTTOM_NAV_BOTTOM_OFFSET,
  BOTTOM_NAV_HEIGHT,
  CARD_RADIUS,
  SHADOW,
  TYPOGRAPHY,
  useResponsive,
} from './constants/layout';

/* NOTIFICATIONS */

import {
  getDeadlineDateKey,
  isDeadlineToday,
  sendDeadlineStartedNotification,
} from './utils/notifications';

import {
  loadAllUserTasks,
  loadUserNotifications,
} from './utils/localData';

import {
  ensureLocalDataMigrated,
  markMigratedWithoutFetch,
} from './utils/dataMigration';

import MigrationProgressModal from './components/MigrationProgressModal';

import {
  clearPersistedSession,
  loadPersistedSession,
} from './utils/firebaseRest';

import {
  DATA_DOMAINS,
  onDataChanged,
} from './utils/dataEvents';

import {
  isAppLockEnabled,
  LOCK_GRACE_PERIOD,
} from './utils/biometrics';

const { width } =
  Dimensions.get('window');

const menuItems = [
  {
    name: 'Home',
    icon: 'home-filled',
  },
  {
    name: 'Subjects',
    icon: 'menu-book',
  },
  {
    name: 'Calendar',
    icon: 'calendar-month',
  },
  {
    name: 'Attendance',
    icon: 'fact-check',
  },
  {
    name: 'Class Management',
    icon: 'school',
    drawerOnly: true,
  },
  {
    name: 'Date Sheet',
    icon: 'event-note',
    drawerOnly: true,
  },
  {
    name: 'Alerts',
    icon: 'notifications',
  },
  {
    name: 'Profile',
    icon: 'account-circle',
  },
  {
    name: 'Contact Us',
    icon: 'support-agent',
  },
  {
    name: 'Settings',
    icon: 'settings',
  },
  {
    name: "What's New",
    icon: 'new-releases',
    drawerOnly: true,
  },
  {
    name: 'How To Use',
    icon: 'tips-and-updates',
    drawerOnly: true,
  },
];

/* BOTTOM NAV
   Calendar is a daily-use destination, so it now sits in the
   bottom bar next to Home, Subjects, Attendance and Alerts
   instead of being drawer-only. */

const bottomNavOrder = [
  'Home',
  'Subjects',
  'Calendar',
  'Attendance',
  'Alerts',
];

const bottomNavItems =
  bottomNavOrder
    .map((name) =>
      menuItems.find(
        (item) => item.name === name
      )
    )
    .filter(Boolean);

const ALERTS_LAST_SEEN_KEY =
  'alertsLastSeenAt';

function hideWebScrollbars() {
  if (
    Platform.OS !== 'web' ||
    typeof document === 'undefined' ||
    document.getElementById(
      'quizmate-hidden-scrollbars'
    )
  ) {
    return;
  }

  const style =
    document.createElement('style');

  style.id =
    'quizmate-hidden-scrollbars';

  style.textContent = `
    html,
    body,
    #root {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    * {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    *::-webkit-scrollbar {
      width: 0;
      height: 0;
      display: none;
    }
  `;

  document.head.appendChild(style);
}

export default function App() {

  /* SPLASH
     The splash owns its own minimum brand time and exits only
     once `isReady` is true, so a slow start-up keeps the splash
     on screen instead of flashing an empty app shell. */

  const [splashDone, setSplashDone] =
    useState(false);

  const [themeLoaded, setThemeLoaded] =
    useState(false);

  /* DRAWER */

  const [activeScreen, setActiveScreen] =
    useState('Home');

  const [screenHistory, setScreenHistory] =
    useState([]);

  const [drawerVisible, setDrawerVisible] =
    useState(false);

  const [deadlineSettingsPromptVisible, setDeadlineSettingsPromptVisible] =
    useState(false);

  /* THEME */

  const [isDarkMode, setIsDarkMode] =
    useState(false);

  /* AUTH */

  const [isLoggedIn, setIsLoggedIn] =
    useState(false);

  const [currentUser, setCurrentUser] =
    useState(null);

  const [authChecked, setAuthChecked] =
    useState(false);

  /* DATA MIGRATION
     True only while the one-time Firebase -> local pull (see
     utils/dataMigration.js) is actually in flight. Home used to be
     allowed to render and read the local database before this pull had
     written anything to it, showing a blank dashboard on a fresh login
     even though the account had data. Gating on this closes that race:
     once already migrated, this resolves almost instantly and the gate
     is invisible. */

  const [isMigrating, setIsMigrating] =
    useState(false);

  const [migrationProgress, setMigrationProgress] =
    useState(null);

  const [migrationHasError, setMigrationHasError] =
    useState(false);

  const migrationRetryNeeded =
    useRef(false);

  const migrationUserId =
    useRef(null);

  /* SUBJECT DETAIL */

  const [selectedSubject, setSelectedSubject] =
    useState(null);

  /* APP LOCK
     Gates the already persisted session behind a biometric
     prompt. No password or secret is stored to make this work. */

  const [isLocked, setIsLocked] =
    useState(false);

  const backgroundedAt =
    useRef(0);

  /* UNREAD ALERTS */

  const [unreadAlerts, setUnreadAlerts] =
    useState(0);

  /* Incremented only by the Android widget's refresh deep link. Passing a
     token (instead of a boolean) means repeated refresh taps are honoured. */
  const [widgetRefreshRequest, setWidgetRefreshRequest] =
    useState(0);

  const alertsLastSeenRef =
    useRef(0);

  /* SCREEN TRANSITION */

  const screenFade =
    useRef(
      new Animated.Value(1)
    ).current;

  const {
    width: windowWidth,
  } = useResponsive();

  const drawerWidth =
    Math.min(windowWidth * 0.88, 390);

  const appSafeEdges =
    Platform.OS === 'ios' &&
    ['Class Management', 'Date Sheet', 'Alerts', 'Profile', 'Contact Us'].includes(activeScreen)
      ? ['top', 'bottom']
      : [];

  /* NOTIFICATIONS */

  useEffect(() => {

    hideWebScrollbars();

    loadTheme();

    loadAuthState();

  }, []);

  useEffect(() => {

    /* Must wait for the data migration to fully settle: this reads
       tasks from the same local database that migration writes to in
       one big transaction, and running a read against it while that
       transaction is still open is exactly the kind of overlap that
       can stall SQLite instead of just queuing politely. */
    if (!currentUser?.id || isMigrating) {
      return undefined;
    }

    promptDeadlineSettingsOnce();

    checkMissedDeadlineAlerts();

    const subscription =
      AppState.addEventListener(
        'change',
        (nextState) => {

          if (nextState === 'active' && !isMigrating) {
            checkMissedDeadlineAlerts();
          }
        }
      );

    return () =>
      subscription.remove();

  }, [currentUser, isMigrating]);

  /* APP LOCK LIFECYCLE
     Locks on first launch when enabled, and re-locks after the
     app has been in the background long enough that someone
     else could have picked up the phone. */

  useEffect(() => {

    let cancelled = false;

    if (!isLoggedIn) {
      setIsLocked(false);
      return undefined;
    }

    isAppLockEnabled().then((enabled) => {
      if (enabled && !cancelled) {
        setIsLocked(true);
      }
    });

    return () => {
      cancelled = true;
    };

  }, [isLoggedIn]);

  useEffect(() => {

    if (!isLoggedIn) {
      return undefined;
    }

    const subscription =
      AppState.addEventListener(
        'change',
        async (nextState) => {

          if (nextState === 'active') {

            const awayFor =
              backgroundedAt.current
                ? Date.now() - backgroundedAt.current
                : 0;

            backgroundedAt.current = 0;

            if (awayFor < LOCK_GRACE_PERIOD) {
              return;
            }

            const enabled =
              await isAppLockEnabled();

            if (enabled) {
              setIsLocked(true);
            }

            return;
          }

          if (!backgroundedAt.current) {
            backgroundedAt.current = Date.now();
          }
        }
      );

    return () =>
      subscription.remove();

  }, [isLoggedIn]);

  /* UNREAD ALERT COUNT
     Polls saved alerts and compares them against the last time
     the user actually opened the Alerts screen, so the bottom
     nav and drawer can show a badge for anything new. */

  const refreshUnreadAlerts = useCallback(async () => {

    if (!currentUser?.id) {
      setUnreadAlerts(0);
      return;
    }

    /* Same reason as the deadline-alert effect above: this reads the
       local notifications table, and must not race the migration
       transaction writing to the same database. */
    if (isMigrating) {
      return;
    }

    try {

      const savedNotifications =
        await loadUserNotifications(
          currentUser.id
        );

      const now =
        Date.now();

      const lastSeen =
        alertsLastSeenRef.current;

      const unread =
        savedNotifications.filter((item) => {

          const alertTime =
            new Date(
              item.scheduledFor ||
                item.createdAt
            ).getTime();

          return (
            !Number.isNaN(alertTime) &&
            alertTime <= now &&
            alertTime > lastSeen
          );
        }).length;

      setUnreadAlerts(unread);

    } catch (error) {

      console.log(error);
    }

  }, [currentUser, isMigrating]);

  useEffect(() => {

    let cancelled = false;

    const bootstrap = async () => {

      try {

        const savedLastSeen =
          await AsyncStorage.getItem(
            ALERTS_LAST_SEEN_KEY
          );

        alertsLastSeenRef.current =
          Number(savedLastSeen) || 0;

      } catch (error) {

        console.log(error);
      }

      if (!cancelled) {
        refreshUnreadAlerts();
      }
    };

    bootstrap();

    const interval =
      setInterval(
        refreshUnreadAlerts,
        45000
      );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };

  }, [refreshUnreadAlerts]);

  /* A new deadline/attendance/exam alert is written locally the instant
     it fires (see utils/notifications.js), so the badge can update right
     then instead of waiting up to 45s for the next poll. */
  useEffect(() => {

    const unsubscribe =
      onDataChanged(({ domain }) => {
        if (domain === DATA_DOMAINS.NOTIFICATIONS) {
          refreshUnreadAlerts();
        }
      });

    return unsubscribe;

  }, [refreshUnreadAlerts]);

  const markAlertsAsSeen = useCallback(async () => {

    const now = Date.now();

    alertsLastSeenRef.current = now;

    setUnreadAlerts(0);

    try {

      await AsyncStorage.setItem(
        ALERTS_LAST_SEEN_KEY,
        String(now)
      );

    } catch (error) {

      console.log(error);
    }

  }, []);

  /* SCREEN TRANSITION
     A short fade on screen change so navigation reads as a
     transition instead of an instant hard cut. */

  useEffect(() => {

    screenFade.setValue(0);

    Animated.timing(screenFade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

  }, [activeScreen, selectedSubject]);

  /* WIDGET DEEP LINKS
     Taps on the Android home-screen widget open the app with a
     `quizmate://widget/<route>` URL. We translate each route to an
     existing screen name and reuse `navigateTo`, so the widget never
     needs its own navigation logic and unknown routes fall back to
     Home. This is additive: the app already imported Linking (for
     openSettings) but did not previously consume incoming URLs. */

  useEffect(() => {

    /* Map a widget deep-link path to a real screen name. Paths look
       like "widget/attendance"; we key off the last segment. */
    const routeToScreen = (url) => {

      if (!url) {
        return null;
      }

      /* Grab the segment after "widget/", tolerant of the
         scheme, host casing, query strings and trailing slashes. */
      const match =
        String(url)
          .toLowerCase()
          .match(/widget\/([a-z]+)/);

      const route =
        match ? match[1] : '';

      switch (route) {
        case 'attendance':
          return 'Attendance';
        case 'subjects':
          return 'Subjects';
        case 'calendar':
          return 'Calendar';
        case 'classes':
          return 'Class Management';
        case 'datesheet':
          return 'Date Sheet';
        case 'profile':
          return 'Profile';
        case 'alerts':
          return 'Alerts';
        case 'home':
          return 'Home';
        case 'refresh':
          return 'Home';
        default:
          /* Any quizmate:// link we don't recognise still brings
             the user somewhere sensible rather than nowhere. */
          return String(url)
            .toLowerCase()
            .startsWith('quizmate://')
            ? 'Home'
            : null;
      }
    };

    const handleUrl = (url) => {

      const target = routeToScreen(url);

      if (!target) {
        return;
      }

      /* Only navigate once the user is actually inside the app.
         If they are signed out or locked, the intent is dropped;
         they land on the normal post-login Home, which is the safe
         default for a launcher tap. */
      if (!isLoggedIn || isLocked) {
        return;
      }

      if (
        String(url)
          .toLowerCase()
          .includes('widget/refresh')
      ) {
        setWidgetRefreshRequest((value) => value + 1);
      }

      /* Deep links are top-level destinations, so clear any open
         subject detail and drawer before switching screens. */
      setSelectedSubject(null);

      navigateTo(target);
    };

    /* Cold start: the app was launched by the widget tap. */
    Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {});

    /* Warm start: the app was already running in the background. */
    const subscription =
      Linking.addEventListener(
        'url',
        (event) => handleUrl(event?.url)
      );

    return () =>
      subscription.remove();

    /* Re-subscribe if auth/lock state changes so a link that arrives
       right after unlocking is honoured with fresh state. */
  }, [isLoggedIn, isLocked]);

  const promptDeadlineSettingsOnce = async () => {

    if (Platform.OS !== 'android') {
      return;
    }

    try {

      const promptKey =
        `deadline_settings_prompt_${currentUser.id}`;

      const alreadyShown =
        await AsyncStorage.getItem(
          promptKey
        );

      if (alreadyShown === 'true') {
        return;
      }

      await AsyncStorage.setItem(
        promptKey,
        'true'
      );

      setDeadlineSettingsPromptVisible(true);

    } catch (error) {

      console.log(error);
    }
  };

  const checkMissedDeadlineAlerts = async () => {

    try {

      const { tasks } =
        await loadAllUserTasks(
          currentUser.id
        );

      const pendingTodayTasks =
        tasks.filter(
          (task) =>
            task.status === 'Pending' &&
            isDeadlineToday(task)
        );

      for (const task of pendingTodayTasks) {

        const dateKey =
          getDeadlineDateKey(task);

        if (!dateKey) {
          continue;
        }

        const alertKey =
          `deadline_alert_${currentUser.id}_${task.id}_${dateKey}`;

        const alreadyAlerted =
          await AsyncStorage.getItem(
            alertKey
          );

        if (alreadyAlerted === 'true') {
          continue;
        }

        await sendDeadlineStartedNotification(
          task.title,
          task.subjectName,
          currentUser.id
        );

        await AsyncStorage.setItem(
          alertKey,
          'true'
        );
      }

    } catch (error) {

      console.log(error);
    }
  };

  /* LOAD THEME */

  const loadTheme = async () => {

    try {

      const savedTheme =
        await AsyncStorage.getItem(
          'isDarkMode'
        );

      if (savedTheme !== null) {

        setIsDarkMode(
          JSON.parse(savedTheme)
        );
      }

    } catch (error) {

      console.log(error);

    } finally {

      setThemeLoaded(true);
    }
  };

  /* TOGGLE THEME */

  const toggleTheme = async () => {

    try {

      const newValue =
        !isDarkMode;

      setIsDarkMode(newValue);

      await AsyncStorage.setItem(
        'isDarkMode',
        JSON.stringify(newValue)
      );

    } catch (error) {

      console.log(error);
    }
  };

  /* DATA MIGRATION
     Home (and every other screen) is kept off-screen behind `isMigrating`
     while this runs, so a fresh login can never render a dashboard read
     from a local database that has not been seeded yet. A returning
     account that still has its data only in Firebase sees a real,
     step-by-step progress modal (MigrationProgressModal) instead of a
     plain spinner - `migrationProgress` tracks how far the pull has
     gotten and `migrationHasError` switches the modal into a Retry /
     Continue-without-syncing state instead of hanging silently. */

  const runMigration = useCallback(async (userId) => {

    if (!userId) {
      return;
    }

    migrationUserId.current = userId;

    setMigrationHasError(false);
    setMigrationProgress(null);
    setIsMigrating(true);

    /* A hard ceiling so the app can never sit on the progress modal
       forever, no matter what stalls underneath - a slow network, a
       stuck request, anything. Once this fires the modal switches to
       its error state so the user has something to act on, instead of
       the previous silent fallthrough into an app with no data. */
    let timedOut = false;

    const timeout = new Promise((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve({ reason: 'timeout' });
      }, 25000);
    });

    try {

      const result =
        await Promise.race([
          ensureLocalDataMigrated(userId, (step) => {
            setMigrationProgress(step);
          }),
          timeout,
        ]);

      const failed =
        timedOut ||
        result?.reason === 'offline' ||
        result?.reason === 'error';

      migrationRetryNeeded.current = failed;

      if (failed) {
        setMigrationHasError(true);
        return;
      }

    } catch (error) {

      console.log(error);

      migrationRetryNeeded.current = true;

      setMigrationHasError(true);

      return;
    }

    setIsMigrating(false);

    setMigrationProgress(null);

  }, []);

  const handleMigrationRetry = useCallback(() => {

    if (migrationUserId.current) {
      runMigration(migrationUserId.current);
    }

  }, [runMigration]);

  /* Lets someone stuck offline on a first-login-after-update still use
     the app (locally empty until they can sync) rather than being
     trapped behind the modal indefinitely. migrationRetryNeeded stays
     true, so the pull is attempted again automatically the next time
     the app comes back to the foreground. */
  const handleMigrationContinueOffline = useCallback(() => {

    migrationRetryNeeded.current = true;

    setIsMigrating(false);

    setMigrationHasError(false);

    setMigrationProgress(null);

  }, []);

  /* Retries a previously failed migration once the app is foregrounded
     again (e.g. the user turned on Wi-Fi and reopened QuizMate), instead
     of leaving Home permanently blank until the next full login. */
  useEffect(() => {

    if (!currentUser?.id) {
      return undefined;
    }

    const subscription =
      AppState.addEventListener(
        'change',
        (nextState) => {

          if (
            nextState === 'active' &&
            migrationRetryNeeded.current
          ) {
            runMigration(currentUser.id);
          }
        }
      );

    return () =>
      subscription.remove();

  }, [currentUser, runMigration]);

  /* LOAD AUTH */

  const loadAuthState = async () => {

    setAuthChecked(false);

    try {

      const savedLogin =
        await AsyncStorage.getItem(
          'isLoggedIn'
        );

      /* loadPersistedSession re-merges the refresh token back in from
         SecureStore (it is deliberately kept out of the plaintext
         AsyncStorage blob) so currentUser has the same shape every
         screen already expects, including SettingsScreen's re-auth
         check before a sensitive action. */
      const parsedUser =
        await loadPersistedSession();

      setIsLoggedIn(
        savedLogin === 'true' &&
          parsedUser !== null
      );

      setCurrentUser(parsedUser);

      /* Existing installs only have their data in Firebase. Awaited here
         (unlike before) so Home cannot mount and read an empty local
         database before this has had a chance to seed it. Once already
         migrated this resolves almost instantly, so returning users
         barely see the gate at all. */
      if (parsedUser?.id) {
        await runMigration(parsedUser.id);
      }

    } catch (error) {

      console.log(error);

    } finally {

      setAuthChecked(true);
    }
  };

  /* AUTH SUCCESS */

  const handleAuthSuccess = (user, options = {}) => {

    setCurrentUser(user);

    setIsLoggedIn(true);

    if (!user?.id) {
      return;
    }

    /* A brand new sign-up has nothing in Firebase to pull yet, so
       there is nothing to show a progress modal for - just mark this
       device as migrated and let local storage take over immediately.
       They back their data up to Firebase themselves later, from
       Settings, whenever they choose. */
    if (options.isNewSignup) {
      markMigratedWithoutFetch(user.id).catch((error) =>
        console.log(error)
      );
      return;
    }

    /* Every other login (a returning account, login-after-logout, or
       a pre-update account signing in on this device for the first
       time) goes through the real pull. If this device already has
       the data, ensureLocalDataMigrated resolves near-instantly and
       the progress modal is never really seen. */
    runMigration(user.id);
  };

  /* LOGOUT */

  const handleLogout = async () => {

    try {

      await AsyncStorage.setItem(
        'isLoggedIn',
        'false'
      );

      /* Wipes both the AsyncStorage blob and the SecureStore refresh
         token, so a signed-out device has nothing left to resume a
         session from. */
      await clearPersistedSession();

      setSelectedSubject(null);

      setScreenHistory([]);

      setActiveScreen('Home');

      setCurrentUser(null);

      setIsLoggedIn(false);

    } catch (error) {

      console.log(error);
    }
  };

  const handleUserUpdate = (user) => {

    setCurrentUser(user);
  };

  /* OPEN DRAWER */

  const openDrawer = () => {

    setDrawerVisible(true);
  };

  /* CLOSE DRAWER */

  const closeDrawer = () => {

    setDrawerVisible(false);
  };

  /* NAVIGATE */

  const navigateTo = (screenName) => {

    if (screenName === 'Alerts') {
      markAlertsAsSeen();
    }

    if (screenName === activeScreen) {

      closeDrawer();

      return;
    }

    setSelectedSubject(null);

    setScreenHistory((history) => [
      ...history,
      activeScreen,
    ]);

    setActiveScreen(screenName);

    closeDrawer();
  };

  const goHomeFromDrawer = () => {

    setSelectedSubject(null);

    setScreenHistory([]);

    setActiveScreen('Home');

    closeDrawer();
  };

  /* OPEN SUBJECT */

  const openSubjectDetails = (subject) => {

    setSelectedSubject(subject);
  };

  /* BACK */

  const goBack = () => {

    setSelectedSubject(null);
  };

  /* BACK SCREEN */

  const goBackScreen = () => {

    setScreenHistory((history) => {

      if (history.length === 0) {

        return history;
      }

      const previousScreen =
        history[history.length - 1];

      setActiveScreen(previousScreen);

      return history.slice(
        0,
        history.length - 1
      );
    });
  };

  /* CURRENT SCREEN */

  const renderScreen = () => {

    if (activeScreen === 'Subjects') {

      return (

        <SubjectsScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          openSubjectDetails={
            openSubjectDetails
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Calendar') {

      return (
        <CalendarScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
          openSubjectDetails={
            openSubjectDetails
          }
        />
      );
    }

    if (activeScreen === 'Alerts') {

      return (
        <NotificationsScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Attendance') {

      return (
        <AttendanceScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Class Management') {

      return (
        <ClassManagementScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Date Sheet') {

      return (
        <DateSheetManagementScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Settings') {

      return (
        <SettingsScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          onLogout={handleLogout}
          currentUser={currentUser}
          onUserUpdate={
            handleUserUpdate
          }
          navigateTo={navigateTo}
        />
      );
    }

    if (activeScreen === 'Profile') {

      return (
        <ProfileScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
          onUserUpdate={
            handleUserUpdate
          }
        />
      );
    }

    if (activeScreen === 'Contact Us') {

      return (
        <ContactUsScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
          currentUser={currentUser}
        />
      );
    }

    if (activeScreen === "What's New") {

      return (
        <WhatsNewScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
        />
      );
    }

    if (activeScreen === 'How To Use') {

      return (
        <HowToUseScreen
          goBack={goBackScreen}
          canGoBack={
            screenHistory.length > 0
          }
        />
      );
    }

    return (
      <HomeScreen
        openDrawer={openDrawer}
        currentUser={currentUser}
        navigateTo={navigateTo}
        openSubjectDetails={
          openSubjectDetails
        }
        unreadAlerts={unreadAlerts}
        widgetRefreshRequest={widgetRefreshRequest}
      />
    );
  };

  const colors =
    isDarkMode
      ? THEME_COLORS.dark
      : THEME_COLORS.light;

  const themeValue = {
    isDarkMode,
    colors,
    toggleTheme,
  };

  /* PHONE BACK BUTTON */

  useEffect(() => {

    const subscription =
      BackHandler.addEventListener(
        'hardwareBackPress',
        () => {

          if (drawerVisible) {

            closeDrawer();

            return true;
          }

          if (selectedSubject) {

            setSelectedSubject(null);

            return true;
          }

          if (screenHistory.length > 0) {

            goBackScreen();

            return true;
          }

          if (activeScreen !== 'Home') {

            goHomeFromDrawer();

            return true;
          }

          /* Already on Home with nothing to pop:
             let Android handle back normally so the
             user can actually leave the app. */

          return false;
        }
      );

    return () =>
      subscription.remove();

  }, [
    drawerVisible,
    selectedSubject,
    screenHistory,
    activeScreen,
  ]);

  /* SPLASH */

  if (!splashDone) {

    return (

      <SplashScreen

        isReady={
          authChecked && themeLoaded
        }

        isDarkMode={isDarkMode}

        onRetry={() => {
          setThemeLoaded(false);
          loadTheme();
          loadAuthState();
        }}

        onFinish={() =>
          setSplashDone(true)
        }

      />
    );
  }

  /* AUTH */

  if (!isLoggedIn) {

    return (

      <ThemeContext.Provider
        value={themeValue}
      >
        <ToastProvider>
          <AuthScreen
            onAuthSuccess={
              handleAuthSuccess
            }
          />
        </ToastProvider>
      </ThemeContext.Provider>
    );
  }

  /* APP LOCK */

  if (isLocked) {

    return (

      <ThemeContext.Provider
        value={themeValue}
      >
        <ToastProvider>

          <LockScreen

            userName={
              currentUser?.name?.split(' ')[0] || ''
            }

            onUnlock={() =>
              setIsLocked(false)
            }

            onSignOut={() => {
              setIsLocked(false);
              handleLogout();
            }}

          />

        </ToastProvider>
      </ThemeContext.Provider>
    );
  }

  /* DATA MIGRATION
     Only reached right after a fresh login/signup, and only while the
     one-time local seed is actually running - typically well under a
     second once already migrated, a couple of seconds on a brand new
     device. */

  if (isMigrating) {

    return (

      <ThemeContext.Provider
        value={themeValue}
      >
        <SafeAreaView
          style={[
            styles.appContainer,
            {
              backgroundColor:
                colors.background,
            },
          ]}
        >

          <MigrationProgressModal
            visible={isMigrating}
            progress={migrationProgress}
            hasError={migrationHasError}
            onRetry={handleMigrationRetry}
            onContinueOffline={handleMigrationContinueOffline}
          />

        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  /* SUBJECT DETAIL */

  if (selectedSubject) {

    return (

      <ThemeContext.Provider
        value={themeValue}
      >

        <ToastProvider>

          <Animated.View
            style={[
              styles.appContainer,
              {
                opacity: screenFade,
                backgroundColor:
                  colors.background,
              },
            ]}
          >

            <SubjectDetailScreen

              subject={selectedSubject}

              goBack={goBack}

              currentUser={currentUser}

            />

          </Animated.View>

        </ToastProvider>

      </ThemeContext.Provider>

    );
  }

  /* MAIN APP */

  return (

    <ThemeContext.Provider
      value={themeValue}
    >

    <ToastProvider>

    <SafeAreaView
      edges={appSafeEdges}
      style={[
        styles.appContainer,
        {
          backgroundColor:
            colors.background,
        },
      ]}
    >

      <Animated.View
        style={[
          styles.screenArea,
          {
            opacity: screenFade,
          },
        ]}
      >
        {renderScreen()}
      </Animated.View>

      <View
        style={[
          styles.bottomNavWrap,
          {
            backgroundColor:
              colors.card,
            borderColor:
              colors.border,
          },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={
            styles.bottomNavContent
          }
        >
          {bottomNavItems.map((item) => {

            const isActive =
              activeScreen === item.name;

            const showBadge =
              item.name === 'Alerts' &&
              unreadAlerts > 0;

            const badgeLabel =
              unreadAlerts > 9
                ? '9+'
                : String(unreadAlerts);

            return (

              <TouchableOpacity
                key={item.name}
                activeOpacity={0.85}
                accessibilityRole="tab"
                accessibilityState={{
                  selected: isActive,
                }}
                accessibilityLabel={
                  showBadge
                    ? `${item.name}, ${unreadAlerts} new`
                    : item.name
                }
                style={[
                  styles.bottomNavItem,
                  isActive && {
                    backgroundColor:
                      colors.surface,
                  },
                ]}
                onPress={() =>
                  navigateTo(item.name)
                }
              >
                <View style={styles.bottomNavIconWrap}>

                  <MaterialIcons
                    name={item.icon}
                    size={23}
                    color={
                      isActive
                        ? colors.primary
                        : colors.textLight
                    }
                  />

                  {showBadge && (
                    <View
                      style={[
                        styles.navBadge,
                        {
                          backgroundColor:
                            colors.danger,
                          borderColor:
                            colors.card,
                        },
                      ]}
                    >
                      <Text
                        style={styles.navBadgeText}
                      >
                        {badgeLabel}
                      </Text>
                    </View>
                  )}

                </View>

                <Text
                  numberOfLines={1}
                  style={[
                    styles.bottomNavText,
                    {
                      color:
                        isActive
                          ? colors.primary
                          : colors.textLight,
                    },
                  ]}
                >
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <Modal
        visible={drawerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeDrawer}
      >

        <View style={styles.drawerOverlay}>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            style={styles.drawerBackdrop}
            onPress={closeDrawer}
          />

          <SafeAreaView
            style={[
              styles.drawer,
              {
                width: drawerWidth,
                backgroundColor:
                  colors.card,
              },
            ]}
          >

            <View
              style={[
                styles.drawerHero,
                {
                  backgroundColor:
                    isDarkMode
                      ? colors.surface
                      : '#EEE9FF',
                  borderColor:
                    isDarkMode
                      ? 'rgba(165,180,252,0.14)'
                      : 'rgba(124,58,237,0.08)',
                },
              ]}
            >
              <View
                style={[
                  styles.drawerHeroWaveOne,
                  isDarkMode &&
                    styles.drawerHeroWaveDark,
                ]}
              />
              <View
                style={[
                  styles.drawerHeroWaveTwo,
                  isDarkMode &&
                    styles.drawerHeroWaveTwoDark,
                ]}
              />
              <View
                style={[
                  styles.drawerRouteLine,
                  isDarkMode &&
                    styles.drawerRouteLineDark,
                ]}
              />
              <View
                style={[
                  styles.drawerNavIcon,
                  isDarkMode &&
                    styles.drawerNavIconDark,
                ]}
              >
                <MaterialIcons
                  name="near-me"
                  size={24}
                  color={colors.primary}
                />
              </View>
              <View style={styles.drawerNodeOne} />
              <View style={styles.drawerNodeTwo} />
              <View style={styles.drawerSparkle} />
              <TouchableOpacity
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Go to Home and close menu"
                style={[
                  styles.drawerBackButton,
                  {
                    backgroundColor:
                      colors.background,
                  },
                ]}
                onPress={goHomeFromDrawer}
              >
                <MaterialIcons
                  name="arrow-back"
                  size={22}
                  color={colors.primary}
                />
              </TouchableOpacity>

              <Text
                style={[
                  styles.drawerTitle,
                  {
                    color: colors.primary,
                  },
                ]}
              >
                QuizMate
              </Text>

              <Text
                style={[
                  styles.drawerSubtitle,
                  {
                    color: colors.textLight,
                  },
                ]}
              >
              Navigation
            </Text>
            </View>

            <View style={styles.menuArea}>

              <ScrollView
                testID="drawer-menu-scroll"
                style={styles.menuList}
                contentContainerStyle={
                  styles.menuListContent
                }
                showsVerticalScrollIndicator={false}
                persistentScrollbar={false}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
              >

                {menuItems.map((item) => {

                  const isActive =
                    activeScreen === item.name;

                  const showBadge =
                    item.name === 'Alerts' &&
                    unreadAlerts > 0;

                  return (

                    <Pressable
                      key={item.name}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: isActive,
                      }}
                      accessibilityLabel={
                        showBadge
                          ? `${item.name}, ${unreadAlerts} new`
                          : item.name
                      }
                      style={({
                        hovered,
                        pressed,
                      }) => [
                        styles.menuItem,
                        {
                          backgroundColor:
                            isActive
                              ? colors.primary
                              : colors.background,
                        },
                        isActive &&
                          styles.activeMenuItem,
                        hovered &&
                          !isActive &&
                          styles.menuItemHover,
                        hovered &&
                          !isActive &&
                          {
                            backgroundColor:
                              isDarkMode
                                ? 'rgba(91,95,239,0.22)'
                                : '#EDE9FE',
                          },
                        pressed &&
                          styles.menuItemPressed,
                      ]}
                      onPress={() =>
                        navigateTo(item.name)
                      }
                    >

                      <MaterialIcons
                        name={item.icon}
                        size={24}
                        color={
                          isActive
                            ? '#FFFFFF'
                            : colors.primary
                        }
                      />

                      <Text
                        style={[
                          styles.menuText,
                          {
                            color:
                              isActive
                                ? '#FFFFFF'
                                : colors.textDark,
                          },
                          isActive &&
                            styles.activeMenuText,
                        ]}
                      >
                        {item.name}
                      </Text>

                      {showBadge && (
                        <View
                          style={[
                            styles.menuBadge,
                            {
                              backgroundColor:
                                isActive
                                  ? '#FFFFFF'
                                  : colors.danger,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.menuBadgeText,
                              {
                                color:
                                  isActive
                                    ? colors.primary
                                    : '#FFFFFF',
                              },
                            ]}
                          >
                            {unreadAlerts > 9
                              ? '9+'
                              : unreadAlerts}
                          </Text>
                        </View>
                      )}

                    </Pressable>
                  );
                })}

              </ScrollView>

            </View>

          </SafeAreaView>

        </View>

      </Modal>

      <Modal
        transparent
        visible={deadlineSettingsPromptVisible}
        animationType="fade"
        onRequestClose={() => setDeadlineSettingsPromptVisible(false)}
      >
        <View style={styles.appPromptOverlay}>
          <View style={[styles.appPromptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.appPromptIcon, { backgroundColor: `${colors.primary}18` }]}>
              <MaterialIcons name="notifications-active" size={28} color={colors.primary} />
            </View>
            <Text selectable style={[styles.appPromptTitle, { color: colors.textDark }]}>Enable reliable deadline alerts</Text>
            <Text selectable style={[styles.appPromptText, { color: colors.textLight }]}>For midnight deadline alerts, allow QuizMate notifications and set battery usage to unrestricted in app settings. This helps Android deliver alerts when the app is closed.</Text>
            <View style={styles.appPromptActions}>
              <Pressable onPress={() => setDeadlineSettingsPromptVisible(false)} style={styles.appPromptSecondary}><Text style={[styles.appPromptSecondaryText, { color: colors.textDark }]}>Later</Text></Pressable>
              <Pressable onPress={() => { setDeadlineSettingsPromptVisible(false); Linking.openSettings(); }} style={[styles.appPromptPrimary, { backgroundColor: colors.primary }]}><Text style={styles.appPromptPrimaryText}>Open settings</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>

    </ToastProvider>

    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({

  appPromptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(9, 12, 31, 0.58)',
    justifyContent: 'center',
    padding: 24,
  },

  appPromptCard: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    borderWidth: 1,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },

  appPromptIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },

  appPromptTitle: {
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 14,
  },

  appPromptText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
  },

  appPromptActions: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
    marginTop: 22,
  },

  appPromptPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  appPromptSecondary: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.12)',
  },

  appPromptPrimaryText: {
    color: '#FFFFFF',
    fontWeight: '900',
  },

  appPromptSecondaryText: {
    fontWeight: '800',
  },

  appContainer: {
    flex: 1,
    backgroundColor:
      COLORS.background,
  },

  screenArea: {
    flex: 1,
  },

  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
  },

  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor:
      'rgba(15,23,42,0.45)',
    zIndex: 0,
  },

  drawer: {
    height: '100%',
    maxHeight: '100%',
    backgroundColor:
      COLORS.white,
    paddingHorizontal: 18,
    paddingTop: 40,
    borderTopRightRadius: CARD_RADIUS,
    borderBottomRightRadius: CARD_RADIUS,
    zIndex: 2,
    elevation: 20,
    ...SHADOW,
  },

  drawerBackButton: {
    position: 'absolute',
    left: 16,
    top: 14,
    width: 38,
    height: 38,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor:
      'rgba(91,95,239,0.12)',
    zIndex: 4,
    ...SHADOW,
  },

  drawerHero: {
    position: 'relative',
    minHeight: 132,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 58,
    paddingBottom: 18,
    overflow: 'hidden',
  },

  drawerHeroWaveOne: {
    position: 'absolute',
    left: -34,
    right: -44,
    top: 42,
    height: 72,
    backgroundColor:
      'rgba(255,255,255,0.44)',
    borderTopLeftRadius: 140,
    borderTopRightRadius: 170,
    transform: [
      {
        rotate: '-7deg',
      },
    ],
  },

  drawerHeroWaveDark: {
    backgroundColor:
      'rgba(99,102,241,0.12)',
  },

  drawerHeroWaveTwo: {
    position: 'absolute',
    left: -28,
    right: -38,
    bottom: -22,
    height: 78,
    backgroundColor:
      'rgba(221,214,254,0.48)',
    borderTopLeftRadius: 170,
    borderTopRightRadius: 120,
    transform: [
      {
        rotate: '6deg',
      },
    ],
  },

  drawerHeroWaveTwoDark: {
    backgroundColor:
      'rgba(124,58,237,0.12)',
  },

  drawerRouteLine: {
    position: 'absolute',
    right: 16,
    top: 38,
    width: 124,
    height: 48,
    borderTopWidth: 2,
    borderColor:
      'rgba(91,95,239,0.16)',
    borderRadius: 130,
    transform: [
      {
        rotate: '-12deg',
      },
    ],
  },

  drawerRouteLineDark: {
    borderColor:
      'rgba(165,180,252,0.18)',
  },

  drawerNavIcon: {
    position: 'absolute',
    right: 22,
    bottom: 22,
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor:
      'rgba(255,255,255,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  drawerNavIconDark: {
    backgroundColor:
      'rgba(15,23,42,0.88)',
    borderWidth: 1,
    borderColor:
      'rgba(165,180,252,0.14)',
  },

  drawerNodeOne: {
    position: 'absolute',
    right: 92,
    top: 30,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor:
      'rgba(91,95,239,0.36)',
  },

  drawerNodeTwo: {
    position: 'absolute',
    right: 118,
    bottom: 28,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor:
      'rgba(250,204,21,0.64)',
  },

  drawerSparkle: {
    position: 'absolute',
    left: 20,
    top: 20,
    width: 11,
    height: 11,
    borderRadius: 4,
    backgroundColor:
      'rgba(196,181,253,0.78)',
    transform: [
      {
        rotate: '45deg',
      },
    ],
  },

  drawerTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: COLORS.primary,
    zIndex: 3,
  },

  drawerSubtitle: {
    marginTop: 6,
    color: COLORS.textLight,
    fontWeight: '600',
    zIndex: 3,
  },

  menuArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 0,
    marginTop: 18,
  },

  menuList: {
    flex: 1,
    minHeight: 0,
  },

  menuListContent: {
    flexGrow: 0,
    paddingBottom: 34,
    paddingRight: 0,
  },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 14,
    marginBottom: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'transparent',
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  activeMenuItem: {
    backgroundColor:
      COLORS.primary,
  },

  menuItemHover: {
    borderColor:
      'rgba(91,95,239,0.28)',
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 2,
    transform: [
      {
        translateX: 6,
      },
    ],
  },

  menuItemPressed: {
    opacity: 0.86,
    transform: [
      {
        scale: 0.98,
      },
    ],
  },

  menuText: {
    flex: 1,
    marginLeft: 14,
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.textDark,
  },

  activeMenuText: {
    color: COLORS.white,
  },

  menuBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 7,
    justifyContent: 'center',
    alignItems: 'center',
  },

  menuBadgeText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

  bottomNavWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: BOTTOM_NAV_BOTTOM_OFFSET,
    minHeight: BOTTOM_NAV_HEIGHT,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    paddingVertical: 8,
    ...SHADOW,
  },

  bottomNavContent: {
    flexGrow: 1,
    justifyContent: 'space-around',
    paddingHorizontal: 10,
    alignItems: 'center',
  },

  bottomNavItem: {
    flex: 1,
    maxWidth: 94,
    minWidth: 62,
    minHeight: 58,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    paddingHorizontal: 6,
  },

  bottomNavIconWrap: {
    position: 'relative',
  },

  navBadge: {
    position: 'absolute',
    top: -6,
    right: -11,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },

  navBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: 'bold',
    lineHeight: 12,
  },

  bottomNavText: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },

});
