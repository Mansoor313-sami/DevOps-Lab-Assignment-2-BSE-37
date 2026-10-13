import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from './ThemeContext';
import { CARD_RADIUS, TYPOGRAPHY } from '../constants/layout';

const ToastContext = createContext({
  showToast: () => {},
  showError: () => {},
  showSuccess: () => {},
  requestPermission: async () => false,
});

export const useToast = () => useContext(ToastContext);

const toneConfig = (tone, colors) => {
  if (tone === 'success') return { icon: 'check-circle', accent: colors.success, title: 'Done' };
  if (tone === 'error') return { icon: 'error-outline', accent: colors.danger, title: 'Something needs attention' };
  return { icon: 'info-outline', accent: colors.primary, title: 'QuizMate' };
};

function FeedbackModal({ dialog, onClose }) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!dialog) return;
    progress.setValue(0);
    Animated.spring(progress, {
      toValue: 1,
      friction: 8,
      tension: 74,
      useNativeDriver: true,
    }).start();
  }, [dialog?.id, progress]);

  if (!dialog) return null;
  const tone = toneConfig(dialog.tone, colors);
  const isPermission = dialog.kind === 'permission';

  return (
    <Modal
      transparent
      visible
      statusBarTranslucent
      animationType="none"
      onRequestClose={() => onClose(false)}
    >
      <View style={styles.backdrop}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.dialog,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: progress,
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: `${tone.accent}18` }]}>
            <MaterialIcons name={tone.icon} size={28} color={tone.accent} />
          </View>
          <Text selectable style={[styles.title, { color: colors.textDark }]}>
            {dialog.title || (isPermission ? 'Permission required' : tone.title)}
          </Text>
          <Text selectable style={[styles.message, { color: colors.textLight }]}>
            {dialog.message}
          </Text>
          {isPermission && (
            <Text selectable style={[styles.hint, { color: colors.textLight }]}>
              Selecting Allow opens your device’s secure permission prompt.
            </Text>
          )}
          <View style={styles.actions}>
            {isPermission && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dialog.cancelLabel || 'Not now'}
                onPress={() => onClose(false)}
                style={styles.secondaryButton}
              >
                <Text style={[styles.secondaryLabel, { color: colors.textDark }]}>
                  {dialog.cancelLabel || 'Not now'}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dialog.confirmLabel || 'OK'}
              onPress={() => onClose(true)}
              style={[styles.primaryButton, { backgroundColor: tone.accent }]}
            >
              <Text style={styles.primaryLabel}>
                {dialog.confirmLabel || 'OK'}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function ToastProvider({ children }) {
  /* Confirmations and transient toasts each get their own slot. They
     used to share one `dialog` state, so showing any toast - including
     an unrelated background error with nothing to do with the flow the
     user is in - resolved whatever confirmation (e.g. "Enable
     notifications?") was currently open with false. That silently
     cancelled the confirmation and made the toggle that triggered it
     look like it did nothing. Keeping the two independent means a
     toast can never reach into an in-flight confirmation's slot. */
  const [toastDialog, setToastDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const resolverRef = useRef(null);

  const closeToast = useCallback(() => {
    setToastDialog(null);
  }, []);

  const closeConfirm = useCallback((accepted = true) => {
    setConfirmDialog(null);
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(Boolean(accepted));
  }, []);

  const showToast = useCallback((message, tone = 'info') => {
    if (!message) return;
    setToastDialog({ id: Date.now(), kind: 'message', message: String(message), tone });
  }, []);

  const showError = useCallback(
    (message) => showToast(message || 'Something went wrong. Please try again.', 'error'),
    [showToast]
  );

  const showSuccess = useCallback((message) => showToast(message, 'success'), [showToast]);

  const requestPermission = useCallback(({
    title = 'Permission required',
    message = 'QuizMate needs your permission to continue.',
    confirmLabel = 'Allow',
    cancelLabel = 'Not now',
    tone = 'info',
  } = {}) => new Promise((resolve) => {
    /* Only a second, genuine confirmation can pre-empt an existing one -
       a plain toast must never touch this slot. */
    if (resolverRef.current) resolverRef.current(false);
    resolverRef.current = resolve;
    setConfirmDialog({
      id: Date.now(),
      kind: 'permission',
      title,
      message,
      confirmLabel,
      cancelLabel,
      tone,
    });
  }), []);

  useEffect(() => () => resolverRef.current?.(false), []);

  return (
    <ToastContext.Provider value={{ showToast, showError, showSuccess, requestPermission }}>
      {children}
      <FeedbackModal dialog={confirmDialog} onClose={closeConfirm} />
      <FeedbackModal dialog={toastDialog} onClose={closeToast} />
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(9, 12, 31, 0.58)', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 460, alignSelf: 'center', borderWidth: 1, borderRadius: CARD_RADIUS + 6, padding: 24, alignItems: 'center' },
  iconCircle: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: TYPOGRAPHY.sectionTitle, fontWeight: '900', textAlign: 'center' },
  message: { fontSize: TYPOGRAPHY.body, lineHeight: 21, textAlign: 'center', marginTop: 9 },
  hint: { fontSize: TYPOGRAPHY.small, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  actions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 22 },
  primaryButton: { minHeight: 48, flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryButton: { minHeight: 48, flex: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(127,127,127,0.12)' },
  primaryLabel: { color: '#FFFFFF', fontSize: TYPOGRAPHY.body, fontWeight: '900' },
  secondaryLabel: { fontSize: TYPOGRAPHY.body, fontWeight: '800' },
});
