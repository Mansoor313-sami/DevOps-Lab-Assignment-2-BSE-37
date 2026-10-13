import {
  Platform,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as LocalAuthentication from 'expo-local-authentication';

/* APP LOCK
   QuizMate already keeps the user signed in between launches,
   so the useful thing biometrics buy us is not "log in again"
   but "prove it is still you before revealing the account".

   That is why this is an app lock over the existing session
   rather than a biometric login: no password or secret is
   stored anywhere to make it work. */

export const APP_LOCK_KEY =
  'appLockEnabled';

/* How long the app may sit in the background before it
   re-locks. Short trips out of the app (checking the OTP in
   a mail app) should not force a fingerprint every time. */

export const LOCK_GRACE_PERIOD = 60000;

/* Building this from LocalAuthentication.AuthenticationType at module
   scope means it runs the moment this file is imported, before any
   Platform.OS check ever gets a chance to run. On web,
   expo-local-authentication throws just for being touched at import
   time, which would take down the whole AuthScreen import chain along
   with it. Building the map lazily, inside the function that uses it,
   means the web build never dereferences it at all. */

const getTypeLabels = () => ({
  [LocalAuthentication.AuthenticationType.FINGERPRINT]:
    'Fingerprint',
  [LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION]:
    Platform.OS === 'ios' ? 'Face ID' : 'Face Unlock',
  [LocalAuthentication.AuthenticationType.IRIS]:
    'Iris',
});

/* CAPABILITY
   Reports what the device can actually do so the UI can show
   an honest label and explain why the toggle is unavailable. */

export const getBiometricCapability = async () => {

  const unavailable = {
    hasHardware: false,
    isEnrolled: false,
    isAvailable: false,
    label: 'Biometric unlock',
    reason: 'Biometric unlock is not supported on this device.',
  };

  if (Platform.OS === 'web') {
    return unavailable;
  }

  try {

    const hasHardware =
      await LocalAuthentication.hasHardwareAsync();

    if (!hasHardware) {
      return unavailable;
    }

    const isEnrolled =
      await LocalAuthentication.isEnrolledAsync();

    const types =
      await LocalAuthentication.supportedAuthenticationTypesAsync();

    const label =
      getTypeLabels()[types?.[0]] ||
      'Biometric unlock';

    return {
      hasHardware: true,
      isEnrolled,
      isAvailable: isEnrolled,
      label,
      reason: isEnrolled
        ? ''
        : `No ${label.toLowerCase()} is set up on this device yet. Add one in your phone settings first.`,
    };

  } catch (error) {

    console.log(error);

    /* This is a distinct outcome from the "no hardware / not
       enrolled" branches above: those are a successful probe that
       genuinely found nothing to use. This branch means the probe
       itself blew up (a native module error, an unexpected OS
       response) and we do not actually know whether biometrics are
       available. Callers that treat isAvailable:false as "safe to
       proceed without a lock" should check probeFailed and choose to
       fail closed instead - this file does not make that call for
       them since it does not own those call sites. */

    return {
      ...unavailable,
      probeFailed: true,
    };
  }
};

/* PROMPT
   Device passcode fallback stays enabled so a failed or
   unreadable fingerprint never traps the user. */

export const authenticateBiometric = async ({
  promptMessage = 'Unlock QuizMate',
  cancelLabel = 'Cancel',
} = {}) => {

  try {

    const result =
      await LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel,
        fallbackLabel: 'Use device passcode',
        disableDeviceFallback: false,
      });

    return {
      success: Boolean(result?.success),
      error: result?.error || '',
    };

  } catch (error) {

    console.log(error);

    return {
      success: false,
      error: 'unknown',
    };
  }
};

/* PREFERENCE */

export const isAppLockEnabled = async () => {

  try {

    const saved =
      await AsyncStorage.getItem(APP_LOCK_KEY);

    return saved === 'true';

  } catch (error) {

    return false;
  }
};

export const setAppLockEnabled = async (enabled) => {

  try {

    await AsyncStorage.setItem(
      APP_LOCK_KEY,
      enabled ? 'true' : 'false'
    );

    return true;

  } catch (error) {

    console.log(error);

    return false;
  }
};
