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

const guideItems = [
  {
    title: 'Create Your Account',
    icon: 'person-add',
    details:
      'Sign up with a valid email, Reg No, and strong password. After signup, login with email or Reg No.',
  },
  {
    title: 'Add Subjects',
    icon: 'menu-book',
    details:
      'Open Subjects, press +, enter subject name, choose Theory or Lab, then save. Each subject keeps its own tasks, attendance, and class data.',
  },
  {
    title: 'Add Quizzes and Assignments',
    icon: 'assignment',
    details:
      'Open any subject, press +, add title, task type, deadline date, and optional time. Tasks stay saved in your account.',
  },
  {
    title: 'Edit, Complete, or Delete Tasks',
    icon: 'edit-note',
    details:
      'Inside a subject, use task actions to update details, mark work as completed, or delete a task when it is no longer needed.',
  },
  {
    title: 'Use Calendar',
    icon: 'calendar-month',
    details:
      'Calendar marks deadline days. Tap any date to see tasks due on that day with subject details.',
  },
  {
    title: 'Track Attendance',
    icon: 'fact-check',
    details:
      'Open Attendance, choose a subject, set attendance per class and total classes, then mark Present or Absent after each class.',
  },
  {
    title: 'Clear Attendance Records',
    icon: 'cleaning-services',
    details:
      'If your recent attendance list becomes long, clear old records from the Attendance module while keeping the subject setup easy to manage.',
  },
  {
    title: 'Understand Attendance Colors',
    icon: 'traffic',
    details:
      'Green means safe, yellow means caution, orange means critical, and red means attendance risk. Keep at least 80%.',
  },
  {
    title: 'Manage Class Timetable',
    icon: 'school',
    details:
      'Open Class Management from drawer. Add day, time, and room for every subject. Multiple schedules per subject are supported.',
  },
  {
    title: 'Edit or Delete Class Schedules',
    icon: 'event-repeat',
    details:
      'If a class time or room changes, update that schedule. You can also delete old schedules so upcoming class data stays correct.',
  },
  {
    title: 'Get Class Reminders',
    icon: 'notifications-active',
    details:
      'The app can remind you 5 minutes before class and shows subject, time, room, and current attendance percentage.',
  },
  {
    title: 'Add Date Sheet Papers',
    icon: 'event-note',
    details:
      'Open Date Sheet, choose subject, paper type, date, time, and room. Upcoming papers also appear on Home.',
  },
  {
    title: 'Receive Deadline Alerts',
    icon: 'alarm',
    details:
      'When a deadline day starts, the app notifies you that the task is pending. Paper-day and 5-minute-before-paper alerts are also supported.',
  },
  {
    title: 'Check Alerts',
    icon: 'notifications',
    details:
      'Open Alerts from bottom navigation to see saved notifications. Use Clear to remove old alerts.',
  },
  {
    title: 'Update Profile',
    icon: 'account-circle',
    details:
      'Open Profile to save your name, email, semester, department, phone, bio, and profile picture.',
  },
  {
    title: 'Use Settings',
    icon: 'settings',
    details:
      'Settings lets you enable or disable notifications, see app version, reset semester data, or logout.',
  },
  {
    title: 'Use Dark Mode',
    icon: 'dark-mode',
    details:
      'Turn dark mode on or off from Settings. Screens, cards, headers, and navigation adjust for comfortable viewing.',
  },
  {
    title: 'Contact Support',
    icon: 'support-agent',
    details:
      'Use Contact Us for WhatsApp, Gmail, Instagram, and Facebook links if you need help or want to share feedback.',
  },
  {
    title: 'Works on Phones and Tablets',
    icon: 'devices',
    details:
      'QuizMate uses safe areas, responsive spacing, and fixed bottom navigation so it can work smoothly on different screen sizes.',
  },
  {
    title: 'Data Safety',
    icon: 'cloud-done',
    details:
      'Your saved data is connected to your login account through Firebase REST, so it can return after reinstall and login.',
  },
];

export default function HowToUseScreen({
  goBack,
  canGoBack,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  /* EXPANDED STEP
     Cards look interactive, so they now behave that way:
     tapping a step expands its detail and collapses the rest. */

  const [expandedTitle, setExpandedTitle] =
    useState(guideItems[0]?.title || null);

  const toggleStep = (title) => {

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
              name="tips-and-updates"
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
              How To Use
            </Text>
            <Text
              style={[
                styles.subtitle,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Learn QuizMate step by step
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
          <MaterialIcons
            name="rocket-launch"
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
            Start With Home
          </Text>
          <Text
            style={[
              styles.summaryText,
              {
                color: colors.textLight,
              },
            ]}
          >
            Home shows your next class or paper, upcoming deadlines,
            attendance overview, and quick navigation for daily study work.
          </Text>
        </View>

        <View style={styles.list}>
          {guideItems.map((item, index) => {

            const isExpanded =
              expandedTitle === item.title;

            return (

              <Pressable
                key={item.title}
                accessibilityRole="button"
                accessibilityState={{
                  expanded: isExpanded,
                }}
                accessibilityLabel={`Step ${index + 1}: ${item.title}`}
                accessibilityHint={
                  isExpanded
                    ? 'Tap to hide details'
                    : 'Tap to show details'
                }
                onPress={() =>
                  toggleStep(item.title)
                }
                style={({ hovered, pressed }) => [
                  styles.guideCard,
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
                  hovered && styles.guideCardHover,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View
                  style={[
                    styles.guideAccent,
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
                    styles.guideIcon,
                    {
                      backgroundColor:
                        colors.surface,
                    },
                  ]}
                >
                  <MaterialIcons
                    name={item.icon}
                    size={21}
                    color={colors.primary}
                  />
                </View>

                <View style={styles.guideContent}>
                  <Text
                    style={[
                      styles.guideTitle,
                      {
                        color: colors.textDark,
                      },
                    ]}
                  >
                    {item.title}
                  </Text>

                  {isExpanded && (
                    <Text
                      style={[
                        styles.guideDetails,
                        {
                          color: colors.textLight,
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
    borderWidth: 1,
    padding: 22,
    marginBottom: 18,
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

  guideCard: {
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

  guideCardHover: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
    transform: [{ translateY: -3 }],
  },

  guideAccent: {
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
    marginRight: 12,
  },

  numberText: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  guideIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },

  guideContent: {
    flex: 1,
  },

  guideTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },

  guideDetails: {
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
