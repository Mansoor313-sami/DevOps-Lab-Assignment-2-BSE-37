import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  StyleSheet,
  Animated,
  AccessibilityInfo,
} from 'react-native';

import {
  useTheme,
} from '../context/ThemeContext';

import {
  CARD_RADIUS,
} from '../constants/layout';

/* SHIMMER BLOCK
   A single grey placeholder bar that softly pulses.
   Used to build skeleton versions of real cards.

   The shimmer is a continuous loop, so it checks the device
   Reduce Motion setting itself rather than relying on every
   caller to remember to pass a flag down. */

export function SkeletonBlock({
  width = '100%',
  height = 14,
  radius = 8,
  style,
  reduceMotion,
}) {

  const {
    isDarkMode,
  } = useTheme();

  const [systemReduceMotion, setSystemReduceMotion] =
    useState(false);

  const pulse =
    useRef(
      new Animated.Value(0.4)
    ).current;

  useEffect(() => {

    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setSystemReduceMotion(Boolean(enabled));
        }
      })
      .catch(() => {});

    const subscription =
      AccessibilityInfo.addEventListener(
        'reduceMotionChanged',
        (enabled) => {
          if (mounted) {
            setSystemReduceMotion(Boolean(enabled));
          }
        }
      );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };

  }, []);

  const stillMotion =
    reduceMotion ?? systemReduceMotion;

  useEffect(() => {

    if (stillMotion) {
      pulse.setValue(0.75);
      return undefined;
    }

    const loop =
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 750,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0.4,
            duration: 750,
            useNativeDriver: true,
          }),
        ])
      );

    loop.start();

    return () =>
      loop.stop();

  }, [stillMotion]);

  return (

    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          opacity: pulse,
          backgroundColor:
            isDarkMode
              ? 'rgba(148,163,184,0.20)'
              : 'rgba(100,116,139,0.14)',
        },
        style,
      ]}
    />
  );
}

/* SKELETON CARD
   Card-shaped placeholder with a few text lines. */

export function SkeletonCard({
  lines = 2,
  showAvatar = true,
  style,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  return (

    <View
      style={[
        styles.card,
        {
          backgroundColor:
            colors.card,
          borderColor:
            isDarkMode
              ? 'rgba(165,180,252,0.10)'
              : 'rgba(91,95,239,0.07)',
        },
        style,
      ]}
    >

      {showAvatar && (
        <SkeletonBlock
          width={44}
          height={44}
          radius={14}
        />
      )}

      <View style={styles.cardBody}>

        <SkeletonBlock
          width="62%"
          height={15}
        />

        {Array.from({
          length: Math.max(lines - 1, 0),
        }).map((_, index) => (
          <SkeletonBlock
            key={index}
            width={
              index % 2 === 0
                ? '92%'
                : '74%'
            }
            height={11}
            style={styles.cardLine}
          />
        ))}

      </View>

    </View>
  );
}

/* SKELETON LIST */

export function SkeletonList({
  count = 3,
  lines = 2,
  showAvatar = true,
}) {

  return (

    <View style={styles.list}>

      {Array.from({ length: count }).map(
        (_, index) => (
          <SkeletonCard
            key={index}
            lines={lines}
            showAvatar={showAvatar}
          />
        )
      )}

    </View>
  );
}

const styles = StyleSheet.create({

  list: {
    gap: 12,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
  },

  cardBody: {
    flex: 1,
  },

  cardLine: {
    marginTop: 9,
  },

});
