import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FontAwesome, MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { loadSupportContacts } from '../utils/firebaseRest';

const DEFAULT_CONTACTS = [
  { id: 'whatsapp', group: 'support', title: 'WhatsApp Support', value: '+92 312 5999203', icon: 'whatsapp', color: '#25D366', url: 'https://wa.me/923125999203', browserUrl: 'https://wa.me/923125999203', action: 'Chat on WhatsApp', recommended: true },
  { id: 'email', group: 'support', title: 'Email Support', value: 'i.mansoor313@gmail.com', icon: 'envelope', color: '#EA4335', url: 'mailto:i.mansoor313@gmail.com?subject=QuizMate%20Support%20Request', browserUrl: 'https://mail.google.com/mail/?view=cm&fs=1&to=i.mansoor313%40gmail.com&su=QuizMate%20Support%20Request', action: 'Compose an email' },
  { id: 'instagram', group: 'social', title: 'Instagram', value: '@iammansoor313', icon: 'instagram', color: '#E1306C', url: 'https://www.instagram.com/iammansoor313/', action: 'View profile' },
  { id: 'facebook', group: 'social', title: 'Facebook', value: 'Mansoor Ahmad', icon: 'facebook-square', color: '#1877F2', url: 'https://www.facebook.com/mansoor.ahmad.804797/', action: 'Visit page' },
];

const TOPICS = ['Bug report', 'Feature idea', 'Account issue', 'General feedback'];

const normalizedContacts = (remote) => {
  if (!Array.isArray(remote) || !remote.length) return DEFAULT_CONTACTS;
  const safe = remote.filter((item) => item?.id && item?.title && item?.url && item?.isEnabled !== false);
  return safe.length ? safe.map((item) => ({
    ...item,
    group: item.group === 'social' ? 'social' : 'support',
    action: item.action || 'Open link',
    color: item.color || '#5B5FEF',
    icon: item.icon || 'comment',
  })) : DEFAULT_CONTACTS;
};

function Motion({ children, delay = 0, reduce, style }) {
  const opacity = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduce ? 0 : 18)).current;
  useEffect(() => {
    if (reduce) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 260, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay, friction: 8, tension: 54, useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, reduce, translateY]);
  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

function ContactCard({ item, index, colors, reduce, openingId, onOpen, onActions }) {
  const isOpening = openingId === item.id;
  return (
    <Motion reduce={reduce} delay={180 + index * 65}>
      <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: `${item.color}35` }]}>
        <Pressable
          style={({ pressed }) => [styles.contactMain, pressed && styles.pressed]}
          disabled={Boolean(openingId)}
          accessibilityRole="link"
          accessibilityLabel={`${item.title}, ${item.value}`}
          accessibilityHint={`${item.action}. Opens an external application or website.`}
          accessibilityState={{ busy: isOpening, disabled: Boolean(openingId) }}
          onPress={() => onOpen(item)}
        >
          <View style={[styles.brandAccent, { backgroundColor: item.color }]} />
          <View style={[styles.iconCircle, { backgroundColor: `${item.color}1A` }]}>
            <FontAwesome name={item.icon} size={25} color={item.color} />
          </View>
          <View style={styles.contactCopy}>
            <View style={styles.titleRow}>
              <Text selectable style={[styles.contactTitle, { color: colors.textDark }]}>{item.title}</Text>
              {item.recommended && <Text style={[styles.recommended, { color: item.color, backgroundColor: `${item.color}18` }]}>Recommended</Text>}
            </View>
            <Text selectable style={[styles.contactValue, { color: colors.textLight }]}>{item.value}</Text>
            <Text style={[styles.contactAction, { color: item.color }]}>{isOpening ? `Opening ${item.title}…` : item.action}</Text>
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.moreButton, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && styles.pressed]}
          disabled={Boolean(openingId)}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${item.title}`}
          onPress={() => onActions(item)}
        >
          {isOpening ? <ActivityIndicator size="small" color={item.color} /> : <MaterialIcons name="more-horiz" size={24} color={colors.textLight} />}
        </Pressable>
      </View>
    </Motion>
  );
}

export default function ContactUsScreenV2({ goBack, canGoBack, currentUser }) {
  const { colors, isDarkMode } = useTheme();
  const { showError, showSuccess } = useToast();
  const { width } = useWindowDimensions();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [contacts, setContacts] = useState(DEFAULT_CONTACTS);
  const [openingId, setOpeningId] = useState('');
  const [selectedContact, setSelectedContact] = useState(null);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState('');
  const heroFloat = useRef(new Animated.Value(0)).current;
  const ctaPulse = useRef(new Animated.Value(0)).current;
  const livePulse = useRef(new Animated.Value(0)).current;
  const compact = width < 380;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => subscription?.remove?.();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      heroFloat.stopAnimation();
      heroFloat.setValue(0);
      ctaPulse.setValue(0);
      livePulse.setValue(0);
      return undefined;
    }
    const heroLoop = Animated.loop(Animated.sequence([
      Animated.timing(heroFloat, { toValue: 1, duration: 2200, useNativeDriver: true }),
      Animated.timing(heroFloat, { toValue: 0, duration: 2200, useNativeDriver: true }),
    ]));
    const ctaLoop = Animated.loop(Animated.sequence([
      Animated.timing(ctaPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(ctaPulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      Animated.delay(1900),
    ]));
    const liveLoop = Animated.loop(Animated.sequence([
      Animated.timing(livePulse, { toValue: 1, duration: 720, useNativeDriver: true }),
      Animated.timing(livePulse, { toValue: 0, duration: 720, useNativeDriver: true }),
    ]));
    heroLoop.start();
    ctaLoop.start();
    liveLoop.start();
    return () => { heroLoop.stop(); ctaLoop.stop(); liveLoop.stop(); };
  }, [ctaPulse, heroFloat, livePulse, reduceMotion]);

  useEffect(() => {
    let active = true;
    loadSupportContacts()
      .then((remote) => active && setContacts(normalizedContacts(remote)))
      .catch(() => active && setContacts(DEFAULT_CONTACTS));
    return () => { active = false; };
  }, []);

  const haptic = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const copy = async (value, label) => {
    await Clipboard.setStringAsync(value);
    haptic();
    showSuccess(`${label} copied.`);
  };

  const open = async (item, browser = false) => {
    if (openingId) return;
    setOpeningId(item.id);
    haptic();
    try {
      const target = browser ? (item.browserUrl || item.url) : item.url;
      const supported = await Linking.canOpenURL(target);
      if (!supported) throw new Error('Unavailable');
      await Linking.openURL(target);
      setSelectedContact(null);
    } catch (error) {
      setSelectedContact(item);
      showError(`Could not open ${item.title}. You can copy the contact detail instead.`);
    } finally {
      setOpeningId('');
    }
  };

  const submitSupportRequest = async () => {
    const email = contacts.find((item) => item.id === 'email')?.value || 'i.mansoor313@gmail.com';
    const body = [
      `Topic: ${topic}`,
      '',
      message.trim() || 'Please describe your issue or suggestion here.',
      '',
      '--- QuizMate support context ---',
      `Platform: ${Platform.OS}`,
      `Student: ${currentUser?.name || 'Not provided'}`,
      `Registration no.: ${currentUser?.regNo || 'Not provided'}`,
    ].join('\n');
    const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`[QuizMate] ${topic}`)}&body=${encodeURIComponent(body)}`;
    await open({ id: 'support-request', title: 'Email Support', url, value: email });
  };

  const shareQuizMate = async () => {
    try {
      haptic();
      await Share.share({
        message: 'Try QuizMate to manage subjects, attendance, deadlines, classes, and date sheets.',
      });
    } catch (error) {
      showError('Could not open sharing right now. Please try again.');
    }
  };

  const support = contacts.filter((item) => item.group !== 'social');
  const social = contacts.filter((item) => item.group === 'social');

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar backgroundColor={colors.background} barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingHorizontal: compact ? 16 : 20 }]}>
        <View style={[styles.content, { maxWidth: width >= 768 ? 760 : undefined }]}>
          <Motion reduce={reduceMotion} style={[styles.hero, { backgroundColor: isDarkMode ? colors.card : '#EEE9FF', borderColor: colors.border }]}>
            <Animated.View accessibilityElementsHidden style={[styles.heroOrbOne, { transform: [{ translateX: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -18] }) }, { translateY: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) }] }]} />
            <Animated.View accessibilityElementsHidden style={[styles.heroOrbTwo, { transform: [{ scale: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.1] }) }] }]} />
            {canGoBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={goBack} style={[styles.back, { backgroundColor: colors.card }]}><MaterialIcons name="arrow-back" size={24} color={colors.primary} /></Pressable>}
            <View style={[styles.heroCopy, canGoBack && styles.heroCopyWithBack]}>
              <Text selectable style={[styles.heroTitle, compact && styles.heroTitleCompact, { color: colors.textDark }]}>Contact Us</Text>
              <Text selectable style={[styles.heroSub, { color: colors.textLight }]}>Support, feedback, and QuizMate updates</Text>
            </View>
            <Animated.View accessibilityElementsHidden style={[styles.heroIcon, { backgroundColor: colors.card, transform: [{ translateY: heroFloat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }, { rotate: heroFloat.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '6deg'] }) }] }]}>
              <MaterialIcons name="support-agent" size={30} color={colors.primary} />
            </Animated.View>
          </Motion>

          <Motion reduce={reduceMotion} delay={70} style={[styles.helpCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.helpIcon, { backgroundColor: `${colors.primary}20` }]}><MaterialIcons name="forum" size={25} color={colors.primary} /></View>
            <View style={styles.helpCopy}>
              <Text selectable style={[styles.helpTitle, { color: colors.textDark }]}>Need quick help?</Text>
              <Text selectable style={[styles.helpText, { color: colors.textLight }]}>For quick help, use WhatsApp. For bugs, screenshots, or detailed feedback, email support.</Text>
              <View style={styles.liveRow} accessibilityLabel="Support channels are available">
                <Animated.View style={[styles.liveDot, { backgroundColor: '#25D366', opacity: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), transform: [{ scale: livePulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.35] }) }] }]} />
                <Text style={[styles.liveText, { color: colors.textLight }]}>Support channels ready</Text>
              </View>
            </View>
            {support[0] && <Animated.View style={{ transform: [{ scale: ctaPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.075] }) }] }}><Pressable accessibilityRole="button" accessibilityLabel="Chat with WhatsApp support" onPress={() => open(support[0])} style={[styles.primaryCta, { backgroundColor: support[0].color }]}><FontAwesome name="whatsapp" size={17} color="#fff" /><Text style={styles.primaryCtaText}>Chat</Text></Pressable></Animated.View>}
          </Motion>

          <Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>Get support</Text>
          {support.map((item, index) => <ContactCard key={item.id} item={item} index={index} colors={colors} reduce={reduceMotion} openingId={openingId} onOpen={open} onActions={setSelectedContact} />)}

          <Motion reduce={reduceMotion} delay={330} style={[styles.faqCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.faqHeading}><MaterialIcons name="help-outline" size={21} color={colors.primary} /><Text selectable style={[styles.faqTitle, { color: colors.textDark }]}>Quick help</Text></View>
            {['Notifications are not arriving', 'Login or App Lock issue', 'Attendance or reminder data looks wrong'].map((item) => <Text key={item} selectable style={[styles.faqItem, { color: colors.textLight }]}>• {item} — send us a screenshot and a short description.</Text>)}
          </Motion>

          <Motion reduce={reduceMotion} delay={390} style={[styles.formCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text selectable style={[styles.formTitle, { color: colors.textDark }]}>Send feedback</Text>
            <Text selectable style={[styles.formText, { color: colors.textLight }]}>This opens your email app with helpful QuizMate context already added. Never send passwords or OTPs.</Text>
            <View style={styles.topicRow}>{TOPICS.map((item) => <Pressable key={item} accessibilityRole="radio" accessibilityState={{ selected: topic === item }} onPress={() => { haptic(); setTopic(item); }} style={[styles.topic, { backgroundColor: topic === item ? colors.primary : colors.surface, borderColor: colors.border }]}><Text style={[styles.topicText, { color: topic === item ? '#fff' : colors.textDark }]}>{item}</Text></Pressable>)}</View>
            <TextInput accessibilityLabel="Describe your issue or feedback" multiline textAlignVertical="top" maxLength={900} value={message} onChangeText={setMessage} placeholder="Describe what happened, what you expected, and any steps to reproduce it." placeholderTextColor={colors.textLight} style={[styles.message, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textDark }]} />
            <Text selectable style={[styles.counter, { color: colors.textLight }]}>{message.length}/900</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Send support request by email" onPress={submitSupportRequest} style={({ pressed }) => [styles.sendButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}><MaterialIcons name="send" size={18} color="#fff" /><Text style={styles.sendText}>Open email draft</Text></Pressable>
          </Motion>

          {social.length > 0 && <><Text selectable style={[styles.sectionTitle, { color: colors.textDark }]}>Follow QuizMate</Text><Text selectable style={[styles.sectionSub, { color: colors.textLight }]}>Social channels for updates—not the fastest route for account help.</Text>{social.map((item, index) => <ContactCard key={item.id} item={item} index={index + support.length} colors={colors} reduce={reduceMotion} openingId={openingId} onOpen={open} onActions={setSelectedContact} />)}</>}

          <Pressable accessibilityRole="button" accessibilityLabel="Share QuizMate" onPress={shareQuizMate} style={({ pressed }) => [styles.share, { borderColor: colors.border, backgroundColor: colors.card }, pressed && styles.pressed]}><MaterialIcons name="share" size={19} color={colors.primary} /><Text style={[styles.shareText, { color: colors.primary }]}>Share QuizMate with a classmate</Text></Pressable>
        </View>
      </ScrollView>

      <Modal transparent visible={Boolean(selectedContact)} animationType="fade" onRequestClose={() => setSelectedContact(null)}>
        <View style={styles.overlay}><View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={[styles.sheetIcon, { backgroundColor: `${selectedContact?.color || colors.primary}1A` }]}><MaterialIcons name="contact-page" size={23} color={selectedContact?.color || colors.primary} /></View>
          <Text selectable style={[styles.sheetTitle, { color: colors.textDark }]}>{selectedContact?.title}</Text>
          <Text selectable style={[styles.sheetValue, { color: colors.textLight }]}>{selectedContact?.value}</Text>
          <Pressable onPress={() => selectedContact && open(selectedContact)} style={[styles.sheetAction, { backgroundColor: colors.primary }]}><MaterialIcons name="open-in-new" size={19} color="#fff" /><Text style={styles.sheetPrimaryText}>Open</Text></Pressable>
          <Pressable onPress={() => selectedContact && copy(selectedContact.value, selectedContact.title)} style={[styles.sheetAction, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}><MaterialIcons name="content-copy" size={19} color={colors.primary} /><Text style={[styles.sheetSecondaryText, { color: colors.textDark }]}>Copy contact</Text></Pressable>
          {selectedContact?.browserUrl && <Pressable onPress={() => selectedContact && open(selectedContact, true)} style={styles.textAction}><Text style={[styles.textActionLabel, { color: colors.primary }]}>Open in browser instead</Text></Pressable>}
          <Pressable onPress={() => setSelectedContact(null)} style={styles.textAction}><Text style={[styles.textActionLabel, { color: colors.textLight }]}>Cancel</Text></Pressable>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { paddingTop: 16, paddingBottom: 116 }, content: { width: '100%', alignSelf: 'center' }, hero: { position: 'relative', minHeight: 132, borderWidth: 1, borderRadius: 24, padding: 20, overflow: 'hidden', justifyContent: 'center' }, heroCopy: { paddingRight: 70 }, heroCopyWithBack: { paddingTop: 38 }, heroTitle: { fontSize: 28, fontWeight: '900' }, heroTitleCompact: { fontSize: 24 }, heroSub: { marginTop: 5, fontSize: 13, lineHeight: 19, fontWeight: '600' }, heroIcon: { position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, heroOrbOne: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(124,58,237,.10)', right: -66, top: -82 }, heroOrbTwo: { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(250,204,21,.12)', right: 28, bottom: -67 }, back: { position: 'absolute', zIndex: 3, left: 14, top: 14, width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, helpCard: { marginTop: 14, borderRadius: 20, borderWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, helpIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, helpCopy: { flex: 1 }, helpTitle: { fontSize: 16, fontWeight: '900' }, helpText: { marginTop: 4, fontSize: 12, lineHeight: 17 }, liveRow: { marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 5 }, liveDot: { width: 7, height: 7, borderRadius: 4 }, liveText: { fontSize: 10, fontWeight: '900' }, primaryCta: { minHeight: 38, borderRadius: 12, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, primaryCtaText: { color: '#fff', fontWeight: '900', fontSize: 13 }, sectionTitle: { marginTop: 26, fontSize: 20, fontWeight: '900' }, sectionSub: { marginTop: 4, marginBottom: 11, fontSize: 12, lineHeight: 17 }, contactCard: { marginTop: 11, minHeight: 85, borderWidth: 1, borderRadius: 19, overflow: 'hidden', flexDirection: 'row', alignItems: 'center' }, contactMain: { flex: 1, minWidth: 0, paddingVertical: 14, paddingLeft: 16, paddingRight: 7, flexDirection: 'row', alignItems: 'center' }, brandAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 }, iconCircle: { width: 50, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 12 }, contactCopy: { flex: 1, minWidth: 0 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, contactTitle: { fontWeight: '900', fontSize: 15, flexShrink: 1 }, recommended: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, overflow: 'hidden', fontSize: 10, fontWeight: '900' }, contactValue: { marginTop: 3, fontSize: 12, fontWeight: '700' }, contactAction: { marginTop: 4, fontSize: 11, fontWeight: '900' }, moreButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 13, borderWidth: 1 }, faqCard: { marginTop: 15, padding: 15, borderWidth: 1, borderRadius: 18 }, faqHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, faqTitle: { fontSize: 15, fontWeight: '900' }, faqItem: { marginTop: 10, fontSize: 12, lineHeight: 18 }, formCard: { marginTop: 15, padding: 16, borderWidth: 1, borderRadius: 20 }, formTitle: { fontSize: 17, fontWeight: '900' }, formText: { marginTop: 5, fontSize: 12, lineHeight: 18 }, topicRow: { marginTop: 13, flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, topic: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1 }, topicText: { fontSize: 11, fontWeight: '900' }, message: { minHeight: 104, marginTop: 13, padding: 12, borderRadius: 13, borderWidth: 1, fontSize: 13 }, counter: { marginTop: 5, textAlign: 'right', fontSize: 11 }, sendButton: { marginTop: 10, minHeight: 47, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, sendText: { color: '#fff', fontWeight: '900' }, share: { minHeight: 51, marginTop: 20, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, shareText: { fontSize: 13, fontWeight: '900' }, overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,.48)', justifyContent: 'flex-end', padding: 16 }, sheet: { borderRadius: 24, padding: 20, alignItems: 'stretch' }, sheetIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }, sheetTitle: { marginTop: 10, fontSize: 18, fontWeight: '900', textAlign: 'center' }, sheetValue: { marginTop: 4, fontSize: 13, textAlign: 'center' }, sheetAction: { minHeight: 48, marginTop: 15, borderRadius: 13, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }, sheetPrimaryText: { color: '#fff', fontWeight: '900' }, sheetSecondaryText: { fontWeight: '900' }, textAction: { alignItems: 'center', paddingVertical: 11 }, textActionLabel: { fontWeight: '900', fontSize: 13 }, pressed: { opacity: .82, transform: [{ scale: .98 }] },
});
