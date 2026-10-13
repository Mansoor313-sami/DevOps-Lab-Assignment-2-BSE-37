import React, {
  useMemo,
  useRef,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import {
  CARD_RADIUS,
  TYPOGRAPHY,
} from '../constants/layout';

/* SWIPEABLE ROW
   react-native-gesture-handler is not part of this project, so
   the gesture is handled with the built in PanResponder. The
   row only claims a gesture once it is clearly horizontal,
   which keeps vertical list scrolling untouched. */

const ACTION_WIDTH = 96;

const TRIGGER_DISTANCE = 72;

export default function SwipeableRow({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = 'Done',
  leftIcon = 'check',
  leftColor = '#22C55E',
  rightLabel = 'Delete',
  rightIcon = 'delete-outline',
  rightColor = '#EF4444',
  enabled = true,
  style,
}) {

  const translateX =
    useRef(new Animated.Value(0)).current;

  const offset = useRef(0);

  const settle = (toValue) =>
    Animated.spring(translateX, {
      toValue,
      friction: 9,
      tension: 80,
      useNativeDriver: true,
    }).start(() => {
      offset.current = toValue;
    });

  const reset = () => settle(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({

        onStartShouldSetPanResponder: () => false,

        /* Only take over for a deliberate horizontal drag, so
           taps still register and the list still scrolls. */

        onMoveShouldSetPanResponder: (
          _event,
          gesture
        ) =>
          enabled &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) >
            Math.abs(gesture.dy) * 1.6,

        onPanResponderMove: (_event, gesture) => {

          const next = gesture.dx;

          const clamped =
            Math.max(
              Math.min(next, ACTION_WIDTH),
              -ACTION_WIDTH
            );

          translateX.setValue(clamped);
        },

        onPanResponderRelease: (_event, gesture) => {

          if (
            gesture.dx > TRIGGER_DISTANCE &&
            onSwipeRight
          ) {
            Animated.timing(translateX, {
              toValue: ACTION_WIDTH,
              duration: 120,
              useNativeDriver: true,
            }).start(() => {
              onSwipeRight();
              translateX.setValue(0);
              offset.current = 0;
            });

            return;
          }

          if (
            gesture.dx < -TRIGGER_DISTANCE &&
            onSwipeLeft
          ) {
            Animated.timing(translateX, {
              toValue: -ACTION_WIDTH,
              duration: 120,
              useNativeDriver: true,
            }).start(() => {
              onSwipeLeft();
              translateX.setValue(0);
              offset.current = 0;
            });

            return;
          }

          reset();
        },

        onPanResponderTerminate: reset,

      }),
    [enabled, onSwipeLeft, onSwipeRight]
  );

  const leftOpacity =
    translateX.interpolate({
      inputRange: [0, TRIGGER_DISTANCE],
      outputRange: [0, 1],
      extrapolate: 'clamp',
    });

  const rightOpacity =
    translateX.interpolate({
      inputRange: [-TRIGGER_DISTANCE, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });

  return (

    <View style={[styles.wrap, style]}>

      {/* ACTION BEHIND: revealed on right swipe */}

      {onSwipeRight && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.action,
            styles.actionLeft,
            {
              backgroundColor: leftColor,
              opacity: leftOpacity,
            },
          ]}
        >
          <MaterialIcons
            name={leftIcon}
            size={22}
            color="#FFFFFF"
          />
          <Text style={styles.actionText}>
            {leftLabel}
          </Text>
        </Animated.View>
      )}

      {/* ACTION BEHIND: revealed on left swipe */}

      {onSwipeLeft && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.action,
            styles.actionRight,
            {
              backgroundColor: rightColor,
              opacity: rightOpacity,
            },
          ]}
        >
          <MaterialIcons
            name={rightIcon}
            size={22}
            color="#FFFFFF"
          />
          <Text style={styles.actionText}>
            {rightLabel}
          </Text>
        </Animated.View>
      )}

      <Animated.View
        {...panResponder.panHandlers}
        style={{
          transform: [{ translateX }],
        }}
      >
        {children}
      </Animated.View>

    </View>
  );
}

const styles = StyleSheet.create({

  wrap: {
    position: 'relative',
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },

  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },

  actionLeft: {
    left: 0,
  },

  actionRight: {
    right: 0,
  },

  actionText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
  },

});
