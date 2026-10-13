import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
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

import {
  useTheme,
} from '../context/ThemeContext';

import {
  authenticateBiometric,
  getBiometricCapability,
} from '../utils/biometrics';

import {
  CARD_RADIUS,
  SCREEN_PADDING,
  SHADOW,
  TYPOGRAPHY,
} from '../constants/layout';

export default function LockScreen({
  userName,
  onUnlock,
  onSignOut,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const [capability, setCapability] =
    useState(null);

  const [isPrompting, setIsPrompting] =
    useState(false);

  const [wasDismissed, setWasDismissed] =
    useState(false);

  const hasAutoPrompted =
    useRef(false);

  /* Re-entrancy guard as a ref, not state. State is only current as of
     the last render, so two fast taps (or a tap during the auto-prompt
     effect) can both read isPrompting as false before either setState
     lands, letting two authenticateAsync calls run at once. A ref is
     read and written synchronously, so the second call always sees the
     first one's flag. */
  const isPromptingRef =
    useRef(false);

  const [capabilityError, setCapabilityError] =
    useState(false);

  const fadeAnim =
    useRef(new Animated.Value(0)).current;

  const pulseAnim =
    useRef(new Animated.Value(0)).current;

  const shakeAnim =
    useRef(new Animated.Value(0)).current;

  /* ENTRANCE + IDLE PULSE */

  useEffect(() => {

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const loop =
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 1200,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    loop.start();

    return () =>
      loop.stop();

  }, []);

  const runShake = () => {

    shakeAnim.setValue(0);

    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 1,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -1,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0.5,
        duration: 55,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 55,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const promptUnlock = useCallback(async () => {

    if (isPromptingRef.current) {
      return;
    }

    isPromptingRef.current = true;

    setIsPrompting(true);

    try {

      const result =
        await authenticateBiometric({
          promptMessage: 'Unlock QuizMate',
        });

      if (result.success) {

        onUnlock?.();

        return;
      }

      setWasDismissed(true);

      runShake();

    } finally {

      isPromptingRef.current = false;

      setIsPrompting(false);
    }

  }, [onUnlock]);

  /* CAPABILITY CHECK + AUTO PROMPT
     isAvailable === false is ambiguous on its own: it means either "the
     probe genuinely found no hardware/enrolment" (safe to open the app
     - the device lost its biometric enrolment while the lock was on, and
     we must not strand the user behind a prompt that can never succeed)
     or "the probe itself threw" (info.probeFailed), which tells us
     nothing about whether biometrics still work. Fail closed: only skip
     the lock when the probe positively confirms there is nothing to
     authenticate with. A missing/unclear probeFailed value is treated
     the same as a failed probe, on purpose - biometrics.js may not have
     added the field to every return path yet. */

  useEffect(() => {

    let cancelled = false;

    getBiometricCapability().then((info) => {

      if (cancelled) {
        return;
      }

      setCapability(info);

      if (!info.isAvailable) {

        if (info?.probeFailed === false) {
          onUnlock?.();
        } else {
          setCapabilityError(true);
        }

        return;
      }

      if (!hasAutoPrompted.current) {
        hasAutoPrompted.current = true;
        promptUnlock();
      }
    });

    return () => {
      cancelled = true;
    };

  }, []);

  const label =
    capability?.label || 'Biometric unlock';

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
        backgroundColor={colors.background}
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
            opacity: fadeAnim,
            transform: [
              {
                translateX:
                  shakeAnim.interpolate({
                    inputRange: [-1, 1],
                    outputRange: [-8, 8],
                  }),
              },
            ],
          },
        ]}
      >

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor:
                isDarkMode
                  ? 'rgba(165,180,252,0.14)'
                  : 'rgba(91,95,239,0.08)',
            },
          ]}
        >

          <Animated.View
            style={[
              styles.iconRing,
              {
                backgroundColor:
                  isDarkMode
                    ? 'rgba(165,180,252,0.12)'
                    : '#EEF2FF',
                opacity:
                  pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.7, 1],
                  }),
                transform: [
                  {
                    scale:
                      pulseAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 1.08],
                      }),
                  },
                ],
              },
            ]}
          >
            <MaterialIcons
              name="fingerprint"
              size={46}
              color={colors.primary}
            />
          </Animated.View>

          <Text
            style={[
              styles.title,
              {
                color: colors.textDark,
              },
            ]}
          >
            QuizMate is locked
          </Text>

          <Text
            style={[
              styles.subtitle,
              {
                color: colors.textLight,
              },
            ]}
          >
            {capabilityError
              ? 'We could not check biometric availability on this device. Try unlocking again, or sign out and sign back in.'
              : userName
                ? `Welcome back, ${userName}. Unlock with ${label.toLowerCase()} to continue.`
                : `Unlock with ${label.toLowerCase()} to continue.`}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Unlock with ${label}`}
            accessibilityState={{
              busy: isPrompting,
            }}
            disabled={isPrompting}
            style={({ hovered, pressed }) => [
              styles.unlockButton,
              {
                backgroundColor:
                  colors.primary,
              },
              isPrompting && styles.buttonDisabled,
              hovered &&
                !isPrompting &&
                styles.primaryButtonHover,
              pressed &&
                !isPrompting &&
                styles.buttonPressed,
            ]}
            onPress={promptUnlock}
          >
            <MaterialIcons
              name="lock-open"
              size={19}
              color="#FFFFFF"
            />
            <Text style={styles.unlockText}>
              {isPrompting
                ? 'Waiting...'
                : `Unlock with ${label}`}
            </Text>
          </Pressable>

          {wasDismissed && !isPrompting && (
            <Text
              style={[
                styles.hintText,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Unlock was cancelled. Tap the button above to try again.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out of this account"
            style={({ hovered, pressed }) => [
              styles.signOutButton,
              hovered && styles.segmentHover,
              pressed && styles.buttonPressed,
            ]}
            onPress={onSignOut}
          >
            <Text
              style={[
                styles.signOutText,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Sign out instead
            </Text>
          </Pressable>

        </View>

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
    justifyContent: 'center',
    paddingHorizontal: SCREEN_PADDING,
  },

  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    padding: 28,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    ...SHADOW,
  },

  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
  },

  title: {
    fontSize: 23,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  subtitle: {
    marginTop: 10,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },

  unlockButton: {
    marginTop: 26,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    borderRadius: CARD_RADIUS,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  unlockText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body,
    fontWeight: 'bold',
  },

  hintText: {
    marginTop: 14,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
    textAlign: 'center',
  },

  signOutButton: {
    marginTop: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  signOutText: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  buttonDisabled: {
    opacity: 0.75,
  },

  segmentHover: {
    transform: [
      {
        translateY: -2,
      },
    ],
  },

  primaryButtonHover: {
    transform: [
      {
        translateY: -2,
      },
    ],
  },

  buttonPressed: {
    opacity: 0.88,
  },

});
