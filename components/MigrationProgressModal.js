import React, { useEffect, useRef } from 'react';

import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MaterialIcons } from '@expo/vector-icons';

import { useTheme } from '../context/ThemeContext';

import { AnimatedBar, CountUp } from './AnimatedStats';

/* MIGRATION PROGRESS MODAL
   Shown only for a returning account that still has its data sitting
   in Firebase and nothing local yet (a pre-update install's first
   login on this device). Blocks entry to the app until the pull is
   fully complete, with a real, step-by-step progress bar instead of a
   plain spinner - the user watches their subjects, tasks, attendance
   and so on come down one by one.

   Brand new sign-ups never see this: there is nothing to fetch, so
   App.js skips straight past it for them. */

export default function MigrationProgressModal({
  visible,
  progress,
  hasError = false,
  onRetry,
  onContinueOffline,
}) {

  const { colors, isDarkMode } = useTheme();

  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {

    if (!visible) {
      scaleAnim.setValue(0.92);
      fadeAnim.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

  }, [visible]);

  useEffect(() => {

    if (!visible || hasError) {
      spinAnim.stopAnimation();
      return undefined;
    }

    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    loop.start();

    return () => loop.stop();

  }, [visible, hasError]);

  const percentage = Math.round(
    Math.max(0, Math.min(1, progress?.fraction ?? 0)) * 100
  );

  const phase = progress?.phase || 'fetching';

  const stepLabel =
    hasError
      ? 'Connection interrupted'
      : phase === 'saving'
        ? 'Saving to your device...'
        : phase === 'done'
          ? 'All set!'
          : progress?.label
            ? `Fetching ${progress.label.toLowerCase()}...`
            : 'Getting your data ready...';

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (

    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>

        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >

          <View
            style={[
              styles.iconRing,
              {
                backgroundColor: hasError
                  ? isDarkMode
                    ? 'rgba(248,113,113,0.14)'
                    : '#FEE2E2'
                  : isDarkMode
                    ? colors.surface
                    : '#EEE9FF',
              },
            ]}
          >
            {hasError ? (
              <MaterialIcons
                name="cloud-off"
                size={30}
                color={colors.danger}
              />
            ) : (
              <Animated.View
                style={{
                  transform: [{ rotate: spin }],
                }}
              >
                <MaterialIcons
                  name="sync"
                  size={30}
                  color={colors.primary}
                />
              </Animated.View>
            )}
          </View>

          <Text
            style={[styles.title, { color: colors.textDark }]}
          >
            {hasError
              ? 'Could Not Restore Your Data'
              : 'Restoring Your Data'}
          </Text>

          <Text
            style={[styles.subtitle, { color: colors.textLight }]}
          >
            {hasError
              ? 'Check your internet connection and try again. Your account is safe on our servers.'
              : "We found your data from before - just bringing it onto this device. Won't take long."}
          </Text>

          {!hasError && (

            <View style={styles.progressBlock}>

              <View style={styles.percentRow}>
                <CountUp
                  value={percentage}
                  suffix="%"
                  style={[
                    styles.percentText,
                    { color: colors.primary },
                  ]}
                />
                <Text
                  style={[
                    styles.stepCount,
                    { color: colors.textLight },
                  ]}
                >
                  {`Step ${Math.min(
                    progress?.completed ?? 0,
                    progress?.total ?? 1
                  )} of ${progress?.total ?? 1}`}
                </Text>
              </View>

              <AnimatedBar
                percentage={percentage}
                color={colors.primary}
                trackColor={
                  isDarkMode
                    ? 'rgba(165,180,252,0.16)'
                    : '#E5E7EB'
                }
                height={9}
                pulse={phase !== 'done'}
                style={styles.bar}
              />

              <Text
                style={[
                  styles.stepLabel,
                  { color: colors.textLight },
                ]}
              >
                {stepLabel}
              </Text>

            </View>

          )}

          {hasError && (

            <View style={styles.errorActions}>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry restoring your data"
                style={({ hovered, pressed }) => [
                  styles.retryButton,
                  { backgroundColor: colors.primary },
                  (hovered || pressed) && { opacity: 0.9 },
                ]}
                onPress={onRetry}
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

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue without syncing"
                style={({ hovered, pressed }) => [
                  styles.secondaryAction,
                  (hovered || pressed) && { opacity: 0.7 },
                ]}
                onPress={onContinueOffline}
              >
                <Text
                  style={[
                    styles.secondaryActionText,
                    { color: colors.textLight },
                  ]}
                >
                  Continue without syncing for now
                </Text>
              </Pressable>

            </View>

          )}

        </Animated.View>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,15,25,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },

  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 10,
  },

  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },

  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  subtitle: {
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },

  progressBlock: {
    width: '100%',
  },

  percentRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  percentText: {
    fontSize: 26,
    fontWeight: '800',
  },

  stepCount: {
    fontSize: 12,
    fontWeight: '600',
  },

  bar: {
    width: '100%',
  },

  stepLabel: {
    fontSize: 12.5,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },

  errorActions: {
    width: '100%',
  },

  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    width: '100%',
  },

  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  secondaryAction: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },

  secondaryActionText: {
    fontSize: 12.5,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

});
