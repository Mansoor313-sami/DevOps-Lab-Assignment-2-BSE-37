import Constants from 'expo-constants';

/* Splash used to resolve the real app version dynamically while
   Settings showed a hardcoded "v1.0" — the two could show different
   numbers. This is the one place both now read from. */

export const getAppVersion = () => {

  try {

    return (
      Constants.expoConfig?.version ||
      Constants.manifest?.version ||
      '1.0.0'
    );

  } catch (error) {

    return '1.0.0';
  }
};
