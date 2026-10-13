import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Modal,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  UIManager,
} from 'react-native';

import {
  MaterialIcons,
} from '@expo/vector-icons';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  useTheme,
} from '../context/ThemeContext';

import {
  useToast,
} from '../context/ToastContext';

import {
  createUser,
  getVerificationSession,
  isEmailVerified,
  loginUser,
  loginWithRefreshToken,
  normalizeRegNo,
  persistSession,
  sendEmailVerification,
  sendPasswordResetEmail,
} from '../utils/firebaseRest';

import {
  checkConnection,
} from '../utils/network';

import {
  authenticateBiometric,
  getBiometricCapability,
} from '../utils/biometrics';

import {
  clearQuickUnlock,
  getQuickUnlockMeta,
  getQuickUnlockToken,
  saveQuickUnlock,
} from '../utils/quickUnlock';

import {
  CARD_RADIUS,
  SCREEN_PADDING,
  SHADOW,
  TYPOGRAPHY,
  useResponsive,
} from '../constants/layout';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const REMEMBERED_IDENTIFIER_KEY =
  'lastAuthIdentifier';

const RATE_LIMIT_SECONDS = 60;

/* ------------------------------------------------------------------
   VALIDATION HELPERS
------------------------------------------------------------------ */

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const REG_NO_PATTERN =
  /^[A-Z]{2}\d{2}-[A-Z]{2,5}-\d{3}$/;

const validateEmail = (value) =>
  EMAIL_PATTERN.test(value);

const validateRegNo = (value) =>
  REG_NO_PATTERN.test(
    normalizeRegNo(value)
  );

/* Password rules are only enforced when creating an account.
   Login must never gate on them, otherwise anyone who resets
   their password through Firebase (which allows any 6+ char
   password) would be locked out of the app permanently. */

const PASSWORD_RULES = [
  {
    key: 'length',
    label: 'At least 6 characters',
    test: (value) => value.length >= 6,
  },
  {
    key: 'uppercase',
    label: 'One uppercase letter',
    test: (value) => /[A-Z]/.test(value),
  },
  {
    key: 'number',
    label: 'One number',
    test: (value) => /\d/.test(value),
  },
  {
    key: 'special',
    label: 'One special character',
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
];

const validatePassword = (value) =>
  PASSWORD_RULES.every((rule) =>
    rule.test(value)
  );

const getPasswordScore = (value) =>
  PASSWORD_RULES.filter((rule) =>
    rule.test(value)
  ).length;

const getStrengthLabel = (score) => {

  if (score <= 1) {
    return 'Weak';
  }

  if (score === 2) {
    return 'Fair';
  }

  if (score === 3) {
    return 'Good';
  }

  return 'Strong';
};

/* Reg No auto format: the user can type fa23bse037 and get
   FA23-BSE-037 without hunting for the hyphen key. */

const formatRegNo = (value) => {

  const raw =
    value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const head = raw.slice(0, 4);
  const rest = raw.slice(4);

  if (rest.length === 0) {
    return head;
  }

  const match =
    rest.match(/^([A-Z]{0,5})(\d{0,3})/) || [];

  const letters = match[1] || '';
  const digits = match[2] || '';

  let output = `${head}-${letters}`;

  if (digits.length > 0) {
    output += `-${digits}`;
  }

  return output;
};

/* Email typo detection */

const COMMON_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'proton.me',
];

const editDistance = (a, b) => {

  const rows =
    Array.from(
      { length: a.length + 1 },
      (_, i) => [i, ...Array(b.length).fill(0)]
    );

  for (let j = 0; j <= b.length; j += 1) {
    rows[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] =
        a[i - 1] === b[j - 1]
          ? rows[i - 1][j - 1]
          : 1 +
            Math.min(
              rows[i - 1][j],
              rows[i][j - 1],
              rows[i - 1][j - 1]
            );
    }
  }

  return rows[a.length][b.length];
};

const suggestEmailDomain = (value) => {

  const trimmed =
    value.trim().toLowerCase();

  const at = trimmed.lastIndexOf('@');

  if (at < 1 || at === trimmed.length - 1) {
    return null;
  }

  const domain = trimmed.slice(at + 1);

  if (COMMON_DOMAINS.includes(domain)) {
    return null;
  }

  const candidate =
    COMMON_DOMAINS.find((known) =>
      editDistance(domain, known) <= 2
    );

  return candidate
    ? `${trimmed.slice(0, at + 1)}${candidate}`
    : null;
};

/* Caps lock hint: all letters typed are uppercase. */

const looksLikeCapsLock = (value) => {

  const letters =
    value.replace(/[^A-Za-z]/g, '');

  return (
    letters.length >= 3 &&
    letters === letters.toUpperCase()
  );
};

/* ------------------------------------------------------------------
   SCREEN
------------------------------------------------------------------ */

export default function AuthScreen({
  onAuthSuccess,
}) {

  const {
    colors,
    isDarkMode,
  } = useTheme();

  const {
    showError,
    showSuccess,
  } = useToast();

  const {
    isCompactWidth,
  } = useResponsive();

  /* FORM STATE */

  const [mode, setMode] =
    useState('login');

  const [name, setName] =
    useState('');

  const [email, setEmail] =
    useState('');

  const [regNo, setRegNo] =
    useState('');

  const [password, setPassword] =
    useState('');

  const [confirmPassword, setConfirmPassword] =
    useState('');

  const [securePassword, setSecurePassword] =
    useState(true);

  const [
    secureConfirmPassword,
    setSecureConfirmPassword,
  ] =
    useState(true);

  /* FEEDBACK STATE */

  const [fieldErrors, setFieldErrors] =
    useState({});

  const [formError, setFormError] =
    useState('');

  const [emailSuggestion, setEmailSuggestion] =
    useState(null);

  const [isOffline, setIsOffline] =
    useState(false);

  const [cooldown, setCooldown] =
    useState(0);

  /* QUICK UNLOCK */

  const [quickUnlock, setQuickUnlock] =
    useState(null);

  const [biometricLabel, setBiometricLabel] =
    useState('Biometric');

  const [isQuickUnlocking, setIsQuickUnlocking] =
    useState(false);

  /* MODALS */

  const [successVisible, setSuccessVisible] =
    useState(false);

  const [verifyVisible, setVerifyVisible] =
    useState(false);

  const [resetVisible, setResetVisible] =
    useState(false);

  const [resetEmail, setResetEmail] =
    useState('');

  const [resetMessage, setResetMessage] =
    useState('');

  const [resetError, setResetError] =
    useState('');

  /* BUSY STATE */

  const [isSubmitting, setIsSubmitting] =
    useState(false);

  const [isResetting, setIsResetting] =
    useState(false);

  const [isResending, setIsResending] =
    useState(false);

  const [isCheckingVerify, setIsCheckingVerify] =
    useState(false);

  /* Kept so the verify prompt can resend the email and finish
     the login without asking for the password again. */

  const pendingAuth =
    useRef(null);

  const isSignup =
    mode === 'signup';

  /* FIELD REFS for the keyboard next/done chain */

  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const regNoRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  /* ANIMATION VALUES */

  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const pillAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0)).current;
  const eyeAnim = useRef(new Animated.Value(1)).current;
  const confirmEyeAnim = useRef(new Animated.Value(1)).current;
  const submitScale = useRef(new Animated.Value(1)).current;

  const [switchWidth, setSwitchWidth] =
    useState(0);

  /* ENTRANCE */

  useEffect(() => {

    Animated.stagger(120, [
      Animated.timing(heroAnim, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardAnim, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

  }, []);

  /* REMEMBERED IDENTIFIER + CONNECTIVITY */

  useEffect(() => {

    let cancelled = false;

    AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY)
      .then((saved) => {
        if (saved && !cancelled) {
          setEmail(saved);
        }
      })
      .catch(() => {});

    checkConnection().then((online) => {
      if (!cancelled) {
        setIsOffline(!online);
      }
    });

    /* Quick Unlock only shows when a saved session exists AND
       the device can actually scan, so the card never appears
       as a dead button. Only non-secret metadata is read here -
       the refresh token itself is not touched until the unlock
       handler runs, after a successful scan. */

    Promise.all([
      getQuickUnlockMeta(),
      getBiometricCapability(),
    ])
      .then(([meta, capability]) => {

        if (cancelled) {
          return;
        }

        setBiometricLabel(
          capability?.label || 'Biometric'
        );

        if (
          meta?.success &&
          meta.exists &&
          capability?.isAvailable
        ) {
          setQuickUnlock(meta);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };

  }, []);

  /* QUICK UNLOCK FLOW */

  const handleQuickUnlock = async () => {

    if (isQuickUnlocking || !quickUnlock) {
      return;
    }

    setIsQuickUnlocking(true);

    try {

      const scan =
        await authenticateBiometric({
          promptMessage: `Unlock as ${quickUnlock.name || quickUnlock.email}`,
        });

      if (!scan.success) {

        /* A sensor lockout or a cancelled scan otherwise reads as a
           dead button - say something and point at the fallback. */

        showError(
          'We could not verify it was you. Please try again, or sign in with your password below.'
        );

        return;
      }

      /* The refresh token is only decrypted now, after the scan has
         already succeeded - never at mount. */

      const tokenResult = await getQuickUnlockToken();

      if (!tokenResult.success) {

        await clearQuickUnlock();

        setQuickUnlock(null);

        showError(
          'Your saved session has expired. Please sign in with your password once.'
        );

        return;
      }

      const online = await checkConnection(4000);

      setIsOffline(!online);

      if (!online) {
        showError(
          'You are offline. Please connect to the internet to sign in.'
        );
        return;
      }

      const user =
        await loginWithRefreshToken(
          tokenResult.refreshToken
        );

      /* Firebase may hand back a rotated token, so keep the
         stored copy current. A failed write here just means the
         next unlock will need a password instead of silently
         breaking, so it is worth telling the user now. */

      const savedQuickUnlock =
        await saveQuickUnlock(user);

      if (!savedQuickUnlock) {
        showError(
          'Signed in, but could not refresh Quick Unlock on this device. You may need your password next time.'
        );
      }

      await finishLogin(user, user.email);

    } catch (error) {

      console.log(error?.message);

      if (error?.message === 'SESSION_EXPIRED') {

        await clearQuickUnlock();

        setQuickUnlock(null);

        showError(
          'Your saved session has expired. Please sign in with your password once.'
        );

        return;
      }

      showError(
        'Could not unlock. Please sign in with your password.'
      );

    } finally {

      setIsQuickUnlocking(false);
    }
  };

  const handleForgetDevice = async () => {

    await clearQuickUnlock();

    setQuickUnlock(null);

    showSuccess(
      'Quick Unlock removed from this device.'
    );
  };

  /* RATE LIMIT COUNTDOWN */

  useEffect(() => {

    if (cooldown <= 0) {
      return undefined;
    }

    const timer =
      setTimeout(
        () => setCooldown((value) => value - 1),
        1000
      );

    return () =>
      clearTimeout(timer);

  }, [cooldown]);

  /* MODE SWITCH */

  const switchMode = (nextMode) => {

    if (isSubmitting || nextMode === mode) {
      return;
    }

    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        260,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity
      )
    );

    Animated.timing(pillAnim, {
      toValue: nextMode === 'signup' ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    setMode(nextMode);

    setName('');
    setRegNo('');
    setPassword('');
    setConfirmPassword('');
    setFieldErrors({});
    setFormError('');

    /* The remembered identifier is only ever a login convenience -
       carrying it into signup would prefill someone else's already
       registered email and make every signup fail with "already
       exists". */

    if (nextMode === 'signup') {
      setEmail('');
      setEmailSuggestion(null);
    }

    /* A pending verification/signup attempt (and the plaintext
       password kept alongside it) belongs to whichever mode created
       it - switching away abandons it rather than leaving a stale
       password sitting in memory. */

    pendingAuth.current = null;
  };

  /* SHAKE ON INVALID SUBMIT */

  const runShake = () => {

    shakeAnim.setValue(0);

    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 1,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -1,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0.6,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -0.6,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 60,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const applyErrors = (errors, message = '') => {

    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        200,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity
      )
    );

    setFieldErrors(errors);
    setFormError(message);

    if (
      Object.keys(errors).length > 0 ||
      message
    ) {
      runShake();
    }
  };

  /* VALIDATION */

  const buildValidationErrors = ({
    trimmedName,
    trimmedEmail,
    trimmedRegNo,
  }) => {

    const errors = {};

    if (isSignup) {

      if (trimmedName.length < 2) {
        errors.name =
          'Please enter your full name.';
      }

      if (!validateEmail(trimmedEmail)) {
        errors.email =
          'Please enter a valid email address.';
      }

      if (!validateRegNo(trimmedRegNo)) {
        errors.regNo =
          'Format must look like FA23-BSE-037.';
      }

      /* Strength is a signup-only rule. */

      if (!validatePassword(password)) {
        errors.password =
          'Password does not meet all the requirements below.';
      }

      if (confirmPassword !== password) {
        errors.confirmPassword =
          'Passwords do not match.';
      }

    } else {

      if (
        !validateEmail(trimmedEmail) &&
        !validateRegNo(trimmedEmail)
      ) {
        errors.email =
          'Enter a valid email or Reg No like FA23-BSE-037.';
      }

      if (password.length === 0) {
        errors.password =
          'Please enter your password.';
      }
    }

    return errors;
  };

  /* SUBMIT */

  const handleSubmit = async () => {

    if (isSubmitting || cooldown > 0) {
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedRegNo = normalizeRegNo(regNo);

    const errors =
      buildValidationErrors({
        trimmedName,
        trimmedEmail,
        trimmedRegNo,
      });

    if (Object.keys(errors).length > 0) {
      applyErrors(errors);
      return;
    }

    applyErrors({});

    setIsSubmitting(true);

    try {

      const online = await checkConnection(4000);

      setIsOffline(!online);

      if (!online) {
        throw new Error(
          'You are offline. Please check your internet connection and try again.'
        );
      }

      if (isSignup) {

        const newUser =
          await createUser({
            name: trimmedName,
            email: trimmedEmail,
            regNo: trimmedRegNo,
            password,
          });

        /* Retained so the verify prompt can resend the email
           and complete the login without a second password
           entry. */

        pendingAuth.current = {
          idToken: newUser.idToken,
          email: trimmedEmail,
          password,
          isNewSignup: true,
        };

        successScale.setValue(0);

        setSuccessVisible(true);

        Animated.spring(successScale, {
          toValue: 1,
          friction: 5,
          tension: 90,
          useNativeDriver: true,
        }).start();

        return;
      }

      const user =
        await loginUser({
          identifier: trimmedEmail,
          password,
        });

      await finishLogin(user, trimmedEmail);

    } catch (error) {

      console.log(error?.message);

      handleAuthError(error, {
        email: email.trim().toLowerCase(),
      });

    } finally {

      setIsSubmitting(false);
    }
  };

  const finishLogin = async (
    user,
    identifier,
    isNewSignup = false
  ) => {

    if (!user?.id) {
      throw new Error(
        'Something went wrong finishing sign in. Please try again.'
      );
    }

    /* Session first, then the isLoggedIn flag - so a reject partway
       through (userName rejects when the RTDB record has no name,
       for example) never leaves isLoggedIn='true' with no session
       behind it. */

    await persistSession(user);

    await AsyncStorage.setItem('isLoggedIn', 'true');

    await AsyncStorage.setItem(
      'userName',
      String(user.name || '')
    );

    if (identifier) {
      await AsyncStorage.setItem(
        REMEMBERED_IDENTIFIER_KEY,
        identifier
      );
    }

    /* If Quick Unlock is already set up for THIS account, keep the
       stored token in step with the fresh one. A record that
       belongs to a different account (someone unlocked, then logged
       in as someone else) must be left untouched - refreshing it
       here would silently re-point Quick Unlock at whoever happens
       to log in next. Enabling it in the first place stays an
       explicit choice in Settings. */

    const existingMeta = await getQuickUnlockMeta();

    if (
      existingMeta?.success &&
      existingMeta.exists &&
      existingMeta.userId === user.id
    ) {
      const savedQuickUnlock =
        await saveQuickUnlock(user);

      if (!savedQuickUnlock) {
        showError(
          'Signed in, but could not refresh Quick Unlock on this device. You may need your password next time.'
        );
      }
    }

    pendingAuth.current = null;

    onAuthSuccess(user, { isNewSignup });
  };

  const handleAuthError = (error, context = {}) => {

    if (error?.message === 'EMAIL_NOT_VERIFIED') {

      pendingAuth.current = {
        idToken: error.idToken || null,
        email: error.email || context.email,
        password,

        /* A retried signup landing here (its post-signup login
           attempt failed because the email still is not verified)
           must not lose track of being a signup, or App.js would
           run the data-migration step meant only for returning
           users. */

        isNewSignup:
          pendingAuth.current?.isNewSignup === true,
      };

      applyErrors({});

      setVerifyVisible(true);

      return;
    }

    const message =
      error?.message ||
      'Something went wrong. Please try again.';

    /* error.code is the reliable signal (see firebaseRest.js) - the
       message match below only covers an error that somehow did not
       come through authRequest there. */

    if (
      error?.code === 'RATE_LIMITED' ||
      message
        .toLowerCase()
        .includes('temporarily limited')
    ) {
      setCooldown(RATE_LIMIT_SECONDS);
    }

    applyErrors({}, message);

    showError(message);
  };

  /* VERIFY PROMPT ACTIONS */

  const handleResendVerification = async () => {

    if (isResending) {
      return;
    }

    setIsResending(true);

    try {

      let token =
        pendingAuth.current?.idToken;

      /* Tokens expire, so refresh silently when needed. */

      if (
        !token &&
        pendingAuth.current?.email &&
        pendingAuth.current?.password
      ) {

        const session =
          await getVerificationSession({
            email: pendingAuth.current.email,
            password: pendingAuth.current.password,
          });

        token = session.idToken;

        pendingAuth.current = {
          ...pendingAuth.current,
          idToken: token,
        };
      }

      if (!token) {
        throw new Error(
          'Please enter your password and try again.'
        );
      }

      await sendEmailVerification(token);

      showSuccess(
        'Verification email sent. Please check your inbox and spam folder.'
      );

    } catch (error) {

      console.log(error?.message);

      /* An expired token is the usual cause, so retry once
         with a fresh sign in before giving up. */

      try {

        const session =
          await getVerificationSession({
            email: pendingAuth.current?.email,
            password: pendingAuth.current?.password,
          });

        await sendEmailVerification(
          session.idToken
        );

        pendingAuth.current = {
          ...pendingAuth.current,
          idToken: session.idToken,
        };

        showSuccess(
          'Verification email sent. Please check your inbox and spam folder.'
        );

      } catch (retryError) {

        showError(
          'Could not send the verification email. Please try again in a moment.'
        );
      }

    } finally {

      setIsResending(false);
    }
  };

  const handleCheckVerified = async () => {

    if (isCheckingVerify) {
      return;
    }

    setIsCheckingVerify(true);

    try {

      const session =
        await getVerificationSession({
          email: pendingAuth.current?.email,
          password: pendingAuth.current?.password,
        });

      const verified =
        await isEmailVerified(session.idToken);

      if (!verified) {

        showError(
          'This email is still not verified. Open the link we sent, then try again.'
        );

        return;
      }

      const user =
        await loginUser({
          identifier: pendingAuth.current.email,
          password: pendingAuth.current.password,
        });

      setVerifyVisible(false);

      setSuccessVisible(false);

      await finishLogin(
        user,
        pendingAuth.current.email,
        pendingAuth.current.isNewSignup === true
      );

    } catch (error) {

      console.log(error?.message);

      showError(
        error?.message === 'EMAIL_NOT_VERIFIED'
          ? 'This email is still not verified. Open the link we sent, then try again.'
          : 'Could not confirm verification. Please try again.'
      );

    } finally {

      setIsCheckingVerify(false);
    }
  };

  /* Dismissing the verify prompt abandons whatever signup/login
     attempt it was tracking, including the plaintext password kept
     alongside it - so it is cleared here rather than left to linger
     in memory until the next attempt overwrites it. */

  const closeVerifyModal = () => {
    pendingAuth.current = null;
    setVerifyVisible(false);
  };

  /* PASSWORD RESET */

  const openResetModal = () => {

    setResetEmail(
      validateEmail(email.trim().toLowerCase())
        ? email.trim().toLowerCase()
        : ''
    );

    setResetMessage('');
    setResetError('');
    setResetVisible(true);
  };

  const handlePasswordReset = async () => {

    if (isResetting) {
      return;
    }

    const trimmedResetEmail =
      resetEmail.trim().toLowerCase();

    if (!validateEmail(trimmedResetEmail)) {
      setResetError(
        'Please enter a valid email address.'
      );
      setResetMessage('');
      return;
    }

    setIsResetting(true);

    try {

      await sendPasswordResetEmail(
        trimmedResetEmail
      );

      /* Deliberately the same message whether or not the account
         exists - see firebaseRest.js's sendPasswordResetEmail.
         Anything more specific would let this form be used to
         check which emails are registered. */

      setResetError('');
      setResetMessage(
        "If that email is registered, we've sent a reset link. Please check your inbox. If you cannot find it, also check your Junk or Spam folder."
      );

    } catch (error) {

      setResetMessage('');
      setResetError(
        error?.message ||
          'Unable to send reset email. Please try again.'
      );

    } finally {

      setIsResetting(false);
    }
  };

  /* FIELD HANDLERS */

  const handleEmailChange = (value) => {

    setEmail(value);

    if (fieldErrors.email) {
      setFieldErrors((current) => ({
        ...current,
        email: undefined,
      }));
    }

    setEmailSuggestion(
      isSignup
        ? suggestEmailDomain(value)
        : null
    );
  };

  const clearFieldError = (key) => {

    if (fieldErrors[key]) {
      setFieldErrors((current) => ({
        ...current,
        [key]: undefined,
      }));
    }
  };

  const toggleSecure = (isConfirm) => {

    const animation =
      isConfirm ? confirmEyeAnim : eyeAnim;

    Animated.sequence([
      Animated.timing(animation, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(animation, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();

    if (isConfirm) {
      setSecureConfirmPassword(
        (value) => !value
      );
    } else {
      setSecurePassword((value) => !value);
    }
  };

  const pressSubmitIn = () =>
    Animated.spring(submitScale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 40,
    }).start();

  const pressSubmitOut = () =>
    Animated.spring(submitScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
    }).start();

  /* DERIVED */

  const passwordScore =
    getPasswordScore(password);

  const showCapsHint =
    password.length >= 3 &&
    looksLikeCapsLock(password);

  const submitDisabled =
    isSubmitting || cooldown > 0;

  const pillWidth =
    switchWidth > 0
      ? (switchWidth - 10) / 2
      : 0;

  /* SHARED FIELD RENDERER */

  const renderFieldError = (key) =>
    fieldErrors[key] ? (
      <Text
        style={[
          styles.fieldError,
          {
            color: colors.danger,
          },
        ]}
      >
        {fieldErrors[key]}
      </Text>
    ) : null;

  const inputStyle = (key) => [
    styles.input,
    {
      backgroundColor: colors.background,
      color: colors.textDark,
      borderColor: fieldErrors[key]
        ? colors.danger
        : 'transparent',
    },
  ];

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

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >

        <ScrollView
          contentContainerStyle={
            styles.scrollContent
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* OFFLINE BANNER */}

          {isOffline && (

            <View
              style={[
                styles.offlineBanner,
                {
                  backgroundColor:
                    isDarkMode
                      ? 'rgba(248,113,113,0.14)'
                      : '#FEE2E2',
                },
              ]}
            >
              <MaterialIcons
                name="wifi-off"
                size={16}
                color={colors.danger}
              />
              <Text
                style={[
                  styles.offlineText,
                  {
                    color: colors.danger,
                  },
                ]}
              >
                You are offline. Connect to the internet to sign in.
              </Text>
            </View>

          )}

          {/* HERO */}

          <Animated.View
            style={[
              styles.brandBlock,
              {
                backgroundColor:
                  isDarkMode
                    ? colors.card
                    : '#EEE9FF',
                borderColor:
                  isDarkMode
                    ? 'rgba(165,180,252,0.14)'
                    : 'rgba(124,58,237,0.08)',
                opacity: heroAnim,
                transform: [
                  {
                    translateY:
                      heroAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-24, 0],
                      }),
                  },
                ],
              },
            ]}
          >

            <View
              accessibilityElementsHidden={true}
              importantForAccessibility="no-hide-descendants"
              style={StyleSheet.absoluteFill}
            >
              <View
                style={[
                  styles.heroWaveOne,
                  isDarkMode &&
                    styles.heroWaveDark,
                ]}
              />
              <View
                style={[
                  styles.heroWaveTwo,
                  isDarkMode &&
                    styles.heroWaveTwoDark,
                ]}
              />
              <View
                style={[
                  styles.heroCurve,
                  isDarkMode &&
                    styles.heroCurveDark,
                ]}
              />
              <View style={styles.authCardArt}>
                <View style={styles.authCardLineOne} />
                <View style={styles.authCardLineTwo} />
              </View>
              <View
                style={[
                  styles.lockArt,
                  {
                    left: isCompactWidth ? 24 : 42,
                  },
                  isDarkMode &&
                    styles.heroArtDark,
                ]}
              >
                <MaterialIcons
                  name="lock"
                  size={24}
                  color={colors.primary}
                />
              </View>
              <View style={styles.heroSparkleOne} />
              <View style={styles.heroSparkleTwo} />
            </View>

            {isSignup && (

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to login"
                disabled={isSubmitting}
                style={({
                  hovered,
                  pressed,
                }) => [
                  styles.heroBackButton,
                  {
                    backgroundColor:
                      colors.card,
                  },
                  hovered &&
                    styles.iconButtonHover,
                  pressed &&
                    styles.buttonPressed,
                ]}
                onPress={() =>
                  switchMode('login')
                }
              >
                <MaterialIcons
                  name="arrow-back"
                  size={25}
                  color={colors.primary}
                />
              </Pressable>

            )}

            <View
              style={[
                styles.logoCircle,
                {
                  backgroundColor:
                    colors.primary,
                },
              ]}
            >
              <MaterialIcons
                name="school"
                size={36}
                color="#FFFFFF"
              />
            </View>

            <Text
              style={[
                styles.appTitle,
                {
                  color: colors.primary,
                },
              ]}
            >
              QuizMate
            </Text>

            <Text
              style={[
                styles.appSubtitle,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Smart Semester Manager
            </Text>

          </Animated.View>

          {/* QUICK UNLOCK */}

          {quickUnlock && !isSignup && (

            <Animated.View
              style={[
                styles.quickCard,
                {
                  backgroundColor: colors.card,
                  borderColor:
                    isDarkMode
                      ? 'rgba(165,180,252,0.16)'
                      : 'rgba(91,95,239,0.12)',
                  opacity: cardAnim,
                  transform: [
                    {
                      translateY:
                        cardAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0],
                        }),
                    },
                  ],
                },
              ]}
            >

              <View style={styles.quickHeader}>

                <View
                  style={[
                    styles.quickAvatar,
                    {
                      backgroundColor:
                        colors.primary,
                    },
                  ]}
                >
                  <Text style={styles.quickAvatarText}>
                    {(quickUnlock.name ||
                      quickUnlock.email ||
                      'U')
                      .trim()
                      .charAt(0)
                      .toUpperCase()}
                  </Text>
                </View>

                <View style={styles.quickIdentity}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.quickName,
                      {
                        color: colors.textDark,
                      },
                    ]}
                  >
                    {quickUnlock.name || 'Welcome back'}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.quickEmail,
                      {
                        color: colors.textLight,
                      },
                    ]}
                  >
                    {quickUnlock.email}
                  </Text>
                </View>

              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unlock with ${biometricLabel}`}
                accessibilityState={{
                  busy: isQuickUnlocking,
                }}
                disabled={isQuickUnlocking}
                style={({ hovered, pressed }) => [
                  styles.quickButton,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                  isQuickUnlocking &&
                    styles.submitButtonDisabled,
                  hovered &&
                    !isQuickUnlocking &&
                    styles.primaryButtonHover,
                  pressed &&
                    !isQuickUnlocking &&
                    styles.buttonPressed,
                ]}
                onPress={handleQuickUnlock}
              >
                {isQuickUnlocking ? (
                  <>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                    <Text style={styles.quickButtonText}>
                      Signing you in...
                    </Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons
                      name="fingerprint"
                      size={22}
                      color="#FFFFFF"
                    />
                    <Text style={styles.quickButtonText}>
                      Unlock with {biometricLabel}
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use a different account"
                disabled={isQuickUnlocking}
                onPress={handleForgetDevice}
                style={({ hovered, pressed }) => [
                  styles.quickSecondary,
                  hovered && styles.segmentHover,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text
                  style={[
                    styles.quickSecondaryText,
                    {
                      color: colors.textLight,
                    },
                  ]}
                >
                  Not you? Use a different account
                </Text>
              </Pressable>

              <View style={styles.quickDivider}>
                <View
                  style={[
                    styles.dividerLine,
                    {
                      backgroundColor:
                        isDarkMode
                          ? 'rgba(165,180,252,0.18)'
                          : 'rgba(91,95,239,0.14)',
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.dividerText,
                    {
                      color: colors.textLight,
                    },
                  ]}
                >
                  or sign in below
                </Text>
                <View
                  style={[
                    styles.dividerLine,
                    {
                      backgroundColor:
                        isDarkMode
                          ? 'rgba(165,180,252,0.18)'
                          : 'rgba(91,95,239,0.14)',
                    },
                  ]}
                />
              </View>

            </Animated.View>

          )}

          {/* FORM CARD */}

          <Animated.View
            style={[
              styles.authCard,
              {
                backgroundColor:
                  colors.card,
                opacity: cardAnim,
                transform: [
                  {
                    translateY:
                      cardAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [26, 0],
                      }),
                  },
                  {
                    translateX:
                      shakeAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: [-9, 9],
                      }),
                  },
                ],
              },
            ]}
          >

            {/* MODE SWITCH WITH SLIDING PILL */}

            <View
              onLayout={(event) =>
                setSwitchWidth(
                  event.nativeEvent.layout.width
                )
              }
              style={[
                styles.modeSwitch,
                {
                  backgroundColor:
                    colors.background,
                },
              ]}
            >

              {pillWidth > 0 && (
                <Animated.View
                  style={[
                    styles.modePill,
                    {
                      width: pillWidth,
                      backgroundColor:
                        colors.primary,
                      transform: [
                        {
                          translateX:
                            pillAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, pillWidth],
                            }),
                        },
                      ],
                    },
                  ]}
                />
              )}

              <Pressable
                accessibilityRole="tab"
                accessibilityState={{
                  selected: !isSignup,
                }}
                accessibilityLabel="Login"
                disabled={isSubmitting}
                style={({ hovered, pressed }) => [
                  styles.modeButton,
                  hovered && styles.segmentHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() =>
                  switchMode('login')
                }
              >
                <Text
                  style={[
                    styles.modeText,
                    {
                      color: !isSignup
                        ? '#FFFFFF'
                        : colors.textLight,
                    },
                  ]}
                >
                  Login
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="tab"
                accessibilityState={{
                  selected: isSignup,
                }}
                accessibilityLabel="Sign up"
                disabled={isSubmitting}
                style={({ hovered, pressed }) => [
                  styles.modeButton,
                  hovered && styles.segmentHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() =>
                  switchMode('signup')
                }
              >
                <Text
                  style={[
                    styles.modeText,
                    {
                      color: isSignup
                        ? '#FFFFFF'
                        : colors.textLight,
                    },
                  ]}
                >
                  Sign Up
                </Text>
              </Pressable>

            </View>

            <Text
              style={[
                styles.formTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              {isSignup
                ? 'Create Account'
                : 'Welcome Back'}
            </Text>

            {/* NAME */}

            {isSignup && (

              <View style={styles.fieldGroup}>
                <TextInput
                  ref={nameRef}
                  placeholder="Full name"
                  placeholderTextColor={
                    colors.textLight
                  }
                  style={inputStyle('name')}
                  value={name}
                  onChangeText={(value) => {
                    setName(value);
                    clearFieldError('name');
                  }}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  onSubmitEditing={() =>
                    emailRef.current?.focus()
                  }
                  blurOnSubmit={false}
                />
                {renderFieldError('name')}
              </View>

            )}

            {/* EMAIL / IDENTIFIER */}

            <View style={styles.fieldGroup}>
              <TextInput
                ref={emailRef}
                placeholder={
                  isSignup
                    ? 'Email address'
                    : 'Email or Reg No'
                }
                placeholderTextColor={
                  colors.textLight
                }
                style={inputStyle('email')}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={handleEmailChange}
                autoComplete={
                  isSignup ? 'email' : 'username'
                }
                textContentType={
                  isSignup
                    ? 'emailAddress'
                    : 'username'
                }
                returnKeyType="next"
                onSubmitEditing={() =>
                  isSignup
                    ? regNoRef.current?.focus()
                    : passwordRef.current?.focus()
                }
                blurOnSubmit={false}
              />

              {renderFieldError('email')}

              {emailSuggestion && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${emailSuggestion} instead`}
                  onPress={() => {
                    setEmail(emailSuggestion);
                    setEmailSuggestion(null);
                  }}
                  style={styles.suggestionRow}
                >
                  <MaterialIcons
                    name="auto-fix-high"
                    size={15}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.suggestionText,
                      {
                        color: colors.primary,
                      },
                    ]}
                  >
                    Did you mean {emailSuggestion}?
                  </Text>
                </Pressable>
              )}
            </View>

            {/* REG NO */}

            {isSignup && (

              <View style={styles.fieldGroup}>
                <TextInput
                  ref={regNoRef}
                  placeholder="Reg No (e.g FA23-BSE-037)"
                  placeholderTextColor={
                    colors.textLight
                  }
                  style={inputStyle('regNo')}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={regNo}
                  onChangeText={(value) => {
                    setRegNo(formatRegNo(value));
                    clearFieldError('regNo');
                  }}
                  maxLength={14}
                  returnKeyType="next"
                  onSubmitEditing={() =>
                    passwordRef.current?.focus()
                  }
                  blurOnSubmit={false}
                />
                {renderFieldError('regNo')}
              </View>

            )}

            {/* PASSWORD */}

            <View style={styles.fieldGroup}>
              <View
                style={[
                  styles.passwordRow,
                  {
                    backgroundColor:
                      colors.background,
                    borderColor:
                      fieldErrors.password
                        ? colors.danger
                        : 'transparent',
                  },
                ]}
              >
                <TextInput
                  ref={passwordRef}
                  placeholder="Password"
                  placeholderTextColor={
                    colors.textLight
                  }
                  style={[
                    styles.passwordInput,
                    {
                      color: colors.textDark,
                    },
                  ]}
                  secureTextEntry={securePassword}
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    clearFieldError('password');
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={
                    isSignup
                      ? 'new-password'
                      : 'password'
                  }
                  textContentType={
                    isSignup
                      ? 'newPassword'
                      : 'password'
                  }
                  returnKeyType={
                    isSignup ? 'next' : 'go'
                  }
                  onSubmitEditing={() =>
                    isSignup
                      ? confirmRef.current?.focus()
                      : handleSubmit()
                  }
                  blurOnSubmit={!isSignup}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    securePassword
                      ? 'Show password'
                      : 'Hide password'
                  }
                  style={({ hovered, pressed }) => [
                    styles.eyeButton,
                    hovered && styles.iconButtonHover,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => toggleSecure(false)}
                >
                  <Animated.View
                    style={{
                      opacity: eyeAnim,
                      transform: [
                        {
                          rotate:
                            eyeAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: ['-45deg', '0deg'],
                            }),
                        },
                      ],
                    }}
                  >
                    <MaterialIcons
                      name={
                        securePassword
                          ? 'visibility-off'
                          : 'visibility'
                      }
                      size={22}
                      color={colors.textLight}
                    />
                  </Animated.View>
                </Pressable>
              </View>

              {renderFieldError('password')}

              {showCapsHint && (
                <View style={styles.capsRow}>
                  <MaterialIcons
                    name="keyboard-capslock"
                    size={15}
                    color={colors.warning}
                  />
                  <Text
                    style={[
                      styles.capsText,
                      {
                        color: colors.warning,
                      },
                    ]}
                  >
                    Caps Lock may be on.
                  </Text>
                </View>
              )}
            </View>

            {/* PASSWORD STRENGTH: SIGNUP ONLY */}

            {isSignup && password.length > 0 && (

              <View style={styles.strengthBlock}>

                <View style={styles.strengthHeader}>
                  <View
                    style={[
                      styles.strengthTrack,
                      {
                        backgroundColor:
                          isDarkMode
                            ? 'rgba(165,180,252,0.16)'
                            : '#E5E7EB',
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.strengthFill,
                        {
                          width: `${(passwordScore / 4) * 100}%`,
                          backgroundColor:
                            passwordScore <= 1
                              ? colors.danger
                              : passwordScore === 2
                                ? colors.warning
                                : passwordScore === 3
                                  ? '#F59E0B'
                                  : colors.success,
                        },
                      ]}
                    />
                  </View>

                  <Text
                    style={[
                      styles.strengthLabel,
                      {
                        color:
                          passwordScore <= 1
                            ? colors.danger
                            : passwordScore === 4
                              ? colors.success
                              : colors.textLight,
                      },
                    ]}
                  >
                    {getStrengthLabel(passwordScore)}
                  </Text>
                </View>

                {PASSWORD_RULES.map((rule) => {

                  const passed =
                    rule.test(password);

                  return (
                    <View
                      key={rule.key}
                      style={styles.ruleRow}
                    >
                      <MaterialIcons
                        name={
                          passed
                            ? 'check-circle'
                            : 'radio-button-unchecked'
                        }
                        size={15}
                        color={
                          passed
                            ? colors.success
                            : colors.textLight
                        }
                      />
                      <Text
                        style={[
                          styles.ruleText,
                          {
                            color: passed
                              ? colors.success
                              : colors.textLight,
                          },
                        ]}
                      >
                        {rule.label}
                      </Text>
                    </View>
                  );
                })}

              </View>

            )}

            {/* CONFIRM PASSWORD */}

            {isSignup && (

              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.passwordRow,
                    {
                      backgroundColor:
                        colors.background,
                      borderColor:
                        fieldErrors.confirmPassword
                          ? colors.danger
                          : 'transparent',
                    },
                  ]}
                >
                  <TextInput
                    ref={confirmRef}
                    placeholder="Confirm password"
                    placeholderTextColor={
                      colors.textLight
                    }
                    style={[
                      styles.passwordInput,
                      {
                        color: colors.textDark,
                      },
                    ]}
                    secureTextEntry={
                      secureConfirmPassword
                    }
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      clearFieldError('confirmPassword');
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                  />

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      secureConfirmPassword
                        ? 'Show confirm password'
                        : 'Hide confirm password'
                    }
                    style={({ hovered, pressed }) => [
                      styles.eyeButton,
                      hovered && styles.iconButtonHover,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => toggleSecure(true)}
                  >
                    <Animated.View
                      style={{
                        opacity: confirmEyeAnim,
                        transform: [
                          {
                            rotate:
                              confirmEyeAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['-45deg', '0deg'],
                              }),
                          },
                        ],
                      }}
                    >
                      <MaterialIcons
                        name={
                          secureConfirmPassword
                            ? 'visibility-off'
                            : 'visibility'
                        }
                        size={22}
                        color={colors.textLight}
                      />
                    </Animated.View>
                  </Pressable>
                </View>

                {renderFieldError('confirmPassword')}
              </View>

            )}

            {/* FORM LEVEL ERROR */}

            {formError.length > 0 && (

              <View
                style={[
                  styles.formErrorRow,
                  {
                    backgroundColor:
                      isDarkMode
                        ? 'rgba(248,113,113,0.12)'
                        : '#FEE2E2',
                  },
                ]}
              >
                <MaterialIcons
                  name="error-outline"
                  size={17}
                  color={colors.danger}
                />
                <Text
                  style={[
                    styles.formErrorText,
                    {
                      color: colors.danger,
                    },
                  ]}
                >
                  {formError}
                </Text>
              </View>

            )}

            {/* FORGOT PASSWORD */}

            {!isSignup && (

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset your password"
                style={({ hovered, pressed }) => [
                  styles.forgotButton,
                  hovered && styles.segmentHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={openResetModal}
              >
                <Text
                  style={[
                    styles.forgotText,
                    {
                      color: colors.primary,
                    },
                  ]}
                >
                  Forgot Password?
                </Text>
              </Pressable>

            )}

            {/* SUBMIT */}

            <Animated.View
              style={{
                transform: [
                  {
                    scale: submitScale,
                  },
                ],
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isSignup
                    ? 'Create account'
                    : 'Login'
                }
                accessibilityState={{
                  disabled: submitDisabled,
                  busy: isSubmitting,
                }}
                style={({ hovered, pressed }) => [
                  styles.submitButton,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                  submitDisabled &&
                    styles.submitButtonDisabled,
                  hovered &&
                    !submitDisabled &&
                    styles.primaryButtonHover,
                  pressed &&
                    !submitDisabled &&
                    styles.buttonPressed,
                ]}
                disabled={submitDisabled}
                onPressIn={pressSubmitIn}
                onPressOut={pressSubmitOut}
                onPress={handleSubmit}
              >
                {isSubmitting ? (

                  <View style={styles.submitLoadingRow}>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                    <Text
                      style={[
                        styles.submitText,
                        styles.submitLoadingText,
                      ]}
                    >
                      {isSignup
                        ? 'Creating your account...'
                        : 'Logging in...'}
                    </Text>
                  </View>

                ) : (

                  <Text style={styles.submitText}>
                    {cooldown > 0
                      ? `Try again in ${cooldown}s`
                      : isSignup
                        ? 'Create Account'
                        : 'Login'}
                  </Text>

                )}
              </Pressable>
            </Animated.View>

          </Animated.View>

        </ScrollView>

      </KeyboardAvoidingView>

      {/* SIGNUP SUCCESS */}

      <Modal
        visible={successVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() =>
          setSuccessVisible(false)
        }
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.successBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.successIcon,
                {
                  backgroundColor:
                    colors.success,
                  transform: [
                    {
                      scale: successScale,
                    },
                  ],
                },
              ]}
            >
              <MaterialIcons
                name="check"
                size={34}
                color="#FFFFFF"
              />
            </Animated.View>

            <Text
              style={[
                styles.successTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              Account Created
            </Text>

            <Text
              style={[
                styles.successMessage,
                {
                  color: colors.textLight,
                },
              ]}
            >
              We sent a verification link to your email. Open it,
              then come back and continue.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I have verified my email, continue"
              disabled={isCheckingVerify}
              style={({ hovered, pressed }) => [
                styles.successButton,
                {
                  backgroundColor:
                    colors.primary,
                },
                isCheckingVerify &&
                  styles.submitButtonDisabled,
                hovered &&
                  !isCheckingVerify &&
                  styles.primaryButtonHover,
                pressed &&
                  !isCheckingVerify &&
                  styles.buttonPressed,
              ]}
              onPress={handleCheckVerified}
            >
              {isCheckingVerify ? (
                <View style={styles.submitLoadingRow}>
                  <ActivityIndicator
                    size="small"
                    color="#FFFFFF"
                  />
                  <Text
                    style={[
                      styles.successButtonText,
                      styles.submitLoadingText,
                    ]}
                  >
                    Checking...
                  </Text>
                </View>
              ) : (
                <Text style={styles.successButtonText}>
                  I've Verified — Continue
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend verification email"
              disabled={isResending}
              style={({ hovered, pressed }) => [
                styles.secondaryAction,
                hovered && styles.segmentHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleResendVerification}
            >
              <Text
                style={[
                  styles.secondaryActionText,
                  {
                    color: colors.primary,
                  },
                ]}
              >
                {isResending
                  ? 'Sending...'
                  : 'Resend verification email'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to login"
              style={({ hovered, pressed }) => [
                styles.secondaryAction,
                hovered && styles.segmentHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => {
                pendingAuth.current = null;
                setSuccessVisible(false);
                setPassword('');
                setConfirmPassword('');
                setMode('login');
                pillAnim.setValue(0);
              }}
            >
              <Text
                style={[
                  styles.secondaryActionText,
                  {
                    color: colors.textLight,
                  },
                ]}
              >
                Go to Login
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* EMAIL NOT VERIFIED */}

      <Modal
        visible={verifyVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeVerifyModal}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.successBox,
              {
                backgroundColor:
                  colors.card,
              },
            ]}
          >
            <View
              style={[
                styles.successIcon,
                {
                  backgroundColor:
                    colors.primary,
                },
              ]}
            >
              <MaterialIcons
                name="mark-email-unread"
                size={32}
                color="#FFFFFF"
              />
            </View>

            <Text
              style={[
                styles.successTitle,
                {
                  color: colors.textDark,
                },
              ]}
            >
              Verify Your Email
            </Text>

            <Text
              style={[
                styles.successMessage,
                {
                  color: colors.textLight,
                },
              ]}
            >
              Open the verification link we sent to{' '}
              {pendingAuth.current?.email || 'your email'}, then
              tap the button below. Remember to check your Junk
              or Spam folder.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="I have verified my email, continue"
              disabled={isCheckingVerify}
              style={({ hovered, pressed }) => [
                styles.successButton,
                {
                  backgroundColor:
                    colors.primary,
                },
                isCheckingVerify &&
                  styles.submitButtonDisabled,
                hovered &&
                  !isCheckingVerify &&
                  styles.primaryButtonHover,
                pressed &&
                  !isCheckingVerify &&
                  styles.buttonPressed,
              ]}
              onPress={handleCheckVerified}
            >
              {isCheckingVerify ? (
                <View style={styles.submitLoadingRow}>
                  <ActivityIndicator
                    size="small"
                    color="#FFFFFF"
                  />
                  <Text
                    style={[
                      styles.successButtonText,
                      styles.submitLoadingText,
                    ]}
                  >
                    Checking...
                  </Text>
                </View>
              ) : (
                <Text style={styles.successButtonText}>
                  I've Verified — Continue
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend verification email"
              disabled={isResending}
              style={({ hovered, pressed }) => [
                styles.secondaryAction,
                hovered && styles.segmentHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleResendVerification}
            >
              <Text
                style={[
                  styles.secondaryActionText,
                  {
                    color: colors.primary,
                  },
                ]}
              >
                {isResending
                  ? 'Sending...'
                  : 'Resend verification email'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ hovered, pressed }) => [
                styles.secondaryAction,
                hovered && styles.segmentHover,
                pressed && styles.buttonPressed,
              ]}
              onPress={closeVerifyModal}
            >
              <Text
                style={[
                  styles.secondaryActionText,
                  {
                    color: colors.textLight,
                  },
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* PASSWORD RESET */}

      <Modal
        visible={resetVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() =>
          setResetVisible(false)
        }
      >
        <KeyboardAvoidingView
          style={styles.modalKeyboardView}
          behavior={
            Platform.OS === 'ios'
              ? 'padding'
              : undefined
          }
        >
          <ScrollView
            contentContainerStyle={
              styles.modalScrollContent
            }
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.successBox,
                {
                  backgroundColor:
                    colors.card,
                },
              ]}
            >
              <View
                style={[
                  styles.successIcon,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                ]}
              >
                <MaterialIcons
                  name="mark-email-read"
                  size={32}
                  color="#FFFFFF"
                />
              </View>

              <Text
                style={[
                  styles.successTitle,
                  {
                    color: colors.textDark,
                  },
                ]}
              >
                Reset Password
              </Text>

              <Text
                style={[
                  styles.successMessage,
                  {
                    color: colors.textLight,
                  },
                ]}
              >
                Enter your account email. Firebase will send a
                secure reset link.
              </Text>

              <TextInput
                placeholder="Email address"
                placeholderTextColor={
                  colors.textLight
                }
                style={[
                  styles.resetInput,
                  {
                    backgroundColor:
                      colors.background,
                    color: colors.textDark,
                  },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                returnKeyType="send"
                onSubmitEditing={handlePasswordReset}
                value={resetEmail}
                onChangeText={setResetEmail}
              />

              {resetError.length > 0 && (
                <Text
                  style={[
                    styles.resetFeedback,
                    {
                      color: colors.danger,
                    },
                  ]}
                >
                  {resetError}
                </Text>
              )}

              {resetMessage.length > 0 && (
                <Text
                  style={[
                    styles.resetFeedback,
                    {
                      color: colors.success,
                    },
                  ]}
                >
                  {resetMessage}
                </Text>
              )}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send password reset link"
                style={({ hovered, pressed }) => [
                  styles.successButton,
                  {
                    backgroundColor:
                      colors.primary,
                  },
                  isResetting &&
                    styles.submitButtonDisabled,
                  hovered &&
                    !isResetting &&
                    styles.primaryButtonHover,
                  pressed &&
                    !isResetting &&
                    styles.buttonPressed,
                ]}
                disabled={isResetting}
                onPress={handlePasswordReset}
              >
                {isResetting ? (
                  <View style={styles.submitLoadingRow}>
                    <ActivityIndicator
                      size="small"
                      color="#FFFFFF"
                    />
                    <Text
                      style={[
                        styles.successButtonText,
                        styles.submitLoadingText,
                      ]}
                    >
                      Sending reset link...
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.successButtonText}>
                    Send Reset Link
                  </Text>
                )}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                disabled={isResetting}
                style={({ hovered, pressed }) => [
                  styles.secondaryAction,
                  hovered && styles.segmentHover,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() =>
                  setResetVisible(false)
                }
              >
                <Text
                  style={[
                    styles.secondaryActionText,
                    {
                      color: colors.textLight,
                    },
                  ]}
                >
                  Close
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({

  safeArea: {
    flex: 1,
  },

  keyboardView: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SCREEN_PADDING,
    paddingVertical: 28,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },

  /* OFFLINE */

  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
  },

  offlineText: {
    flex: 1,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
  },

  /* QUICK UNLOCK */

  quickCard: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    padding: 20,
    marginBottom: 18,
    ...SHADOW,
  },

  quickHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },

  quickAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
  },

  quickAvatarText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: 'bold',
  },

  quickIdentity: {
    flex: 1,
  },

  quickName: {
    fontSize: TYPOGRAPHY.cardTitle,
    fontWeight: 'bold',
  },

  quickEmail: {
    marginTop: 3,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  quickButton: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    borderRadius: CARD_RADIUS,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  quickButtonText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body,
    fontWeight: 'bold',
  },

  quickSecondary: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  quickSecondaryText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  quickDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
  },

  dividerLine: {
    flex: 1,
    height: 1,
  },

  dividerText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  /* HERO */

  brandBlock: {
    position: 'relative',
    alignItems: 'center',
    minHeight: 190,
    marginBottom: 22,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderRadius: 26,
    borderWidth: 1,
    overflow: 'hidden',
  },

  heroWaveOne: {
    position: 'absolute',
    left: -54,
    right: -50,
    top: 66,
    height: 66,
    backgroundColor:
      'rgba(255,255,255,0.42)',
    borderTopLeftRadius: 130,
    borderTopRightRadius: 160,
    transform: [
      {
        rotate: '-7deg',
      },
    ],
  },

  heroWaveDark: {
    backgroundColor:
      'rgba(99,102,241,0.12)',
  },

  heroWaveTwo: {
    position: 'absolute',
    left: -36,
    right: -44,
    bottom: -26,
    height: 84,
    backgroundColor:
      'rgba(221,214,254,0.48)',
    borderTopLeftRadius: 170,
    borderTopRightRadius: 120,
    transform: [
      {
        rotate: '6deg',
      },
    ],
  },

  heroWaveTwoDark: {
    backgroundColor:
      'rgba(124,58,237,0.12)',
  },

  heroCurve: {
    position: 'absolute',
    right: -26,
    top: 28,
    left: '42%',
    height: 54,
    borderTopWidth: 2,
    borderColor:
      'rgba(91,95,239,0.14)',
    borderRadius: 120,
    transform: [
      {
        rotate: '-13deg',
      },
    ],
  },

  heroCurveDark: {
    borderColor:
      'rgba(165,180,252,0.18)',
  },

  authCardArt: {
    position: 'absolute',
    right: '12%',
    top: 24,
    width: 54,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 9,
    paddingVertical: 9,
    transform: [
      {
        rotate: '-8deg',
      },
    ],
  },

  authCardLineOne: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#FBBF24',
    marginBottom: 7,
  },

  authCardLineTwo: {
    width: '72%',
    height: 5,
    borderRadius: 3,
    backgroundColor:
      'rgba(255,255,255,0.78)',
  },

  lockArt: {
    position: 'absolute',
    top: 24,
    width: 50,
    height: 50,
    borderRadius: 17,
    backgroundColor:
      'rgba(255,255,255,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOW,
  },

  heroArtDark: {
    backgroundColor:
      'rgba(15,23,42,0.82)',
    borderWidth: 1,
    borderColor:
      'rgba(165,180,252,0.14)',
  },

  heroSparkleOne: {
    position: 'absolute',
    left: '28%',
    top: 22,
    width: 10,
    height: 10,
    borderRadius: 3,
    backgroundColor:
      'rgba(196,181,253,0.78)',
    transform: [
      {
        rotate: '45deg',
      },
    ],
  },

  heroSparkleTwo: {
    position: 'absolute',
    right: '34%',
    bottom: 26,
    width: 9,
    height: 9,
    borderRadius: 3,
    backgroundColor:
      'rgba(250,204,21,0.62)',
    transform: [
      {
        rotate: '45deg',
      },
    ],
  },

  heroBackButton: {
    position: 'absolute',
    left: 16,
    top: 16,
    width: 46,
    height: 46,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 4,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
    ...SHADOW,
  },

  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: CARD_RADIUS,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    zIndex: 2,
    ...SHADOW,
  },

  appTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    lineHeight: 42,
    zIndex: 2,
  },

  appSubtitle: {
    marginTop: 8,
    fontSize: TYPOGRAPHY.body,
    fontWeight: '600',
    zIndex: 2,
  },

  /* CARD */

  authCard: {
    borderRadius: CARD_RADIUS,
    padding: 22,
    borderWidth: 1,
    borderColor:
      'rgba(91,95,239,0.06)',
    ...SHADOW,
  },

  modeSwitch: {
    position: 'relative',
    flexDirection: 'row',
    borderRadius: 16,
    padding: 5,
    marginBottom: 24,
  },

  modePill: {
    position: 'absolute',
    left: 5,
    top: 5,
    bottom: 5,
    borderRadius: 12,
  },

  modeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  modeText: {
    fontWeight: 'bold',
    fontSize: 14,
  },

  formTitle: {
    fontSize: TYPOGRAPHY.sectionTitle,
    fontWeight: 'bold',
    marginBottom: 18,
  },

  /* FIELDS */

  fieldGroup: {
    marginBottom: 14,
  },

  input: {
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: TYPOGRAPHY.body,
  },

  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingLeft: 16,
    paddingRight: 8,
  },

  passwordInput: {
    flex: 1,
    paddingVertical: 15,
    paddingRight: 12,
    fontSize: TYPOGRAPHY.body,
  },

  eyeButton: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  fieldError: {
    marginTop: 7,
    marginLeft: 4,
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
    lineHeight: 17,
  },

  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginLeft: 4,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  suggestionText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  capsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginLeft: 4,
  },

  capsText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '700',
  },

  /* STRENGTH */

  strengthBlock: {
    marginTop: -4,
    marginBottom: 16,
    paddingHorizontal: 4,
  },

  strengthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },

  strengthTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },

  strengthFill: {
    height: '100%',
    borderRadius: 3,
  },

  strengthLabel: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: 'bold',
    minWidth: 46,
    textAlign: 'right',
  },

  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 5,
  },

  ruleText: {
    fontSize: TYPOGRAPHY.tiny,
    fontWeight: '600',
  },

  /* FORM ERROR */

  formErrorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 12,
    marginBottom: 14,
  },

  formErrorText: {
    flex: 1,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
    lineHeight: 19,
  },

  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: -2,
    marginBottom: 14,
    paddingVertical: 6,
    paddingHorizontal: 4,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  forgotText: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  /* SUBMIT */

  submitButton: {
    paddingVertical: 16,
    borderRadius: CARD_RADIUS,
    alignItems: 'center',
    marginTop: 4,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  submitText: {
    color: '#FFFFFF',
    fontSize: TYPOGRAPHY.body,
    fontWeight: 'bold',
  },

  submitButtonDisabled: {
    opacity: 0.75,
  },

  submitLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  submitLoadingText: {
    marginLeft: 2,
  },

  /* MODALS */

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },

  modalKeyboardView: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },

  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 28,
  },

  successBox: {
    borderRadius: CARD_RADIUS,
    padding: 26,
    alignItems: 'center',
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    ...SHADOW,
  },

  successIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },

  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  successMessage: {
    marginTop: 10,
    fontSize: TYPOGRAPHY.body,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '600',
  },

  successButton: {
    marginTop: 22,
    width: '100%',
    borderRadius: CARD_RADIUS,
    paddingVertical: 15,
    alignItems: 'center',
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  successButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: TYPOGRAPHY.body,
  },

  secondaryAction: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    cursor: Platform.OS === 'web'
      ? 'pointer'
      : undefined,
  },

  secondaryActionText: {
    fontSize: 14,
    fontWeight: 'bold',
  },

  resetInput: {
    width: '100%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: TYPOGRAPHY.body,
    marginTop: 20,
    marginBottom: 12,
  },

  resetFeedback: {
    width: '100%',
    marginTop: 2,
    marginBottom: 4,
    fontSize: TYPOGRAPHY.small,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'left',
  },

  /* INTERACTION */

  segmentHover: {
    transform: [
      {
        translateY: -2,
      },
    ],
  },

  iconButtonHover: {
    backgroundColor:
      'rgba(91,95,239,0.1)',
  },

  primaryButtonHover: {
    shadowColor: '#5B5FEF',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: 8,
    },
    elevation: 5,
    transform: [
      {
        translateY: -2,
      },
    ],
  },

  buttonPressed: {
    opacity: 0.88,
  },

});
