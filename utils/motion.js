import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  Animated,
  Easing,
  InteractionManager,
} from 'react-native';

/* ------------------------------------------------------------------
   REDUCE MOTION

   Continuous animation is a battery and accessibility problem, and
   several screens were running infinite loops regardless of the
   device setting. Every animated screen now reads this one hook, and
   it keeps listening so toggling the setting takes effect without a
   restart.
------------------------------------------------------------------- */

export const useReduceMotion = () => {

  const [reduceMotion, setReduceMotion] =
    useState(false);

  useEffect(() => {

    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(Boolean(enabled));
        }
      })
      .catch(() => {});

    const subscription =
      AccessibilityInfo.addEventListener(
        'reduceMotionChanged',
        (enabled) => {
          if (mounted) {
            setReduceMotion(Boolean(enabled));
          }
        }
      );

    return () => {
      mounted = false;
      subscription?.remove?.();
    };

  }, []);

  return reduceMotion;
};

/* ------------------------------------------------------------------
   ENTRANCE

   Returns a value that animates 0 -> 1 once the screen is
   interactive, so the animation never competes with the first
   render. Honours Reduce Motion by snapping straight to 1.
------------------------------------------------------------------- */

export const useEntrance = (
  reduceMotion,
  {
    delay = 0,
    duration = 460,
    enabled = true,
  } = {}
) => {

  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (!enabled) {
      return undefined;
    }

    if (reduceMotion) {
      value.setValue(1);
      return undefined;
    }

    value.setValue(0);

    const task =
      InteractionManager.runAfterInteractions(() => {
        Animated.timing(value, {
          toValue: 1,
          duration,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });

    return () => task?.cancel?.();

  }, [reduceMotion, enabled, delay, duration]);

  return value;
};

/* Standard rise-and-fade transform for an entrance value. */

export const entranceStyle = (value, distance = 16) => ({
  opacity: value,
  transform: [
    {
      translateY: value.interpolate({
        inputRange: [0, 1],
        outputRange: [distance, 0],
      }),
    },
  ],
});

/* Same idea with a gentle scale, for hero cards. */

export const popStyle = (value, from = 0.96) => ({
  opacity: value,
  transform: [
    {
      scale: value.interpolate({
        inputRange: [0, 1],
        outputRange: [from, 1],
      }),
    },
  ],
});

/* ------------------------------------------------------------------
   LOOP

   A single place that owns "breathing" motion. When Reduce Motion is
   on the loop is never started and the value rests at a neutral
   point, so nothing animates and nothing is left half faded.
------------------------------------------------------------------- */

export const useLoop = (
  reduceMotion,
  {
    duration = 1400,
    enabled = true,
    restValue = 0,
  } = {}
) => {

  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (reduceMotion || !enabled) {
      value.setValue(restValue);
      return undefined;
    }

    const loop =
      Animated.loop(
        Animated.sequence([
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

    loop.start();

    return () => loop.stop();

  }, [reduceMotion, enabled, duration, restValue]);

  return value;
};

/* ------------------------------------------------------------------
   STAGGER

   Gives each item in a list its own delay without creating a new
   Animated.Value per render. Index is clamped so a long list does
   not end up with a visible wait at the bottom.
------------------------------------------------------------------- */

export const staggerDelay = (
  index,
  step = 55,
  max = 340
) => Math.min(index * step, max);

/* ------------------------------------------------------------------
   PRESS

   A spring driven press scale that feels physical rather than the
   flat opacity change most of the app used.
------------------------------------------------------------------- */

export const usePressScale = (
  reduceMotion,
  { to = 0.97 } = {}
) => {

  const value = useRef(new Animated.Value(1)).current;

  const animateTo = (target) => {

    if (reduceMotion) {
      value.setValue(1);
      return;
    }

    Animated.spring(value, {
      toValue: target,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  };

  return {
    scale: value,
    onPressIn: () => animateTo(to),
    onPressOut: () => animateTo(1),
    style: { transform: [{ scale: value }] },
  };
};

/* ------------------------------------------------------------------
   SPRING IN

   An overshoot entrance for hero elements. Springs read as physical
   in a way a timing curve cannot, but they must never be used on a
   long list, so this stays deliberately separate from useEntrance.
------------------------------------------------------------------- */

export const useSpringIn = (
  reduceMotion,
  {
    delay = 0,
    friction = 7,
    tension = 64,
    enabled = true,
  } = {}
) => {

  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (!enabled) {
      return undefined;
    }

    if (reduceMotion) {
      value.setValue(1);
      return undefined;
    }

    value.setValue(0);

    const task =
      InteractionManager.runAfterInteractions(() => {
        Animated.spring(value, {
          toValue: 1,
          delay,
          friction,
          tension,
          useNativeDriver: true,
        }).start();
      });

    return () => task?.cancel?.();

  }, [reduceMotion, enabled, delay, friction, tension]);

  return value;
};

/* ------------------------------------------------------------------
   CONTINUOUS DRIVE

   useLoop ping-pongs 0 -> 1 -> 0, which is wrong for anything that
   should travel in one direction: shimmer sweeps, orbits, conic
   sheens. This one resets instead of reversing, so the motion never
   visibly rewinds.
------------------------------------------------------------------- */

export const useDrive = (
  reduceMotion,
  {
    duration = 2600,
    enabled = true,
    restValue = 0,
  } = {}
) => {

  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (reduceMotion || !enabled) {
      value.setValue(restValue);
      return undefined;
    }

    value.setValue(0);

    const loop =
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );

    loop.start();

    return () => {
      loop.stop();
      value.setValue(restValue);
    };

  }, [reduceMotion, enabled, duration, restValue]);

  return value;
};

/* A one-directional sweep, for shimmer highlights across a card. */

export const sweepStyle = (
  value,
  distance,
  { rotate = '18deg' } = {}
) => ({
  transform: [
    {
      translateX: value.interpolate({
        inputRange: [0, 1],
        outputRange: [-distance, distance],
      }),
    },
    { rotate },
  ],
});

/* A slow full rotation, for orbiting accents and ring sheens. */

export const spinStyle = (value, from = '0deg', to = '360deg') => ({
  transform: [
    {
      rotate: value.interpolate({
        inputRange: [0, 1],
        outputRange: [from, to],
      }),
    },
  ],
});

/* ------------------------------------------------------------------
   PARALLAX

   Scroll-linked depth. The caller owns the Animated.Value and feeds
   it from onScroll, so one value can drive many layers at different
   rates without extra listeners.

   Native driver safe: only transforms and opacity are produced.
------------------------------------------------------------------- */

export const useScrollValue = () => {

  const value = useRef(new Animated.Value(0)).current;

  const onScroll =
    useRef(
      Animated.event(
        [
          {
            nativeEvent: {
              contentOffset: { y: value },
            },
          },
        ],
        { useNativeDriver: true }
      )
    ).current;

  return { scrollY: value, onScroll };
};

/* Moves a layer at a fraction of scroll speed. A rate below 1 makes
   the layer feel further away; above 1 brings it forward. */

export const parallaxStyle = (
  scrollY,
  {
    rate = 0.3,
    range = 240,
    reduceMotion = false,
  } = {}
) => {

  if (reduceMotion) {
    return null;
  }

  return {
    transform: [
      {
        translateY: scrollY.interpolate({
          inputRange: [0, range],
          outputRange: [0, -range * rate],
          extrapolateLeft: 'clamp',
        }),
      },
    ],
  };
};

/* Collapses a hero as the list scrolls under it. Kept clamped so an
   overscroll bounce cannot invert the effect. */

export const collapseStyle = (
  scrollY,
  {
    range = 150,
    minScale = 0.94,
    minOpacity = 0.35,
    reduceMotion = false,
  } = {}
) => {

  if (reduceMotion) {
    return null;
  }

  return {
    opacity: scrollY.interpolate({
      inputRange: [0, range],
      outputRange: [1, minOpacity],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        scale: scrollY.interpolate({
          inputRange: [0, range],
          outputRange: [1, minScale],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: scrollY.interpolate({
          inputRange: [0, range],
          outputRange: [0, -range * 0.12],
          extrapolate: 'clamp',
        }),
      },
    ],
  };
};

/* ------------------------------------------------------------------
   TILT

   A pressed card that also tips slightly reads as a physical object
   rather than a rectangle changing size. Rotation is tiny on purpose;
   anything larger looks like a bug.
------------------------------------------------------------------- */

export const usePressTilt = (
  reduceMotion,
  {
    scaleTo = 0.975,
    tilt = '0.6deg',
    lift = 2,
  } = {}
) => {

  const value = useRef(new Animated.Value(0)).current;

  const animateTo = (target) => {

    if (reduceMotion) {
      value.setValue(0);
      return;
    }

    Animated.spring(value, {
      toValue: target,
      friction: 8,
      tension: 220,
      useNativeDriver: true,
    }).start();
  };

  return {
    onPressIn: () => animateTo(1),
    onPressOut: () => animateTo(0),
    style: {
      transform: [
        {
          scale: value.interpolate({
            inputRange: [0, 1],
            outputRange: [1, scaleTo],
          }),
        },
        {
          rotateZ: value.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', tilt],
          }),
        },
        {
          translateY: value.interpolate({
            inputRange: [0, 1],
            outputRange: [0, lift],
          }),
        },
      ],
    },
  };
};

/* ------------------------------------------------------------------
   PULSE ONCE

   A one-shot attention burst. Returns a value plus a trigger, so a
   card can react to a real event (saved, marked, synced) instead of
   looping forever and becoming wallpaper.
------------------------------------------------------------------- */

export const usePulse = (reduceMotion) => {

  const value = useRef(new Animated.Value(0)).current;

  const trigger = () => {

    if (reduceMotion) {
      return;
    }

    value.setValue(0);

    Animated.sequence([
      Animated.spring(value, {
        toValue: 1,
        friction: 5,
        tension: 95,
        useNativeDriver: true,
      }),
      Animated.timing(value, {
        toValue: 0,
        duration: 260,
        delay: 380,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  return { value, trigger };
};
