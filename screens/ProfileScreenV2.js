import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useResponsive } from '../constants/layout';
import { getUserById, saveUserProfile } from '../utils/localData';
import { DATA_DOMAINS, onDataChanged } from '../utils/dataEvents';
import { persistSession } from '../utils/firebaseRest';

const SEMESTERS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

function Motion({ children, reduceMotion, delay = 0, style }) {
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 14)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 240, delay, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, delay, friction: 8, tension: 72, useNativeDriver: true }),
    ]).start();
  }, [delay, opacity, reduceMotion, translateY]);
  return <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>{children}</Animated.View>;
}

export default function ProfileScreenV2({ goBack, canGoBack, currentUser, onUserUpdate }) {
  const { colors, isDarkMode } = useTheme();
  const { showError, showSuccess, requestPermission } = useToast();
  const { screenPadding, maxContentWidth } = useResponsive();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: '', semester: '', department: '', phone: '', bio: '', profileImage: '' });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [photoSheetVisible, setPhotoSheetVisible] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);
  const requestId = useRef(0);
  /* Set for the duration of our own save() call so the PROFILE event
     it emits does not trigger a reload that could stomp whatever the
     user has already started typing again right after hitting Save. */
  const isSavingRef = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
    return () => subscription?.remove?.();
  }, []);

  /* `silent` is used for event-driven reloads triggered elsewhere
     (Settings, restore, ...) - those must never flip the blocking
     `loading` flag, which would unmount this form and discard
     whatever the user is mid-typing. */
  const loadProfile = async ({ isRefresh = false, silent = false } = {}) => {
    const id = ++requestId.current;
    if (!silent) {
      isRefresh ? setRefreshing(true) : setLoading(true);
    }
    try {
      const user = await getUserById(currentUser.id);
      if (id !== requestId.current) return;
      const nextProfile = user || currentUser || {};
      setProfile(nextProfile);
      setForm({
        name: nextProfile.name || '', semester: nextProfile.semester || '', department: nextProfile.department || '',
        phone: nextProfile.phone || '', bio: nextProfile.bio || '', profileImage: nextProfile.profileImage || '',
      });
      setLoadFailed(false);
    } catch {
      if (id === requestId.current) {
        setLoadFailed(true);
        if (!silent) showError('Could not load your profile. Pull down to retry.');
      }
    } finally {
      /* Clear this call's own busy flag unconditionally - a save()
         bumping requestId while a pull-to-refresh is still in flight
         must never strand `refreshing` as true forever just because
         this particular request lost the id race above. */
      if (!silent) {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    }
  };

  useEffect(() => { if (currentUser?.id) loadProfile(); }, [currentUser?.id]);

  useEffect(() => {
    const unsubscribe = onDataChanged(({ domain }) => {
      if (domain === DATA_DOMAINS.PROFILE && currentUser?.id && !isSavingRef.current) {
        loadProfile({ silent: true });
      }
    });
    return unsubscribe;
  }, [currentUser?.id]);

  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const savedValues = profile && JSON.stringify({
    name: profile.name || '', semester: profile.semester || '', department: profile.department || '',
    phone: profile.phone || '', bio: profile.bio || '', profileImage: profile.profileImage || '',
  });
  /* If the load failed, `profile` never gets set, and comparing
     against it would leave the Save button permanently disabled -
     dead even after the user types something. Once a load has
     failed, any non-empty field is enough to allow a save attempt;
     save() still validates the actual values before persisting. */
  const dirty = loadFailed
    ? Object.values(form).some((value) => String(value || '').trim().length > 0)
    : Boolean(profile) && savedValues !== JSON.stringify(form);

  const choosePhoto = async () => {
    setPhotoSheetVisible(false);
    const approved = await requestPermission({
      title: 'Allow photo library?',
      message: 'QuizMate only uses your selected image as your profile picture.',
      confirmLabel: 'Allow photos',
    });
    if (!approved) return;

    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    const permission = existing.granted ? existing : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showError(permission.canAskAgain === false
        ? 'Photo access is disabled in device settings. Enable it there to choose a profile picture.'
        : 'Photo access was not granted. You can try again whenever you are ready.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.45,
      base64: true,
    });
    const asset = result.assets?.[0];
    if (!asset?.base64) return;
    if (asset.base64.length > 360000) {
      showError('Choose a smaller image. The profile photo limit is 270 KB.');
      return;
    }
    update('profileImage', `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`);
  };

  const save = async () => {
    if (loading || saving) return;
    if (form.name.trim().length < 2) return showError('Name must contain at least 2 characters.');
    if (form.phone && !/^[+0-9\s-]{7,20}$/.test(form.phone)) return showError('Enter a valid phone number or leave it blank.');
    if (form.bio.length > 180) return showError('Bio must be 180 characters or less.');

    setSaving(true);
    isSavingRef.current = true;
    ++requestId.current;
    try {
      const payload = { ...form, name: form.name.trim(), semester: form.semester.trim(), department: form.department.trim(), phone: form.phone.trim(), bio: form.bio.trim(), email: currentUser.email };
      const savedProfile = await saveUserProfile(currentUser.id, payload);
      /* Local storage only returns the profile fields it owns - the auth
         session (idToken/refreshToken/expiresAt) lives in currentUser and
         must survive this merge, or the app would effectively sign the
         user out the next time it needs a stored token. */
      const updated = { ...currentUser, ...savedProfile };
      setProfile((previous) => ({ ...previous, ...payload }));
      setForm(payload);
      setLoadFailed(false);
      onUserUpdate?.(updated);
      try {
        /* persistSession keeps the refresh token in SecureStore instead of
           writing it back into the plaintext AsyncStorage blob - a raw
           setItem here would silently undo that protection every time the
           profile is saved. */
        await persistSession(updated);
        await AsyncStorage.setItem('userName', payload.name);
      } catch {}
      showSuccess('Profile saved successfully.');
    } catch (error) {
      showError(error.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const initial = (form.name || 'U').trim().charAt(0).toUpperCase();
  const leave = () => dirty ? setDiscardVisible(true) : goBack?.();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar backgroundColor={colors.background} barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadProfile({ isRefresh: true })} tintColor={colors.primary} />}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: screenPadding }]}
      >
        <View style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }}>
          <Motion reduceMotion={reduceMotion} style={[styles.header, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {canGoBack && <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={leave}><MaterialIcons name="arrow-back" size={24} color={colors.primary} /></Pressable>}
            <View style={styles.flex}><Text selectable style={[styles.title, { color: colors.textDark }]}>Student profile</Text><Text selectable style={[styles.sub, { color: colors.textLight }]}>Your identity and academic information</Text></View>
          </Motion>
          {!loading && loadFailed && <View style={[styles.errorBanner, { backgroundColor: colors.softDanger }]}><MaterialIcons name="cloud-off" size={18} color={colors.danger} /><Text selectable style={[styles.errorBannerText, { color: colors.danger }]}>Could not load your saved profile. You can still edit and save below, or pull down to retry.</Text></View>}
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : <>
            <Motion reduceMotion={reduceMotion} delay={45} style={[styles.avatarCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={() => setPhotoSheetVisible(true)} style={styles.avatarButton}>
                {form.profileImage ? <Image source={{ uri: form.profileImage }} style={styles.avatar} /> : <View style={[styles.avatar, { backgroundColor: colors.primary }]}><Text style={styles.avatarLetter}>{initial}</Text></View>}
                <View style={[styles.camera, { backgroundColor: colors.primary, borderColor: colors.card }]}><MaterialIcons name="photo-camera" size={18} color="#fff" /></View>
              </Pressable>
              <Text selectable style={[styles.name, { color: colors.textDark }]}>{form.name || 'Your profile'}</Text><Text selectable style={[styles.sub, { color: colors.textLight }]}>Tap photo to change or remove</Text>
            </Motion>
            <Motion reduceMotion={reduceMotion} delay={90} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text selectable style={[styles.section, { color: colors.textDark }]}>Student identity</Text>
              <Read label="Registration number" value={profile?.regNo || 'Not available'} colors={colors} />
              <Field label="Full name" value={form.name} onChangeText={(value) => update('name', value)} colors={colors} />
              <Field label="Department" value={form.department} onChangeText={(value) => update('department', value)} colors={colors} placeholder="Computer Science" />
              <Text selectable style={[styles.label, { color: colors.textDark }]}>Semester</Text>
              <View style={styles.chips}>{SEMESTERS.map((semester) => <Pressable key={semester} accessibilityRole="radio" accessibilityState={{ selected: form.semester === semester }} onPress={() => update('semester', semester)} style={[styles.chip, { backgroundColor: form.semester === semester ? colors.primary : colors.surface }]}><Text selectable style={{ color: form.semester === semester ? '#fff' : colors.textDark, fontWeight: '800' }}>{semester}</Text></Pressable>)}</View>
            </Motion>
            <Motion reduceMotion={reduceMotion} delay={135} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text selectable style={[styles.section, { color: colors.textDark }]}>Contact & account</Text>
              <Read label="Login email" value={currentUser.email} colors={colors} hint="For security, email changes require a verified account flow." />
              <Field label="Phone (optional)" value={form.phone} onChangeText={(value) => update('phone', value)} colors={colors} keyboardType="phone-pad" />
              <Text selectable style={[styles.label, { color: colors.textDark }]}>About · {form.bio.length}/180</Text>
              <TextInput accessibilityLabel="Student bio, optional" value={form.bio} onChangeText={(value) => update('bio', value.slice(0, 180))} multiline textAlignVertical="top" placeholder="Your study focus or goals" placeholderTextColor={colors.textLight} style={[styles.bio, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textDark }]} />
            </Motion>
            <Pressable accessibilityRole="button" accessibilityState={{ busy: saving, disabled: !dirty || saving }} disabled={!dirty || saving} onPress={save} style={[styles.save, { backgroundColor: colors.primary, opacity: !dirty || saving ? 0.6 : 1 }]}>{saving ? <ActivityIndicator color="#fff" /> : <><MaterialIcons name="save" size={20} color="#fff" /><Text style={styles.saveText}>Save changes</Text></>}</Pressable>
          </>}
        </View>
      </ScrollView>
      <Modal visible={photoSheetVisible} transparent animationType="fade" onRequestClose={() => setPhotoSheetVisible(false)}><View style={styles.overlay}><View style={[styles.sheet, { backgroundColor: colors.card }]}><Text selectable style={[styles.section, { color: colors.textDark }]}>Profile photo</Text><Pressable onPress={choosePhoto}><Text style={[styles.option, { color: colors.primary }]}>Choose from library</Text></Pressable>{form.profileImage && <Pressable onPress={() => { update('profileImage', ''); setPhotoSheetVisible(false); }}><Text style={[styles.option, { color: colors.danger }]}>Remove photo</Text></Pressable>}<Pressable onPress={() => setPhotoSheetVisible(false)}><Text style={[styles.option, { color: colors.textLight }]}>Cancel</Text></Pressable></View></View></Modal>
      <Modal visible={discardVisible} transparent animationType="fade" onRequestClose={() => setDiscardVisible(false)}><View style={styles.overlay}><View style={[styles.sheet, { backgroundColor: colors.card }]}><Text selectable style={[styles.section, { color: colors.textDark }]}>Discard changes?</Text><Text selectable style={[styles.sub, { color: colors.textLight }]}>Your unsaved profile edits will be lost.</Text><View style={styles.modalRow}><Pressable onPress={() => setDiscardVisible(false)}><Text style={[styles.option, { color: colors.primary }]}>Keep editing</Text></Pressable><Pressable onPress={() => goBack?.()}><Text style={[styles.option, { color: colors.danger }]}>Discard</Text></Pressable></View></View></View></Modal>
    </View>
  );
}

function Field({ label, value, onChangeText, colors, placeholder = '', keyboardType }) { return <><Text selectable style={[styles.label, { color: colors.textDark }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textLight} keyboardType={keyboardType} style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textDark }]} /></>; }
function Read({ label, value, colors, hint }) { return <View style={[styles.read, { backgroundColor: colors.surface }]}><Text selectable style={[styles.readLabel, { color: colors.textLight }]}>{label}</Text><Text selectable style={{ color: colors.textDark, fontWeight: '800' }}>{value}</Text>{hint && <Text selectable style={[styles.sub, { color: colors.textLight }]}>{hint}</Text>}</View>; }

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { paddingTop: 16, paddingBottom: 110 }, header: { padding: 16, borderWidth: 1, borderRadius: 20, flexDirection: 'row', gap: 12, alignItems: 'center' }, flex: { flex: 1 }, title: { fontSize: 24, fontWeight: '900' }, sub: { fontSize: 12, marginTop: 3 }, loading: { padding: 55 }, errorBanner: { marginTop: 14, padding: 12, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9 }, errorBannerText: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 }, avatarCard: { marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 22, alignItems: 'center' }, avatarButton: { width: 108, height: 108 }, avatar: { width: 108, height: 108, borderRadius: 54, alignItems: 'center', justifyContent: 'center' }, avatarLetter: { color: '#fff', fontSize: 42, fontWeight: '900' }, camera: { position: 'absolute', right: 0, bottom: 0, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3 }, name: { fontSize: 20, fontWeight: '900', marginTop: 12 }, card: { marginTop: 14, borderWidth: 1, borderRadius: 18, padding: 15 }, section: { fontSize: 18, fontWeight: '900' }, label: { fontSize: 13, fontWeight: '800', marginTop: 13, marginBottom: 6 }, input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 }, bio: { borderWidth: 1, borderRadius: 12, minHeight: 95, padding: 12 }, read: { marginTop: 12, borderRadius: 12, padding: 11 }, readLabel: { fontSize: 11, fontWeight: '800', marginBottom: 3 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10 }, save: { marginTop: 16, minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, saveText: { color: '#fff', fontWeight: '900' }, overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.42)', justifyContent: 'flex-end', padding: 16 }, sheet: { borderRadius: 20, padding: 19, gap: 12 }, option: { fontWeight: '900', paddingVertical: 8, fontSize: 15 }, modalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
});
