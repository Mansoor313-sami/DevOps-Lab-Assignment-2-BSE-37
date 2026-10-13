import React from 'react';

import {
  View,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import {
  useTheme,
} from '../context/ThemeContext';

import {
  CARD_RADIUS,
  SHADOW,
  TYPOGRAPHY,
} from '../constants/layout';

import {
  useLoop,
  useDrive,
  sweepStyle,
  spinStyle,
} from '../utils/motion';

/* ------------------------------------------------------------------
   DECORATIVE GRAPHICS

   react-native-svg and gradient libraries are not part of this
   project, so depth is built from layered, blurred looking Views:
   large translucent circles, soft bands and clipped curves. Every
   layer here is scenery, so all of it is hidden from screen readers
   and none of it accepts touches.
------------------------------------------------------------------- */

const decorative = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
  pointerEvents: 'none',
};

/* AURORA
   Two oversized, offset, low opacity discs that drift slowly. Reads
   as a soft gradient wash without needing a gradient library. */

export function Aurora({
  reduceMotion = false,
  tint,
  secondTint,
  intensity = 1,
  style,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const drift = useLoop(reduceMotion, { duration: 5200 });
  const breathe = useLoop(reduceMotion, { duration: 3600 });

  const primary = tint || colors.primary;
  const secondary = secondTint || colors.secondary;
  const third = colors.accent;

  const baseOpacity =
    (isDarkMode ? 0.20 : 0.16) * intensity;

  return (
    <View
      {...decorative}
      style={[styles.fill, styles.clip, style]}
    >
      <Animated.View
        style={[
          styles.auroraOne,
          {
            backgroundColor: primary,
            opacity: baseOpacity,
            transform: [
              {
                translateX: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-14, 18],
                }),
              },
              {
                translateY: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -12],
                }),
              },
              {
                scale: breathe.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.12],
                }),
              },
            ],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.auroraTwo,
          {
            backgroundColor: secondary,
            opacity: baseOpacity * 0.85,
            transform: [
              {
                translateX: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, -12],
                }),
              },
              {
                translateY: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-6, 10],
                }),
              },
              {
                scale: breathe.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1.08, 0.96],
                }),
              },
            ],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.auroraThree,
          {
            backgroundColor: third,
            opacity: baseOpacity * 0.5,
            transform: [
              {
                translateX: drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-8, 12],
                }),
              },
              {
                translateY: breathe.interpolate({
                  inputRange: [0, 1],
                  outputRange: [6, -8],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

/* SHEEN
   A single diagonal band of light that sweeps across a surface, the
   way a highlight travels over glass or brushed metal. Purely
   decorative and one-directional, so it uses the driver that resets
   instead of ping-ponging. */

export function Sheen({
  reduceMotion = false,
  width = 320,
  color,
  duration = 3200,
  style,
}) {

  const {
    isDarkMode,
  } = useTheme();

  const drive = useDrive(reduceMotion, { duration });

  if (reduceMotion) {
    return null;
  }

  const bandColor =
    color ||
    (isDarkMode
      ? 'rgba(255,255,255,0.06)'
      : 'rgba(255,255,255,0.55)');

  return (
    <View {...decorative} style={[styles.fill, styles.clip, style]}>
      <Animated.View
        style={[
          styles.sheenBand,
          {
            backgroundColor: bandColor,
            opacity: drive.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.9, 0],
            }),
            ...sweepStyle(drive, width),
          },
        ]}
      />
    </View>
  );
}

/* CONIC GLOW
   A slowly rotating soft glow behind a focal icon. There is no conic
   gradient primitive here, so the look is built from two offset
   discs sharing one rotation, which reads as a single revolving
   light without any gradient library. */

export function ConicGlow({
  reduceMotion = false,
  size = 96,
  tint,
  style,
}) {

  const {
    colors,
  } = useTheme();

  const spin = useDrive(reduceMotion, { duration: 7000 });

  const accent = tint || colors.primary;

  const spinTransform =
    reduceMotion ? null : spinStyle(spin);

  return (
    <Animated.View
      {...decorative}
      style={[
        styles.conicWrap,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        spinTransform,
        style,
      ]}
    >
      <View
        style={[
          styles.conicLobe,
          {
            backgroundColor: accent,
            width: size,
            height: size,
            borderRadius: size / 2,
          },
        ]}
      />
      <View
        style={[
          styles.conicLobe,
          {
            backgroundColor: colors.secondary,
            width: size * 0.82,
            height: size * 0.82,
            borderRadius: size / 2,
            left: size * 0.18,
            top: size * 0.1,
            opacity: 0.7,
          },
        ]}
      />
    </Animated.View>
  );
}

/* FLOATING PARTICLES
   A scatter of small drifting motes that lifts a flat panel into a
   scene with depth. Each mote gets a fixed pseudo-random position and
   shares one loop, so the effect costs a single Animated.Value no
   matter how many motes are drawn. */

export function FloatingParticles({
  reduceMotion = false,
  count = 6,
  color,
  style,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const drift = useLoop(reduceMotion, { duration: 3000 });

  const dotColor =
    color ||
    (isDarkMode
      ? 'rgba(165,180,252,0.5)'
      : 'rgba(91,95,239,0.32)');

  /* Deterministic layout: a fixed spread so the scene is stable
     across renders but still looks organic. */

  const motes =
    Array.from({ length: count }).map((_, index) => {
      const seed = (index * 47) % 100;
      const seedTwo = (index * 83) % 100;
      return {
        left: `${8 + (seed * 0.84)}%`,
        top: `${12 + (seedTwo * 0.7)}%`,
        size: 4 + (index % 3) * 2,
        rise: 6 + (index % 4) * 3,
        phase: index % 2 === 0 ? 1 : -1,
      };
    });

  return (
    <View {...decorative} style={[styles.fill, styles.clip, style]}>
      {motes.map((mote, index) => (
        <Animated.View
          key={index}
          style={{
            position: 'absolute',
            left: mote.left,
            top: mote.top,
            width: mote.size,
            height: mote.size,
            borderRadius: mote.size / 2,
            backgroundColor: dotColor,
            opacity: reduceMotion
              ? 0.6
              : drift.interpolate({
                  inputRange: [0, 1],
                  outputRange: mote.phase > 0 ? [0.35, 0.9] : [0.9, 0.35],
                }),
            transform: reduceMotion
              ? undefined
              : [
                  {
                    translateY: drift.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -mote.rise * mote.phase],
                    }),
                  },
                ],
          }}
        />
      ))}
    </View>
  );
}

/* GLASS CARD
   A frosted panel with a lit top edge and an optional sheen sweep.
   react-native has no backdrop blur on every target, so the "glass"
   is a translucent fill, a bright hairline border and a soft inner
   highlight — the cues the eye actually reads as glass. */

export function GlassCard({
  children,
  reduceMotion = false,
  sheen = false,
  tint,
  style,
  ...rest
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  return (
    <View
      style={[
        styles.glass,
        {
          backgroundColor: isDarkMode
            ? 'rgba(30,41,59,0.62)'
            : 'rgba(255,255,255,0.7)',
          borderColor: isDarkMode
            ? 'rgba(165,180,252,0.18)'
            : 'rgba(255,255,255,0.9)',
        },
        SHADOW,
        style,
      ]}
      {...rest}
    >
      <View
        {...decorative}
        style={[
          styles.glassEdge,
          {
            backgroundColor: isDarkMode
              ? 'rgba(165,180,252,0.24)'
              : 'rgba(255,255,255,0.95)',
          },
        ]}
      />
      {sheen && (
        <Sheen reduceMotion={reduceMotion} color={tint} />
      )}
      {children}
    </View>
  );
}

/* MESH
   Faint grid of dots. Adds texture behind plain lists so an empty
   screen does not read as a blank sheet. */

export function MeshDots({
  rows = 4,
  columns = 7,
  gap = 26,
  style,
}) {

  const {
    isDarkMode,
  } = useTheme();

  return (
    <View {...decorative} style={[styles.fill, styles.clip, style]}>
      <View style={styles.meshWrap}>
        {Array.from({ length: rows }).map((_, r) => (
          <View key={r} style={[styles.meshRow, { marginBottom: gap - 3 }]}>
            {Array.from({ length: columns }).map((__, c) => (
              <View
                key={c}
                style={[
                  styles.meshDot,
                  {
                    marginRight: gap,
                    backgroundColor: isDarkMode
                      ? 'rgba(165,180,252,0.16)'
                      : 'rgba(91,95,239,0.13)',
                  },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/* SCREEN HEADER
   One header used across screens so they stop each inventing their
   own. Layered art, floating icon and optional trailing slot. */

export function ScreenHeader({
  title,
  subtitle,
  icon = 'auto-awesome',
  onBack,
  canGoBack = false,
  right,
  reduceMotion = false,
  tint,
  style,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const float = useLoop(reduceMotion, { duration: 2400 });

  const accent = tint || colors.primary;

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: isDarkMode
            ? colors.card
            : '#EEE9FF',
          borderColor: isDarkMode
            ? 'rgba(165,180,252,0.14)'
            : 'rgba(124,58,237,0.08)',
        },
        style,
      ]}
    >

      <Aurora
        reduceMotion={reduceMotion}
        tint={accent}
      />

      <FloatingParticles
        reduceMotion={reduceMotion}
        count={5}
        color={
          isDarkMode
            ? 'rgba(165,180,252,0.42)'
            : 'rgba(124,58,237,0.20)'
        }
      />

      <Sheen
        reduceMotion={reduceMotion}
        duration={4200}
        width={260}
      />

      <View {...decorative} style={styles.fill}>
        <View
          style={[
            styles.headerBand,
            {
              backgroundColor: isDarkMode
                ? 'rgba(99,102,241,0.12)'
                : 'rgba(255,255,255,0.44)',
            },
          ]}
        />
        <View
          style={[
            styles.headerCurve,
            {
              borderColor: isDarkMode
                ? 'rgba(165,180,252,0.18)'
                : 'rgba(91,95,239,0.14)',
            },
          ]}
        />
      </View>

      <View style={styles.headerRow}>

        {canGoBack && (
          <View
            style={[
              styles.backSlot,
              { backgroundColor: colors.card },
              SHADOW,
            ]}
          >
            <MaterialIcons
              name="arrow-back"
              size={24}
              color={accent}
              onPress={onBack}
            />
          </View>
        )}

        <View style={styles.headerCopy}>
          <Text
            numberOfLines={1}
            style={[styles.headerTitle, { color: accent }]}
          >
            {title}
          </Text>
          {Boolean(subtitle) && (
            <Text
              numberOfLines={2}
              style={[
                styles.headerSubtitle,
                { color: colors.textLight },
              ]}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {right}

        <Animated.View
          {...decorative}
          style={[
            styles.headerIcon,
            {
              backgroundColor: isDarkMode
                ? 'rgba(15,23,42,0.82)'
                : 'rgba(255,255,255,0.88)',
              borderColor: isDarkMode
                ? 'rgba(165,180,252,0.14)'
                : 'transparent',
              borderWidth: isDarkMode ? 1 : 0,
              transform: [
                {
                  translateY: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6],
                  }),
                },
                {
                  rotate: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '6deg'],
                  }),
                },
              ],
            },
            SHADOW,
          ]}
        >
          <MaterialIcons
            name={icon}
            size={26}
            color={accent}
          />
        </Animated.View>

      </View>
    </View>
  );
}

/* EMPTY STATE
   A drawn illustration instead of a lone line of grey text, with a
   slow bob so the screen still feels alive when it has no data. */

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
  reduceMotion = false,
  style,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const bob = useLoop(reduceMotion, { duration: 2000 });

  return (
    <View
      style={[
        styles.empty,
        {
          backgroundColor: colors.card,
          borderColor: isDarkMode
            ? 'rgba(165,180,252,0.12)'
            : 'rgba(91,95,239,0.08)',
        },
        style,
      ]}
    >

      <MeshDots rows={3} columns={6} gap={30} />

      <Animated.View
        {...decorative}
        style={[
          styles.emptyArt,
          {
            transform: [
              {
                translateY: bob.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -7],
                }),
              },
            ],
          },
        ]}
      >
        <View
          style={[
            styles.emptyGlow,
            { backgroundColor: `${colors.primary}1F` },
          ]}
        />
        <View
          style={[
            styles.emptyCircle,
            {
              backgroundColor: isDarkMode
                ? 'rgba(91,95,239,0.18)'
                : '#EEF2FF',
            },
          ]}
        >
          <MaterialIcons
            name={icon}
            size={34}
            color={colors.primary}
          />
        </View>
      </Animated.View>

      <Text style={[styles.emptyTitle, { color: colors.textDark }]}>
        {title}
      </Text>

      {Boolean(message) && (
        <Text style={[styles.emptyText, { color: colors.textLight }]}>
          {message}
        </Text>
      )}

      {action}
    </View>
  );
}

/* SECTION TITLE with a small accent rule. */

export function SectionTitle({
  children,
  tint,
  right,
  style,
}) {

  const { colors } = useTheme();

  return (
    <View style={[styles.sectionRow, style]}>
      <View
        style={[
          styles.sectionRule,
          { backgroundColor: tint || colors.primary },
        ]}
      />
      <Text
        style={[styles.sectionText, { color: colors.textDark }]}
      >
        {children}
      </Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({

  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  clip: {
    overflow: 'hidden',
  },

  /* AURORA */

  auroraOne: {
    position: 'absolute',
    top: -90,
    left: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
  },

  auroraTwo: {
    position: 'absolute',
    bottom: -110,
    right: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
  },

  auroraThree: {
    position: 'absolute',
    top: '30%',
    left: '38%',
    width: 150,
    height: 150,
    borderRadius: 75,
  },

  /* SHEEN */

  sheenBand: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    left: 0,
    width: 70,
  },

  /* CONIC GLOW */

  conicWrap: {
    position: 'relative',
    overflow: 'hidden',
  },

  conicLobe: {
    position: 'absolute',
    top: 0,
    left: 0,
  },

  /* GLASS CARD */

  glass: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    padding: 16,
  },

  glassEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
  },

  /* MESH */

  meshWrap: {
    position: 'absolute',
    top: 18,
    left: 18,
  },

  meshRow: {
    flexDirection: 'row',
  },

  meshDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },

  /* HEADER */

  header: {
    position: 'relative',
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 22,
  },

  headerBand: {
    position: 'absolute',
    left: -40,
    right: -48,
    top: 44,
    height: 74,
    borderTopLeftRadius: 160,
    borderTopRightRadius: 190,
    transform: [{ rotate: '-6deg' }],
  },

  headerCurve: {
    position: 'absolute',
    right: -24,
    top: 24,
    width: 230,
    height: 46,
    borderTopWidth: 2,
    borderRadius: 140,
    transform: [{ rotate: '-12deg' }],
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 3,
  },

  backSlot: {
    width: 46,
    height: 46,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },

  headerCopy: {
    flex: 1,
  },

  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
  },

  headerSubtitle: {
    marginTop: 4,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '600',
    lineHeight: 18,
  },

  headerIcon: {
    width: 50,
    height: 50,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* EMPTY */

  empty: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    paddingVertical: 34,
    paddingHorizontal: 24,
    alignItems: 'center',
    ...SHADOW,
  },

  emptyArt: {
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyGlow: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
  },

  emptyCircle: {
    width: 72,
    height: 72,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyTitle: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptyText: {
    marginTop: 7,
    fontSize: TYPOGRAPHY.small,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },

  /* SECTION */

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 24,
    marginBottom: 14,
  },

  sectionRule: {
    width: 4,
    height: 18,
    borderRadius: 2,
  },

  sectionText: {
    fontSize: TYPOGRAPHY.sectionTitle,
    fontWeight: '800',
  },

});
