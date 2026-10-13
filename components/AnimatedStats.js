import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';

import {
  useTheme,
} from '../context/ThemeContext';

/* COUNT UP
   Text content cannot be driven by the native driver, so the
   value is tracked through a listener. Only this small leaf
   re-renders while the number is climbing. */

export function CountUp({
  value = 0,
  duration = 700,
  style,
  suffix = '',
  reduceMotion = false,
}) {

  const anim =
    useRef(new Animated.Value(0)).current;

  const [display, setDisplay] =
    useState(0);

  const previous =
    useRef(0);

  useEffect(() => {

    const target = Number(value) || 0;

    /* Only animate when the number actually changed, so a
       background refresh does not restart the count. */

    if (previous.current === target) {
      return undefined;
    }

    if (reduceMotion) {
      anim.setValue(target);
      setDisplay(Math.round(target));
      previous.current = target;
      return undefined;
    }

    const id =
      anim.addListener(({ value: current }) =>
        setDisplay(Math.round(current))
      );

    anim.setValue(previous.current);

    Animated.timing(anim, {
      toValue: target,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      previous.current = target;
    });

    return () =>
      anim.removeListener(id);

  }, [value, reduceMotion]);

  return (
    <Text style={style}>
      {display}
      {suffix}
    </Text>
  );
}

/* ANIMATED BAR
   Grows from zero to the target percentage. */

export function AnimatedBar({
  percentage = 0,
  color,
  trackColor,
  height = 9,
  pulse = false,
  style,
  reduceMotion = false,
}) {

  const anim =
    useRef(new Animated.Value(0)).current;

  const pulseAnim =
    useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (reduceMotion) {
      anim.setValue(Math.max(0, Math.min(percentage, 100)));
      return;
    }

    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(percentage, 100)),
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

  }, [percentage, reduceMotion]);

  useEffect(() => {

    if (!pulse || reduceMotion) {
      pulseAnim.setValue(0);
      return undefined;
    }

    const loop =
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 900,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

    loop.start();

    return () =>
      loop.stop();

  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.track,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor,
          opacity: pulse
            ? pulseAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.72, 1],
              })
            : 1,
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          height: '100%',
          borderRadius: height / 2,
          backgroundColor: color,
          width: anim.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
        }}
      />
    </Animated.View>
  );
}

/* PROGRESS RING
   react-native-svg is not part of this project, so the ring is
   drawn with two half-disc masks that rotate. Each half covers
   180 degrees: the right half handles 0-50%, then it is pinned
   open and the left half sweeps 50-100%. */

export function ProgressRing({
  percentage = 0,
  size = 104,
  thickness = 9,
  color,
  trackColor,
  children,
  reduceMotion = false,
}) {

  const {
    colors,
  } = useTheme();

  const anim =
    useRef(new Animated.Value(0)).current;

  const fillColor =
    color || colors.primary;

  const ringTrack =
    trackColor || colors.surface;

  useEffect(() => {

    if (reduceMotion) {
      anim.setValue(Math.max(0, Math.min(percentage, 100)));
      return;
    }

    Animated.timing(anim, {
      toValue: Math.max(0, Math.min(percentage, 100)),
      duration: 950,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

  }, [percentage, reduceMotion]);

  const half = size / 2;

  const rightRotate =
    anim.interpolate({
      inputRange: [0, 50, 100],
      outputRange: ['0deg', '180deg', '180deg'],
      extrapolate: 'clamp',
    });

  const leftRotate =
    anim.interpolate({
      inputRange: [0, 50, 100],
      outputRange: ['0deg', '0deg', '180deg'],
      extrapolate: 'clamp',
    });

  const halfDisc = {
    position: 'absolute',
    width: half,
    height: size,
    borderTopRightRadius: half,
    borderBottomRightRadius: half,
    backgroundColor: fillColor,
    left: half,
  };

  return (

    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >

      {/* TRACK */}

      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: half,
          borderWidth: thickness,
          borderColor: ringTrack,
        }}
      />

      {/* RIGHT SWEEP: 0 to 50 percent */}

      <View
        style={[
          styles.clip,
          {
            width: half,
            height: size,
            left: half,
          },
        ]}
      >
        <Animated.View
          style={[
            halfDisc,
            {
              left: -half,
              transform: [
                { translateX: half / 2 },
                { rotate: rightRotate },
                { translateX: -half / 2 },
              ],
            },
          ]}
        />
      </View>

      {/* LEFT SWEEP: 50 to 100 percent */}

      <View
        style={[
          styles.clip,
          {
            width: half,
            height: size,
            left: 0,
          },
        ]}
      >
        <Animated.View
          style={[
            halfDisc,
            {
              left: 0,
              transform: [
                { translateX: -half / 2 },
                { rotate: leftRotate },
                { translateX: half / 2 },
              ],
            },
          ]}
        />
      </View>

      {/* INNER CUTOUT turns the disc into a ring */}

      <View
        style={{
          position: 'absolute',
          width: size - thickness * 2,
          height: size - thickness * 2,
          borderRadius: (size - thickness * 2) / 2,
          backgroundColor: colors.card,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({

  track: {
    width: '100%',
    overflow: 'hidden',
  },

  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },

});
