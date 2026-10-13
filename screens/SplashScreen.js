import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Image,
  StyleSheet,
  Text,
  Pressable,
  SafeAreaView,
  StatusBar,
  Animated,
  Easing,
  Platform,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import * as ExpoSplashScreen from 'expo-splash-screen';

import {
  THEME_COLORS,
} from '../constants/colors';

import {
  checkConnection,
} from '../utils/network';

import {
  getAppVersion,
} from '../utils/appInfo';

import {
  HEADER_TOP_PADDING,
  SHADOW,
  TYPOGRAPHY,
  useResponsive,
} from '../constants/layout';

/* TIMING
   minDuration is a floor, not a fixed delay. The screen also
   waits for the `isReady` prop before handing off, so a slow
   start-up keeps the splash visible instead of flashing an
   empty app shell. */

const MIN_SPLASH_DURATION = 1400;

const HINT_DELAY = 1600;

const TIMEOUT_DELAY = 8000;

const EXIT_DURATION = 260;

const APP_VERSION = getAppVersion();

/* STUDY TIPS
   Shown one at a time so the wait feels useful instead of dead.
   Kept short enough to read in under two seconds. */

const STUDY_TIPS = [
  'Keep attendance above 80% to stay exam eligible.',
  'Add your class timetable to get reminders 5 minutes before class.',
  'Log every quiz and assignment the day it is announced.',
  'Check the Calendar each Sunday to plan your week.',
  'Mark tasks complete as you finish them, not at the end of the week.',
  'Add your date sheet early so paper day alerts have time to fire.',
  'Two short study sessions beat one long session before a deadline.',
  'Review the Alerts tab every morning so nothing slips past you.',
];

const pickTip = () =>
  STUDY_TIPS[
    Math.floor(Math.random() * STUDY_TIPS.length)
  ];

export default function SplashScreen({
  onFinish,
  isReady = true,
  isDarkMode = false,
  onRetry,
  minDuration = MIN_SPLASH_DURATION,
}) {

  const {
    width,
    height,
    isCompactWidth,
    maxContentWidth,
    screenPadding,
  } = useResponsive();

  const palette =
    isDarkMode
      ? THEME_COLORS.dark
      : THEME_COLORS.light;

  /* Splash renders before the theme provider, so the surface
     colours are resolved here from the saved preference. */

  const surface = {
    background:
      isDarkMode ? palette.background : '#F3F0FF',
    topPanel:
      isDarkMode ? palette.card : '#EEE9FF',
    bottomPanel:
      isDarkMode ? palette.card : '#FFFFFF',
    panelBorder:
      isDarkMode
        ? 'rgba(165,180,252,0.14)'
        : 'rgba(124,58,237,0.08)',
    waveLight:
      isDarkMode
        ? 'rgba(99,102,241,0.12)'
        : 'rgba(255,255,255,0.48)',
    waveDeep:
      isDarkMode
        ? 'rgba(124,58,237,0.14)'
        : 'rgba(221,214,254,0.58)',
    curve:
      isDarkMode
        ? 'rgba(165,180,252,0.18)'
        : 'rgba(91,95,239,0.15)',
    floatCard:
      isDarkMode
        ? 'rgba(15,23,42,0.82)'
        : 'rgba(255,255,255,0.92)',
    glow:
      isDarkMode
        ? 'rgba(165,180,252,0.10)'
        : 'rgba(91,95,239,0.08)',
    track:
      isDarkMode
        ? 'rgba(165,180,252,0.18)'
        : 'rgba(91,95,239,0.14)',
  };

  /* STATE */

  const [tip] =
    useState(pickTip);

  const [minTimeElapsed, setMinTimeElapsed] =
    useState(false);

  const [showHint, setShowHint] =
    useState(false);

  const [isTimedOut, setIsTimedOut] =
    useState(false);

  const [isOffline, setIsOffline] =
    useState(false);

  /* Bumped on every retry so the hint and timeout
     timers re-arm instead of firing only once. */

  const [retryCount, setRetryCount] =
    useState(0);

  const hasFinished =
    useRef(false);

  /* ANIMATION VALUES */

  const topPanelAnim = useRef(new Animated.Value(0)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;
  const bottomPanelAnim = useRef(new Animated.Value(0)).current;
  const footerAnim = useRef(new Animated.Value(0)).current;

  const breathe = useRef(new Animated.Value(0)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;
  const twinkleA = useRef(new Animated.Value(0)).current;
  const twinkleB = useRef(new Animated.Value(0)).current;
  const bobA = useRef(new Animated.Value(0)).current;
  const bobB = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  const progress = useRef(new Animated.Value(0)).current;

  const exitOpacity = useRef(new Animated.Value(1)).current;
  const exitScale = useRef(new Animated.Value(1)).current;

  /* ENTRANCE + LOOPS */

  useEffect(() => {

    Animated.stagger(110, [

      Animated.timing(topPanelAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.spring(logoAnim, {
        toValue: 1,
        friction: 7,
        tension: 62,
        useNativeDriver: true,
      }),

      Animated.timing(titleAnim, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(subtitleAnim, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(bottomPanelAnim, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),

      Animated.timing(footerAnim, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),

    ]).start();

    /* Continuous motion so the screen never looks frozen. */

    const makeLoop = (value, duration, delay = 0) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: 0,
            duration,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    const loops = [
      makeLoop(breathe, 1400),
      makeLoop(glowPulse, 1700, 200),
      makeLoop(twinkleA, 900),
      makeLoop(twinkleB, 1150, 350),
      makeLoop(bobA, 1600),
      makeLoop(bobB, 1900, 260),
    ];

    /* A single, one-directional revolution for the accent ring.
       Kept separate from makeLoop, which reverses; an orbit that
       rewound halfway would read as a glitch. */

    const orbitLoop =
      Animated.loop(
        Animated.timing(orbit, {
          toValue: 1,
          duration: 9000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );

    loops.forEach((loop) => loop.start());

    orbitLoop.start();

    /* Determinate progress makes the wait feel shorter. */

    Animated.timing(progress, {
      toValue: 1,
      duration: minDuration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false,
    }).start();

    const minTimer =
      setTimeout(
        () => setMinTimeElapsed(true),
        minDuration
      );

    return () => {

      loops.forEach((loop) => loop.stop());

      orbitLoop.stop();

      clearTimeout(minTimer);
    };

  }, []);

  /* HINT + TIMEOUT + CONNECTIVITY
     Re-armed on every retry so a second failure still
     surfaces the message and the Try Again button. */

  useEffect(() => {

    let cancelled = false;

    const hintTimer =
      setTimeout(
        () => setShowHint(true),
        HINT_DELAY
      );

    const timeoutTimer =
      setTimeout(
        () => setIsTimedOut(true),
        TIMEOUT_DELAY
      );

    checkConnection().then((online) => {
      if (!cancelled) {
        setIsOffline(!online);
      }
    });

    return () => {

      cancelled = true;

      clearTimeout(hintTimer);
      clearTimeout(timeoutTimer);
    };

  }, [retryCount]);

  /* HANDOFF
     Explicit contract: leave only when the brand floor has
     passed AND the app reports it is ready. */

  const runExit = useCallback(() => {

    if (hasFinished.current) {
      return;
    }

    hasFinished.current = true;

    Animated.parallel([
      Animated.timing(exitOpacity, {
        toValue: 0,
        duration: EXIT_DURATION,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(exitScale, {
        toValue: 1.05,
        duration: EXIT_DURATION,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(() => {
      onFinish?.();
    });

  }, [onFinish]);

  useEffect(() => {

    if (minTimeElapsed && isReady) {
      runExit();
    }

  }, [minTimeElapsed, isReady, runExit]);

  /* NATIVE HANDOFF
     The native splash is dismissed only once this screen has
     laid out, so the two never overlap or leave a blank frame
     between them. */

  const handleRootLayout = useCallback(() => {

    ExpoSplashScreen.hideAsync().catch(() => {});

  }, []);

  const handleRetry = () => {

    setIsTimedOut(false);

    setShowHint(false);

    setRetryCount((count) => count + 1);

    onRetry?.();
  };

  /* DERIVED LAYOUT */

  const logoSize =
    Math.min(width * 0.42, 200);

  const panelHeight =
    Math.max(
      Math.min(height * 0.19, 190),
      132
    );

  const brandHeight =
    Math.max(height * 0.3, 240);

  const isWaiting =
    !isReady;

  /* DECORATIVE PROPS
     Hidden from screen readers so the announcement is just
     the brand, status and tip. */

  const decorative = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  };

  return (

    <SafeAreaView
      onLayout={handleRootLayout}
      style={[
        styles.safeArea,
        {
          backgroundColor:
            surface.background,
        },
      ]}
    >

      <StatusBar
        backgroundColor={surface.background}
        barStyle={
          isDarkMode
            ? 'light-content'
            : 'dark-content'
        }
      />

      <Animated.View
        style={[
          styles.container,
          {
            paddingHorizontal: screenPadding,
            opacity: exitOpacity,
            transform: [
              {
                scale: exitScale,
              },
            ],
          },
        ]}
      >

        {/* TOP DECOR PANEL */}

        <Animated.View
          {...decorative}
          style={[
            styles.panel,
            {
              maxWidth: maxContentWidth,
              minHeight: panelHeight,
              backgroundColor:
                surface.topPanel,
              borderColor:
                surface.panelBorder,
              opacity: topPanelAnim,
              transform: [
                {
                  translateY:
                    topPanelAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-26, 0],
                    }),
                },
              ],
            },
          ]}
        >

          <View
            style={[
              styles.waveOne,
              {
                backgroundColor:
                  surface.waveLight,
              },
            ]}
          />
          <View
            style={[
              styles.waveTwo,
              {
                backgroundColor:
                  surface.waveDeep,
              },
            ]}
          />
          <View
            style={[
              styles.curve,
              {
                width: width * 0.62,
                borderColor: surface.curve,
              },
            ]}
          />

          <View
            style={[
              styles.quizCardArt,
              {
                right: isCompactWidth ? 28 : 46,
                width: isCompactWidth ? 52 : 60,
                height: isCompactWidth ? 40 : 46,
              },
            ]}
          >
            <View style={styles.quizCardLineOne} />
            <View style={styles.quizCardLineTwo} />
          </View>

          <Animated.View
            style={[
              styles.floatArt,
              {
                left: isCompactWidth ? 22 : 42,
                bottom: 26,
                backgroundColor:
                  surface.floatCard,
                transform: [
                  {
                    translateY:
                      bobA.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -6],
                      }),
                  },
                ],
              },
            ]}
          >
            <MaterialIcons
              name="assignment-turned-in"
              size={26}
              color={palette.primary}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sparkle,
              {
                left: width * 0.32,
                top: 28,
                width: 11,
                height: 11,
                backgroundColor:
                  'rgba(196,181,253,0.82)',
                opacity:
                  twinkleA.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.35, 1],
                  }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.sparkle,
              {
                right: width * 0.36,
                bottom: 26,
                width: 9,
                height: 9,
                backgroundColor:
                  'rgba(250,204,21,0.7)',
                opacity:
                  twinkleB.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1],
                  }),
              },
            ]}
          />

        </Animated.View>

        {/* BRAND */}

        <View
          style={[
            styles.brandPanel,
            {
              maxWidth: maxContentWidth,
              minHeight: brandHeight,
            },
          ]}
        >

          <Animated.View
            {...decorative}
            style={[
              styles.brandGlow,
              {
                width: logoSize * 1.85,
                height: logoSize * 1.85,
                borderRadius: logoSize,
                backgroundColor: surface.glow,
                opacity:
                  glowPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.55, 1],
                  }),
                transform: [
                  {
                    scale:
                      glowPulse.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.94, 1.06],
                      }),
                  },
                ],
              },
            ]}
          />

          {/* ORBIT
              A thin ring carrying two accent motes that revolve once
              every nine seconds. Rotating the ring rotates the motes
              with it, so a single value drives the whole orbit. */}

          <Animated.View
            {...decorative}
            style={[
              styles.orbitRing,
              {
                width: logoSize * 1.5,
                height: logoSize * 1.5,
                borderRadius: logoSize * 0.75,
                borderColor: isDarkMode
                  ? 'rgba(165,180,252,0.20)'
                  : 'rgba(124,58,237,0.16)',
                opacity: logoAnim,
                transform: [
                  {
                    rotate: orbit.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.orbitMote,
                {
                  top: -4,
                  alignSelf: 'center',
                  backgroundColor: palette.primary,
                },
              ]}
            />
            <View
              style={[
                styles.orbitMote,
                {
                  bottom: -3,
                  alignSelf: 'center',
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: palette.accent,
                },
              ]}
            />
          </Animated.View>

          <Animated.View
            style={{
              opacity: logoAnim,
              transform: [
                {
                  scale: Animated.multiply(
                    logoAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.85, 1],
                    }),
                    breathe.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.03],
                    })
                  ),
                },
              ],
            }}
          >
            <Image
              source={require('../assets/logo/splash.png')}
              style={{
                width: logoSize,
                height: logoSize,
              }}
              resizeMode="contain"
              accessible={true}
              accessibilityLabel="QuizMate logo"
            />
          </Animated.View>

          <Animated.Text
            style={[
              styles.title,
              {
                color: palette.primary,
                opacity: titleAnim,
                transform: [
                  {
                    translateY:
                      titleAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                  },
                ],
              },
            ]}
          >
            QuizMate
          </Animated.Text>

          <Animated.Text
            style={[
              styles.subtitle,
              {
                color: palette.textLight,
                opacity: subtitleAnim,
              },
            ]}
          >
            Smart Semester Manager
          </Animated.Text>

          {/* PROGRESS */}

          <Animated.View
            style={[
              styles.progressTrack,
              {
                backgroundColor: surface.track,
                opacity: subtitleAnim,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.progressFill,
                {
                  backgroundColor:
                    palette.primary,
                  width:
                    progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['4%', '100%'],
                    }),
                },
              ]}
            />
          </Animated.View>

          {/* STATUS LINE */}

          {isWaiting && showHint && (

            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.statusText,
                {
                  color: palette.textLight,
                },
              ]}
            >
              {isTimedOut
                ? 'This is taking longer than usual.'
                : 'Getting things ready...'}
            </Text>

          )}

          {isWaiting && isTimedOut && (

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading QuizMate"
              onPress={handleRetry}
              style={({ pressed }) => [
                styles.retryButton,
                {
                  backgroundColor:
                    palette.primary,
                },
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons
                name="refresh"
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.retryText}>
                Try Again
              </Text>
            </Pressable>

          )}

        </View>

        {/* BOTTOM DECOR PANEL */}

        <Animated.View
          {...decorative}
          style={[
            styles.panel,
            {
              maxWidth: maxContentWidth,
              minHeight: panelHeight,
              backgroundColor:
                surface.bottomPanel,
              borderColor:
                surface.panelBorder,
              opacity: bottomPanelAnim,
              transform: [
                {
                  translateY:
                    bottomPanelAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [26, 0],
                    }),
                },
              ],
            },
          ]}
        >

          <View
            style={[
              styles.waveOne,
              {
                top: 34,
                backgroundColor:
                  surface.waveLight,
              },
            ]}
          />
          <View
            style={[
              styles.waveTwo,
              {
                backgroundColor:
                  surface.waveDeep,
              },
            ]}
          />
          <View
            style={[
              styles.curve,
              {
                left: -24,
                right: undefined,
                width: width * 0.58,
                borderColor: surface.curve,
              },
            ]}
          />

          <Animated.View
            style={[
              styles.floatArt,
              {
                left: isCompactWidth ? 24 : 46,
                top: 28,
                backgroundColor:
                  isDarkMode
                    ? 'rgba(15,23,42,0.7)'
                    : '#F8F7FF',
                transform: [
                  {
                    translateY:
                      bobB.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -5],
                      }),
                  },
                ],
              },
            ]}
          >
            <MaterialIcons
              name="menu-book"
              size={25}
              color={palette.primary}
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.floatArt,
              {
                right: isCompactWidth ? 24 : 46,
                bottom: 26,
                backgroundColor:
                  palette.primary,
                transform: [
                  {
                    translateY:
                      bobA.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 5],
                      }),
                  },
                ],
              },
            ]}
          >
            <MaterialIcons
              name="event-note"
              size={25}
              color="#FFFFFF"
            />
          </Animated.View>

          <Animated.View
            style={[
              styles.sparkle,
              {
                left: width * 0.38,
                bottom: 26,
                width: 9,
                height: 9,
                backgroundColor:
                  'rgba(250,204,21,0.7)',
                opacity:
                  twinkleB.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.32, 1],
                  }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.sparkle,
              {
                right: width * 0.4,
                top: 26,
                width: 11,
                height: 11,
                backgroundColor:
                  'rgba(196,181,253,0.82)',
                opacity:
                  twinkleA.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.38, 1],
                  }),
              },
            ]}
          />

        </Animated.View>

        {/* FOOTER: TIP + OFFLINE + VERSION */}

        <Animated.View
          style={[
            styles.footer,
            {
              maxWidth: maxContentWidth,
              opacity: footerAnim,
              transform: [
                {
                  translateY:
                    footerAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [10, 0],
                    }),
                },
              ],
            },
          ]}
        >

          {isOffline ? (

            <View
              style={[
                styles.offlineRow,
                {
                  backgroundColor:
                    isDarkMode
                      ? 'rgba(248,113,113,0.14)'
                      : '#FEE2E2',
                },
              ]}
            >
              <MaterialIcons
                name="wifi-off"
                size={16}
                color={palette.danger}
              />
              <Text
                style={[
                  styles.offlineText,
                  {
                    color: palette.danger,
                  },
                ]}
              >
                You are offline. Your saved data may not be up to date.
              </Text>
            </View>

          ) : (

            <View style={styles.tipRow}>
              <MaterialIcons
                name="lightbulb-outline"
                size={16}
                color={palette.accent}
              />
              <Text
                style={[
                  styles.tipText,
                  {
                    color: palette.textLight,
                  },
                ]}
              >
                {tip}
              </Text>
            </View>

          )}

          <Text
            style={[
              styles.versionText,
              {
                color: palette.textLight,
              },
            ]}
          >
            v{APP_VERSION}
          </Text>

        </Animated.View>

      </Animated.View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: HEADER_TOP_PADDING,
    paddingBottom: 18,
  },

  /* DECOR PANELS */

  panel: {
    position: 'relative',
    width: '100%',
    borderRadius: 28,
    borderWidth: 1,
    overflow: 'hidden',
    ...SHADOW,
  },

  waveOne: {
    position: 'absolute',
    left: -48,
    right: -46,
    top: 50,
    height: 66,
    borderTopLeftRadius: 140,
    borderTopRightRadius: 160,
    transform: [
      {
        rotate: '-7deg',
      },
    ],
  },

  waveTwo: {
    position: 'absolute',
    left: -36,
    right: -44,
    bottom: -28,
    height: 84,
    borderTopLeftRadius: 170,
    borderTopRightRadius: 120,
    transform: [
      {
        rotate: '6deg',
      },
    ],
  },

  curve: {
    position: 'absolute',
    right: -26,
    top: 26,
    height: 56,
    borderTopWidth: 2,
    borderRadius: 120,
    transform: [
      {
        rotate: '-13deg',
      },
    ],
  },

  quizCardArt: {
    position: 'absolute',
    top: 28,
    borderRadius: 14,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 10,
    paddingVertical: 10,
    transform: [
      {
        rotate: '-8deg',
      },
    ],
  },

  quizCardLineOne: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FBBF24',
    marginBottom: 7,
  },

  quizCardLineTwo: {
    width: '72%',
    height: 5,
    borderRadius: 3,
    backgroundColor:
      'rgba(255,255,255,0.8)',
  },

  floatArt: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  sparkle: {
    position: 'absolute',
    borderRadius: 3,
    transform: [
      {
        rotate: '45deg',
      },
    ],
  },

  /* BRAND */

  brandPanel: {
    position: 'relative',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  brandGlow: {
    position: 'absolute',
  },

  orbitRing: {
    position: 'absolute',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  orbitMote: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  title: {
    marginTop: 18,
    fontSize: 34,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 8,
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  progressTrack: {
    marginTop: 22,
    width: 148,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  statusText: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '600',
    textAlign: 'center',
  },

  retryButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  retryText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.small,
    fontWeight: 'bold',
  },

  pressed: {
    opacity: 0.88,
    transform: [
      {
        scale: 0.97,
      },
    ],
  },

  /* FOOTER */

  footer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 14,
  },

  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
  },

  tipText: {
    flex: 1,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 19,
    fontWeight: '600',
  },

  offlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },

  offlineText: {
    flex: 1,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 18,
    fontWeight: '700',
  },

  versionText: {
    marginTop: 12,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
    opacity: 0.8,
  },

});
