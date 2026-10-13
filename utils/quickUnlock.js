import {
  Platform,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import * as SecureStore from 'expo-secure-store';

/* QUICK UNLOCK
   Lets a signed out user get back in with a fingerprint or
   Face ID instead of retyping their password.

   A biometric scan only proves who is holding the phone, it
   cannot sign anyone into Firebase by itself, so something has
   to be stored. We deliberately store the Firebase refresh
   token rather than the password:

     - it only works for this app
     - it can be revoked from the Firebase console
     - it is useless to anyone who has it for another service

   It lives in SecureStore, which is backed by the Android
   Keystore and the iOS Keychain, not in AsyncStorage.

   The token and its display metadata (name/email, whether a
   record exists at all) are kept in two separate stores on
   purpose: AuthScreen wants to show "Unlock as Jane" on mount
   without ever touching the encrypted token before the user has
   actually passed a biometric scan. Metadata lives in plain
   AsyncStorage; only the refresh token itself lives in
   SecureStore. */

const RECORD_KEY = 'quickUnlockRecord';
const META_KEY = 'quickUnlockMeta';

const isSupported =
  Platform.OS === 'ios' ||
  Platform.OS === 'android';

/* SecureStore is native only, so the web build silently
   behaves as if the feature is switched off. */

export const isQuickUnlockSupported = () =>
  isSupported;

const buildMeta = (user) => ({
  userId: user.id,
  name: user.name || '',
  email: user.email || '',
  savedAt: Date.now(),
});

export const saveQuickUnlock = async (user) => {

  if (
    !isSupported ||
    !user?.refreshToken ||
    !user?.id
  ) {
    return false;
  }

  try {

    const record = {
      userId: user.id,
      name: user.name || '',
      email: user.email || '',
      refreshToken: user.refreshToken,
      savedAt: Date.now(),
    };

    const secureStoreOptions = {
      keychainAccessible:
        SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    };

    try {

      /* Gates reading the token behind the device's own biometric
         or passcode check, on top of the app's own scan. Not every
         device supports this (no biometrics/passcode enrolled), so
         a rejection here falls back to a write without it rather
         than failing Quick Unlock setup outright. */

      await SecureStore.setItemAsync(
        RECORD_KEY,
        JSON.stringify(record),
        {
          ...secureStoreOptions,
          requireAuthentication: true,
        }
      );

    } catch (requireAuthError) {

      await SecureStore.setItemAsync(
        RECORD_KEY,
        JSON.stringify(record),
        secureStoreOptions
      );
    }

    /* Best effort: the metadata cache is a display convenience, not
       the source of truth, so a failure here should not undo the
       SecureStore write above. */

    try {

      await AsyncStorage.setItem(
        META_KEY,
        JSON.stringify(buildMeta(user))
      );

    } catch (metaError) {

      console.log(metaError);
    }

    return true;

  } catch (error) {

    console.log(error);

    return false;
  }
};

/* Full record, including the refresh token. Reading this decrypts
   the SecureStore entry (and, once requireAuthentication takes
   effect on devices that support it, can itself trigger the OS
   biometric/passcode prompt), so callers that only need to know
   whether Quick Unlock is set up - or want to show it before a scan
   has happened - should use getQuickUnlockMeta() instead. */

export const getQuickUnlock = async () => {

  if (!isSupported) {
    return null;
  }

  try {

    const saved =
      await SecureStore.getItemAsync(RECORD_KEY);

    if (!saved) {
      return null;
    }

    const record = JSON.parse(saved);

    return record?.refreshToken
      ? record
      : null;

  } catch (error) {

    console.log(error);

    return null;
  }
};

/* MOUNT-TIME READ
   Non-secret fields only - never touches SecureStore, so it never
   decrypts or prompts for the refresh token. Meant to be called on
   screen mount to decide whether to show the Quick Unlock card and
   who it is for. */

export const getQuickUnlockMeta = async () => {

  if (!isSupported) {
    return {
      success: true,
      exists: false,
    };
  }

  try {

    const saved =
      await AsyncStorage.getItem(META_KEY);

    if (!saved) {
      return {
        success: true,
        exists: false,
      };
    }

    const meta = JSON.parse(saved);

    return {
      success: true,
      exists: true,
      userId: meta.userId,
      name: meta.name || '',
      email: meta.email || '',
    };

  } catch (error) {

    return {
      success: false,
      error,
    };
  }
};

/* POST-SCAN READ
   The actual refresh token. AuthScreen only calls this from inside
   the unlock handler, after authenticateBiometric() has already
   resolved successfully - never on mount. */

export const getQuickUnlockToken = async () => {

  if (!isSupported) {
    return {
      success: false,
      error: new Error('Quick Unlock is not supported on this platform.'),
    };
  }

  try {

    const record = await getQuickUnlock();

    if (!record?.refreshToken) {
      return {
        success: false,
        error: new Error('No Quick Unlock record is saved on this device.'),
      };
    }

    return {
      success: true,
      refreshToken: record.refreshToken,
      userId: record.userId,
      name: record.name || '',
      email: record.email || '',
    };

  } catch (error) {

    return {
      success: false,
      error,
    };
  }
};

export const clearQuickUnlock = async () => {

  if (!isSupported) {
    return {
      success: true,
    };
  }

  try {

    await SecureStore.deleteItemAsync(RECORD_KEY);

    try {

      await AsyncStorage.removeItem(META_KEY);

    } catch (metaError) {

      console.log(metaError);
    }

    return {
      success: true,
    };

  } catch (error) {

    console.log(error);

    return {
      success: false,
      error,
    };
  }
};

/* Called after a silent refresh so the stored token stays
   current instead of going stale over a long break. */

export const refreshQuickUnlockToken = async (
  refreshToken
) => {

  const record = await getQuickUnlock();

  if (!record || !refreshToken) {
    return {
      success: false,
      error: new Error('No existing Quick Unlock record to refresh.'),
    };
  }

  const saved =
    await saveQuickUnlock({
      id: record.userId,
      name: record.name,
      email: record.email,
      refreshToken,
    });

  return saved
    ? { success: true }
    : {
        success: false,
        error: new Error('Could not save the refreshed Quick Unlock token.'),
      };
};
