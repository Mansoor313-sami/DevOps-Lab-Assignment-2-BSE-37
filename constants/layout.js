import {
  Dimensions,
  Platform,
  StatusBar,
  useWindowDimensions,
} from 'react-native';

const {
  width,
  height,
} = Dimensions.get('window');

export const IS_TABLET =
  Math.min(width, height) >= 768;

export const SCREEN_PADDING =
  IS_TABLET ? 28 : 20;

export const MAX_CONTENT_WIDTH =
  IS_TABLET ? 760 : '100%';

/* RESPONSIVE HOOK
   Use this inside components instead of the module-level
   Dimensions.get() snapshot so layout keeps working after
   device rotation, split screen, or browser resize. */

export const useResponsive = () => {

  const {
    width: currentWidth,
    height: currentHeight,
  } = useWindowDimensions();

  const isTablet =
    Math.min(currentWidth, currentHeight) >= 768;

  const isLandscape =
    currentWidth > currentHeight;

  return {
    width: currentWidth,
    height: currentHeight,
    isTablet,
    isLandscape,
    isCompactWidth: currentWidth < 380,
    screenPadding: isTablet ? 28 : 20,
    maxContentWidth: isTablet ? 760 : '100%',
  };
};

export const CARD_RADIUS = 8;

export const CONTROL_RADIUS = 12;

export const SYSTEM_TOP_INSET =
  Platform.OS === 'android'
    ? StatusBar.currentHeight || 24
    : 0;

export const HEADER_TOP_PADDING =
  SYSTEM_TOP_INSET + (IS_TABLET ? 34 : 26);

export const BOTTOM_NAV_HEIGHT = 74;

export const BOTTOM_NAV_BOTTOM_OFFSET =
  Platform.OS === 'android'
    ? 30
    : Platform.OS === 'web'
      ? 8
      : 22;

export const SCREEN_BOTTOM_PADDING =
  BOTTOM_NAV_HEIGHT +
  BOTTOM_NAV_BOTTOM_OFFSET +
  56;

/* SHADOW
   React Native Web deprecates the legacy shadow props in favour
   of boxShadow, while native still needs shadowColor and
   elevation. Platform.select keeps both targets warning-free. */

export const SHADOW = Platform.select({
  web: {
    boxShadow:
      '0px 8px 14px rgba(16, 24, 40, 0.08)',
  },
  default: {
    shadowColor: '#101828',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 3,
  },
});

export const SHADOW_STRONG = Platform.select({
  web: {
    boxShadow:
      '0px 10px 18px rgba(91, 95, 239, 0.16)',
  },
  default: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 10,
    },
    elevation: 6,
  },
});

export const TYPOGRAPHY = {
  screenTitle: 30,
  sectionTitle: 21,
  cardTitle: 18,
  body: 15,
  small: 13,
  tiny: 12,
};
