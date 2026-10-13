import React, {
  useState,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import COLORS from '../constants/colors';

import {
  CARD_RADIUS,
  HEADER_TOP_PADDING,
  MAX_CONTENT_WIDTH,
  SCREEN_BOTTOM_PADDING,
  SCREEN_PADDING,
  SHADOW,
} from '../constants/layout';

import {
  useTheme,
} from '../context/ThemeContext';

const { width } =
  Dimensions.get('window');

/* LAYOUT ANIMATION
   Enables the smooth expand/collapse on old Android. */

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const updates = [
  {
    title: 'Firebase Cloud Sync',
    details:
      'Login, signup, profile, subjects, tasks, attendance, class schedules, date sheets, and alerts now save through Firebase REST APIs.',
    icon: 'cloud-done',
  },
  {
    title: 'Secure Student Auth',
    details:
      'Signup validates email, Reg No format, and strong passwords. Login supports email or Reg No.',
    icon: 'verified-user',
  },
  {
    title: 'Profile System',
    details:
      'Students can save name, email, semester, department, phone, bio, and profile picture.',
    icon: 'account-circle',
  },
  {
    title: 'Class Management',
    details:
      'Class schedules can now be saved per subject with day, time, room, multiple entries, and 5-minute reminders.',
    icon: 'school',
  },
  {
    title: 'Attendance Management',
    details:
      'Attendance portal added with per-subject settings, absence records, 80% tracking, progress bars, and critical alerts.',
    icon: 'fact-check',
  },
  {
    title: 'Attendance Records',
    details:
      'Mark Present/Absent, adjust absences, save recent records, and clear attendance history when needed.',
    icon: 'history',
  },
  {
    title: 'Date Sheet Management',
    details:
      'Students can add paper date, time, room, subject, and paper type with exam-day and 5-minute reminders.',
    icon: 'event-note',
  },
  {
    title: 'Saved Alerts',
    details:
      'Notifications now save inside the Alerts section and can be cleared anytime.',
    icon: 'notifications-active',
  },
  {
    title: 'Deadline Alerts',
    details:
      'Deadline notifications now schedule correctly with Android deadline channel support.',
    icon: 'alarm',
  },
  {
    title: 'Calendar Details',
    details:
      'Calendar shows deadlines with subject details, selected-date tasks, and highlighted current date.',
    icon: 'calendar-month',
  },
  {
    title: 'Contact Us',
    details:
      'WhatsApp, Gmail, Instagram, and Facebook contact cards added with updated brand image icons.',
    icon: 'support-agent',
  },
  {
    title: 'Navigation Update',
    details:
      'Bottom navigation now focuses on Home, Subjects, Attendance, and Alerts. Other pages moved into the drawer.',
    icon: 'navigation',
  },
  {
    title: 'Modern UI Refresh',
    details:
      'Home, drawer, subjects, attendance, profile, contact, settings, calendar, and detail pages received hero sections, waves, illustrations, better cards, and hover effects.',
    icon: 'auto-awesome',
  },
  {
    title: 'Responsive Layout',
    details:
      'Safe-area spacing, bottom navigation spacing, mobile/tablet responsiveness, and dark-mode contrast were improved.',
    icon: 'devices',
  },
  {
    title: 'Keyboard Fixes',
    details:
      'Input screens and modals were adjusted to avoid keyboard overlap, screen flicker, and layout jumps.',
    icon: 'keyboard',
  },
  {
    title: 'Cleanup and Stability',
    details:
      'Unused files were removed, notification duplicate risks reduced, and code paths were checked with Expo Doctor.',
    icon: 'build-circle',
  },
];

export default function WhatsNewScreen({
  goBack,
  canGoBack,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  /* EXPANDED UPDATE
     Rows are pressable, so tapping one now reveals its full
     description instead of doing nothing. */

  const [expandedTitle, setExpandedTitle] =
    useState(updates[0]?.title || null);

  const toggleUpdate = (title) => {

    LayoutAnimation.configureNext(
      LayoutAnimation.Presets.easeInEaseOut
    );

    setExpandedTitle((current) =>
      current === title
        ? null
        : title
    );
  };

  return (

    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor:
            colors.background,
        },
      ]}
    >
      <StatusBar
        backgroundColor={
          colors.background
        }
        barStyle={
          isDarkMode
            ? 'light-content'
            : 'dark-content'
        }
      />

      <ScrollView
        style={[
          styles.container,
          {
            backgroundColor:
              colors.background,
          },
        ]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: SCREEN_BOTTOM_PADDING,
        }}
      >
        <View
          style={[
            styles.header,
            {
              backgroundColor:
                isDarkMode
                  ? colors.card
                  : '#EEE9FF',
              borderColor:
                isDarkMode
                  ? 'rgba(165,180,252,0.14)'
                  : 'rgba(124,58,237,0.08)',
            },
          ]}
        >
          <View style={[styles.headerWaveOne, isDarkMode && styles.headerWaveDark]} />
          <View style={[styles.headerWaveTwo, isDarkMode && styles.headerWaveTwoDark]} />
          <View style={[styles.headerCurve, isDarkMode && styles.headerCurveDark]} />
          <View style={[styles.heroIcon, isDarkMode && styles.heroIconDark]}>
            <MaterialIcons
              name="new-releases"
              size={28}
              color={colors.primary}
            />
          </View>
          <View style={styles.heroSparkleOne} />
          <View style={styles.heroSparkleTwo} />
          {canGoBack && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ hovered, pressed }) => [
                styles.backButton,
                {
                  backgroundColor:
                    colors.card,
                },
                hovered && styles.iconButtonHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={goBack}
            >
              <MaterialIcons
                name="arrow-back"
                size={26}
                color={colors.primary}
              />
            </Pressable>
          )}

          <View style={styles.titleBlock}>
            <Text
              style={[
                styles.title,
                {
                  color: colors.primary,
                },
              ]}
            >
              What's New
            </Text>
            <Text
              style={[
                styles.subtitle,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Latest app updates and fixes
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.summaryCard,
            {
              backgroundColor:
                colors.card,
              borderColor:
                isDarkMode
                  ? 'rgba(165,180,252,0.12)'
                  : 'rgba(91,95,239,0.08)',
            },
          ]}
        >
          <View style={[styles.summaryWave, isDarkMode && styles.summaryWaveDark]} />
          <View style={styles.summarySparkleOne} />
          <MaterialIcons
            name="auto-awesome"
            size={30}
            color={colors.primary}
          />
          <Text
            style={[
              styles.summaryTitle,
              {
                color: colors.textDark,
              },
            ]}
          >
            QuizMate Update
          </Text>
          <Text
            style={[
              styles.summaryText,
              {
                color: colors.textLight,
              },
            ]}
          >
            This release improves attendance tracking, reminders,
            profile management, navigation, and overall app polish.
          </Text>
        </View>

        <View style={styles.list}>
          {updates.map((item, index) => {

            const isExpanded =
              expandedTitle === item.title;

            return (

              <Pressable
                key={item.title}
                accessibilityRole="button"
                accessibilityState={{
                  expanded: isExpanded,
                }}
                accessibilityLabel={item.title}
                accessibilityHint={
                  isExpanded
                    ? 'Tap to hide details'
                    : 'Tap to show details'
                }
                onPress={() =>
                  toggleUpdate(item.title)
                }
                style={({ hovered, pressed }) => [
                  styles.updateRow,
                  {
                    backgroundColor:
                      colors.card,
                    borderColor:
                      isExpanded
                        ? 'rgba(91,95,239,0.32)'
                        : hovered
                          ? 'rgba(91,95,239,0.24)'
                          : isDarkMode
                            ? 'rgba(165,180,252,0.10)'
                            : 'rgba(91,95,239,0.07)',
                  },
                  hovered && styles.updateRowHover,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View
                  style={[
                    styles.updateAccent,
                    {
                      backgroundColor:
                        colors.primary,
                    },
                  ]}
                />
                <View
                  style={[
                    styles.numberBadge,
                    {
                      backgroundColor:
                        isExpanded
                          ? colors.primary
                          : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.numberText,
                      {
                        color:
                          isExpanded
                            ? '#FFFFFF'
                            : colors.primary,
                      },
                    ]}
                  >
                    {index + 1}
                  </Text>
                </View>
                <View
                  style={[
                    styles.updateIcon,
                    {
                      backgroundColor:
                        colors.surface,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={item.icon}
                    size={20}
                    color={colors.primary}
                  />
                </View>

                <View style={styles.updateContent}>
                  <Text
                    style={[
                      styles.updateTitle,
                      {
                        color:
                          colors.textDark,
                      },
                    ]}
                  >
                    {item.title}
                  </Text>

                  {isExpanded && (
                    <Text
                      style={[
                        styles.updateDetails,
                        {
                          color:
                            colors.textLight,
                        },
                      ]}
                    >
                      {item.details}
                    </Text>
                  )}
                </View>

                <MaterialIcons
                  name={
                    isExpanded
                      ? 'expand-less'
                      : 'expand-more'
                  }
                  size={22}
                  color={colors.textLight}
                  style={styles.chevron}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: HEADER_TOP_PADDING,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },

  header: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 24,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 24,
  },

  headerWaveOne: {
    position: 'absolute',
    left: -44,
    right: -52,
    top: 34,
    height: 68,
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderTopLeftRadius: 150,
    borderTopRightRadius: 190,
    transform: [{ rotate: '-7deg' }],
  },

  headerWaveDark: {
    backgroundColor: 'rgba(99,102,241,0.12)',
  },

  headerWaveTwo: {
    position: 'absolute',
    left: -36,
    right: -42,
    bottom: -20,
    height: 78,
    backgroundColor: 'rgba(221,214,254,0.48)',
    borderTopLeftRadius: 180,
    borderTopRightRadius: 120,
    transform: [{ rotate: '6deg' }],
  },

  headerWaveTwoDark: {
    backgroundColor: 'rgba(124,58,237,0.12)',
  },

  headerCurve: {
    position: 'absolute',
    right: -20,
    top: 28,
    width: width * 0.58,
    height: 44,
    borderTopWidth: 2,
    borderColor: 'rgba(91,95,239,0.14)',
    borderRadius: 130,
    transform: [{ rotate: '-13deg' }],
  },

  headerCurveDark: {
    borderColor: 'rgba(165,180,252,0.18)',
  },

  heroIcon: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  heroIconDark: {
    backgroundColor: 'rgba(15,23,42,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(165,180,252,0.14)',
  },

  heroSparkleOne: {
    position: 'absolute',
    right: 98,
    top: 22,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor: 'rgba(196,181,253,0.78)',
    transform: [{ rotate: '45deg' }],
  },

  heroSparkleTwo: {
    position: 'absolute',
    right: 116,
    bottom: 24,
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor: 'rgba(250,204,21,0.62)',
    transform: [{ rotate: '45deg' }],
  },

  backButton: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 48,
    height: 48,
    borderRadius: CARD_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 4,
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  titleBlock: {
    paddingLeft: 64,
    paddingRight: 70,
    minHeight: 78,
    justifyContent: 'center',
    zIndex: 3,
  },

  title: {
    fontSize: 30,
    fontWeight: 'bold',
  },

  subtitle: {
    marginTop: 6,
    fontSize: 14,
    fontWeight: '600',
  },

  summaryCard: {
    position: 'relative',
    borderRadius: CARD_RADIUS,
    padding: 22,
    marginBottom: 18,
    borderWidth: 1,
    overflow: 'hidden',
    ...SHADOW,
  },

  summaryWave: {
    position: 'absolute',
    left: -38,
    right: -48,
    bottom: -34,
    height: 98,
    backgroundColor: 'rgba(221,214,254,0.34)',
    borderTopLeftRadius: 180,
    borderTopRightRadius: 130,
    transform: [{ rotate: '5deg' }],
  },

  summaryWaveDark: {
    backgroundColor: 'rgba(124,58,237,0.11)',
  },

  summarySparkleOne: {
    position: 'absolute',
    right: 42,
    top: 28,
    width: 11,
    height: 11,
    borderRadius: 4,
    backgroundColor: 'rgba(196,181,253,0.76)',
    transform: [{ rotate: '45deg' }],
  },

  summaryTitle: {
    marginTop: 12,
    fontSize: 20,
    fontWeight: 'bold',
  },

  summaryText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
  },

  list: {
    gap: 12,
  },

  updateRow: {
    position: 'relative',
    borderRadius: CARD_RADIUS,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    overflow: 'hidden',
    cursor: Platform.OS === 'web' ? 'pointer' : undefined,
    ...SHADOW,
  },

  updateRowHover: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    transform: [{ translateY: -3 }],
  },

  updateAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    opacity: 0.88,
  },

  chevron: {
    marginLeft: 6,
    alignSelf: 'center',
  },

  numberBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13,
  },

  updateIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 13,
  },

  numberText: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  updateContent: {
    flex: 1,
  },

  updateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },

  updateDetails: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },

  iconButtonHover: {
    borderWidth: 1,
    borderColor: 'rgba(91,95,239,0.22)',
    transform: [{ translateY: -2 }],
  },

  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },

});
