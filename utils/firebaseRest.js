import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  Platform,
} from 'react-native';

import * as SecureStore from 'expo-secure-store';

const FIREBASE_DATABASE_URL =
  'https://quizmate-274c8-default-rtdb.firebaseio.com';

const FIREBASE_AUTH_API_KEY =
  'AIzaSyDYzk9foCH9wRZR8nRDOxOi322XDuMdprE';

const jsonHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const buildUrl = (path, authToken) => {
  const authQuery = authToken
    ? `?auth=${encodeURIComponent(authToken)}`
    : '';

  return `${FIREBASE_DATABASE_URL}/${path}.json${authQuery}`;
};

const normalizeEmail = (email) =>
  email.trim().toLowerCase();

export const normalizeRegNo = (regNo) =>
  regNo.trim().toUpperCase();

export const getUserIdFromEmail = (email) =>
  encodeURIComponent(normalizeEmail(email))
    .replace(/\./g, '%2E')
    .replace(/%/g, '_');

const getRegNoKey = (regNo) =>
  normalizeRegNo(regNo).replace(/-/g, '_');

const getEmailKey = (email) =>
  getUserIdFromEmail(email);

/* ------------------------------------------------------------------
   SESSION PERSISTENCE

   The refresh token is the one piece of this blob that can sign
   someone in without a password, so it goes to expo-secure-store
   (Android Keystore / iOS Keychain) instead of sitting in plain
   AsyncStorage with everything else. SecureStore is unavailable on
   web and can throw on some Android devices even when the platform
   check passes, so every call is wrapped and falls back to keeping
   the token inline in the AsyncStorage blob rather than losing the
   session outright.

   Other screens (ProfileScreenV2.js, SettingsScreen.js) are expected
   to read and write the session through these three functions rather
   than touching AsyncStorage's 'currentUser' key directly, so the
   split storage shape stays an implementation detail of this file.
------------------------------------------------------------------- */

const SECURE_REFRESH_TOKEN_KEY = 'quizmate.refreshToken';

const isSecureStoreSupported =
  Platform.OS !== 'web';

export const persistSession = async (user) => {

  const {
    refreshToken,
    ...profile
  } = user || {};

  if (refreshToken && isSecureStoreSupported) {

    try {

      await SecureStore.setItemAsync(
        SECURE_REFRESH_TOKEN_KEY,
        refreshToken
      );

      await AsyncStorage.setItem(
        'currentUser',
        JSON.stringify(profile)
      );

      return;

    } catch (error) {

      console.log(error);

      /* Falls through to the AsyncStorage-only path below so a
         SecureStore failure never loses the session outright. */
    }
  }

  await AsyncStorage.setItem(
    'currentUser',
    JSON.stringify(user || {})
  );
};

export const loadPersistedSession = async () => {

  try {

    const savedProfile =
      await AsyncStorage.getItem('currentUser');

    if (!savedProfile) {
      return null;
    }

    const profile = JSON.parse(savedProfile);

    if (profile.refreshToken || !isSecureStoreSupported) {

      /* Either an older record that predates the split storage, or
         the SecureStore-failed fallback above, already carries the
         token inline. */

      return profile;
    }

    const refreshToken =
      await SecureStore.getItemAsync(
        SECURE_REFRESH_TOKEN_KEY
      );

    return refreshToken
      ? { ...profile, refreshToken }
      : profile;

  } catch (error) {

    return null;
  }
};

export const clearPersistedSession = async () => {

  try {

    await AsyncStorage.removeItem('currentUser');

  } catch (error) {

    console.log(error);
  }

  if (!isSecureStoreSupported) {
    return;
  }

  try {

    await SecureStore.deleteItemAsync(
      SECURE_REFRESH_TOKEN_KEY
    );

  } catch (error) {

    console.log(error);
  }
};

const getStoredUser = () =>
  loadPersistedSession();

/* ------------------------------------------------------------------
   TIMEOUT HELPER

   Mirrors the abort pattern in utils/network.js. Without this, a
   stalled connection (dead wifi, a captive portal that never
   answers) leaves a caller hanging forever with no error and no
   loading state ever resolving. */

const DEFAULT_TIMEOUT_MS = 15000;

const fetchWithTimeout = async (
  url,
  options = {},
  timeout = DEFAULT_TIMEOUT_MS
) => {

  const controller = new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });

  } catch (error) {

    if (error?.name === 'AbortError') {
      throw new Error(
        'The request timed out. Please check your connection and try again.'
      );
    }

    throw error;

  } finally {

    clearTimeout(timer);
  }
};

/* A captive portal or a 5xx error page returns HTML, not JSON. A bare
   JSON.parse on that body throws a raw SyntaxError that nothing here
   was built to handle - on the signup path specifically, that used to
   look like an ordinary failure and trigger the rollback handler,
   deleting a brand new auth account over what was really just a bad
   hotel wifi page. */

const parseResponseBody = async (response) => {

  const text = await response.text();

  if (!text) {
    return null;
  }

  try {

    return JSON.parse(text);

  } catch (error) {

    throw new Error('Unexpected response from server.');
  }
};

/* Several screens can each trigger a data request at nearly the same
   moment (mount-time loads across tabs, a pull to refresh racing a
   background sync). Without de-duplication each one would fire its
   own refresh POST and race to read-modify-write the stored session,
   possibly overwriting a newly rotated refresh token with a stale
   one. */

let refreshInFlight = null;

const refreshStoredSession = async (savedUser) => {

  const response =
    await fetchWithTimeout(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_AUTH_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body:
          `grant_type=refresh_token&refresh_token=${encodeURIComponent(savedUser.refreshToken)}`,
      }
    );

  const data = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error('SESSION_EXPIRED');
  }

  const nextUser = {
    ...savedUser,
    idToken: data.id_token,
    refreshToken:
      data.refresh_token ||
      savedUser.refreshToken,
    expiresAt:
      Date.now() +
      Number(data.expires_in || 3600) *
        1000,
  };

  await persistSession(nextUser);

  return nextUser.idToken;
};

const getStoredAuthToken = async () => {
  const savedUser = await getStoredUser();

  if (!savedUser?.idToken) {
    return '';
  }

  const expiresAt =
    Number(savedUser.expiresAt || 0);

  /* A missing expiresAt (older stored records, or a profile write
     that never carried it forward) must mean "unknown, refresh now",
     not "never refresh" - a falsy check here used to disable
     refreshing forever for anyone who hit that case. */

  const needsRefresh =
    savedUser.refreshToken &&
    (!expiresAt || Date.now() > expiresAt - 120000);

  if (needsRefresh) {

    if (!refreshInFlight) {
      refreshInFlight =
        refreshStoredSession(savedUser).finally(
          () => {
            refreshInFlight = null;
          }
        );
    }

    return refreshInFlight;
  }

  return savedUser.idToken;
};

const authRequest = async (endpoint, body) => {
  const response =
    await fetchWithTimeout(
      `https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${FIREBASE_AUTH_API_KEY}`,
      {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }
    );

  const data = await parseResponseBody(response);

  if (!response.ok) {
    const message =
      data?.error?.message || 'Authentication failed.';

    if (message.includes('EMAIL_EXISTS')) {
      throw new Error(
        'An account with this email already exists.'
      );
    }

    if (message.includes('EMAIL_NOT_FOUND')) {
      throw new Error(
        'This email is not registered. Please enter your registered email address.'
      );
    }

    if (
      message.includes('INVALID_PASSWORD') ||
      message.includes('INVALID_LOGIN_CREDENTIALS')
    ) {
      throw new Error(
        'Incorrect email, Reg No, or password.'
      );
    }

    if (
      message.includes('TOO_MANY_ATTEMPTS_TRY_LATER')
    ) {
      const rateLimitError = new Error(
        'For your security, Firebase has temporarily limited requests. Please wait a few minutes and try again.'
      );

      /* AuthScreen keys its cooldown off this code instead of
         matching the message text, so a copy edit here can never
         silently break the cooldown. */

      rateLimitError.code = 'RATE_LIMITED';

      throw rateLimitError;
    }

    throw new Error(message);
  }

  return data;
};

const getAuthAccountInfo = async (idToken) => {
  const data = await authRequest(
    'accounts:lookup',
    {
      idToken,
    }
  );

  return data.users?.[0] || null;
};

export const sendEmailVerification =
  async (idToken) =>
    authRequest('accounts:sendOobCode', {
      requestType: 'VERIFY_EMAIL',
      idToken,
    });

/* Used to roll back a half-created signup, so a network drop
   mid-signup cannot leave an auth account with no database
   record (which would lock the email out permanently). */

export const deleteAuthAccount =
  async (idToken) =>
    authRequest('accounts:delete', {
      idToken,
    });

/* Lets the verify screen re-check without asking the user to
   type their password again. */

export const isEmailVerified = async (idToken) => {

  const account =
    await getAuthAccountInfo(idToken);

  return Boolean(account?.emailVerified);
};

/* Signs in purely to obtain a fresh token for resending a
   verification email, skipping the verified check. */

/* REFRESH TOKEN EXCHANGE
   Firebase refresh tokens are long lived and app specific, so
   they are what Quick Unlock stores instead of a password.
   They can also be revoked from the Firebase console. */

export const exchangeRefreshToken = async (
  refreshToken
) => {

  const response =
    await fetchWithTimeout(
      `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_AUTH_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded',
        },
        body:
          `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      }
    );

  const data = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      'SESSION_EXPIRED'
    );
  }

  return {
    idToken: data.id_token,
    refreshToken:
      data.refresh_token || refreshToken,
    userId: data.user_id,
    expiresAt:
      Date.now() +
      Number(data.expires_in || 3600) * 1000,
  };
};

/* Completes a sign in from a stored refresh token, used by
   Quick Unlock after the biometric prompt succeeds. */

export const loginWithRefreshToken = async (
  refreshToken
) => {

  const session =
    await exchangeRefreshToken(refreshToken);

  /* loginUser enforces this same gate elsewhere in this file.
     Without it here, Quick Unlock would let someone straight past
     email verification after an email change reset emailVerified
     back to false. */

  const authAccount =
    await getAuthAccountInfo(session.idToken);

  if (!authAccount?.emailVerified) {

    const verifyError =
      new Error('EMAIL_NOT_VERIFIED');

    verifyError.idToken = session.idToken;
    verifyError.email = authAccount?.email || '';

    throw verifyError;
  }

  const user =
    await getUserById(
      session.userId,
      session.idToken
    );

  if (!user) {
    throw new Error('SESSION_EXPIRED');
  }

  return {
    id: session.userId,
    name: user.name,
    email: user.email,
    regNo: user.regNo,
    idToken: session.idToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
};

export const getVerificationSession = async ({
  email,
  password,
}) => {

  const authUser = await authRequest(
    'accounts:signInWithPassword',
    {
      email: normalizeEmail(email),
      password,
      returnSecureToken: true,
    }
  );

  return {
    idToken: authUser.idToken,
    email: normalizeEmail(email),
  };
};

export const sendPasswordResetEmail =
  async (email) => {
    const normalizedEmail =
      normalizeEmail(email);

    /* Deliberately does not check whether the account exists first,
       and swallows the one error that would give that away.
       Reporting a different outcome for a registered vs.
       unregistered email is an account enumeration oracle - this
       makes every outcome except a genuine send failure look
       identical to the caller. */

    try {

      await authRequest('accounts:sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email: normalizedEmail,
      });

    } catch (error) {

      if (
        error?.message ===
        'This email is not registered. Please enter your registered email address.'
      ) {
        return;
      }

      throw error;
    }
  };

const request = async (path, options = {}) => {
  const {
    authToken,
    ...fetchOptions
  } = options;

  const token =
    authToken === undefined
      ? await getStoredAuthToken()
      : authToken;

  const response =
    await fetchWithTimeout(buildUrl(path, token), {
      headers: jsonHeaders,
      ...fetchOptions,
    });

  const data = await parseResponseBody(response);

  if (!response.ok) {
    throw new Error(
      data?.error || 'Firebase request failed.'
    );
  }

  return data;
};

export const createUser = async ({
  name,
  email,
  regNo,
  password,
}) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRegNo = normalizeRegNo(regNo);
  const existingRegUserId =
    await request(
      `regNoIndex/${getRegNoKey(normalizedRegNo)}`,
      {
        authToken: '',
      }
    );

  const existingEmail =
    await request(
      `emailIndex/${getEmailKey(normalizedEmail)}`,
      {
        authToken: '',
      }
    );

  if (existingEmail) {
    throw new Error(
      'An account with this email already exists.'
    );
  }

  if (existingRegUserId) {
    throw new Error(
      'An account with this Reg No already exists.'
    );
  }

  const authUser = await authRequest(
    'accounts:signUp',
    {
      email: normalizedEmail,
      password,
      returnSecureToken: true,
    }
  );

  const userId = authUser.localId;

  const user = {
    id: userId,
    name: name.trim(),
    email: normalizedEmail,
    regNo: normalizedRegNo,
    createdAt: new Date().toISOString(),
    settings: {
      notificationsEnabled: true,
      notificationTone: 'default',
      notificationVibration: 'medium',
    },
    subjects: {},
    tasks: {},
  };

  /* ATOMIC SIGNUP
     The auth account already exists at this point. If any of
     the database writes fail we delete it again, otherwise the
     email would be permanently unusable: signup would fail with
     EMAIL_EXISTS while login would find no user record. Whichever
     of the three writes below already succeeded also gets undone -
     leaving, say, the regNoIndex entry behind would permanently
     block that Reg No even though the account it pointed at no
     longer exists. */

  const written = {
    user: false,
    regNo: false,
    email: false,
  };

  try {

    await request(`users/${userId}`, {
      method: 'PUT',
      authToken: authUser.idToken,
      body: JSON.stringify(user),
    });

    written.user = true;

    await request(
      `regNoIndex/${getRegNoKey(normalizedRegNo)}`,
      {
        method: 'PUT',
        authToken: authUser.idToken,
        body: JSON.stringify({
          userId,
          email: normalizedEmail,
        }),
      }
    );

    written.regNo = true;

    /* RTDB overwrites unconditionally, so the PUT above alone cannot
       tell a genuine claim apart from a race with another signup for
       the same Reg No. Reading it back is a partial, client-side
       mitigation only - true uniqueness needs a
       ".validate": "!data.exists()" rule on regNoIndex on the
       server. */

    const confirmedRegNo =
      await request(
        `regNoIndex/${getRegNoKey(normalizedRegNo)}`,
        {
          authToken: authUser.idToken,
        }
      );

    if (confirmedRegNo?.userId !== userId) {
      throw new Error(
        'This Reg No was just claimed by another account. Please try again.'
      );
    }

    await request(
      `emailIndex/${getEmailKey(normalizedEmail)}`,
      {
        method: 'PUT',
        authToken: authUser.idToken,
        body: JSON.stringify({
          userId,
        }),
      }
    );

    written.email = true;

    /* Same TOCTOU caveat as above - true uniqueness needs a
       ".validate": "!data.exists()" rule on emailIndex too. */

    const confirmedEmail =
      await request(
        `emailIndex/${getEmailKey(normalizedEmail)}`,
        {
          authToken: authUser.idToken,
        }
      );

    if (confirmedEmail?.userId !== userId) {
      throw new Error(
        'This email was just claimed by another account. Please try again.'
      );
    }

  } catch (error) {

    /* Each rollback step is caught individually so one failure (say,
       a dropped connection mid-cleanup) does not stop the others
       from running - otherwise a single bad request here could leave
       every write above orphaned instead of just the one that
       failed. */

    if (written.email) {
      try {

        await request(
          `emailIndex/${getEmailKey(normalizedEmail)}`,
          {
            method: 'DELETE',
            authToken: authUser.idToken,
          }
        );

      } catch (rollbackError) {

        console.log(
          'Signup rollback (emailIndex) failed:',
          rollbackError
        );
      }
    }

    if (written.regNo) {
      try {

        await request(
          `regNoIndex/${getRegNoKey(normalizedRegNo)}`,
          {
            method: 'DELETE',
            authToken: authUser.idToken,
          }
        );

      } catch (rollbackError) {

        console.log(
          'Signup rollback (regNoIndex) failed:',
          rollbackError
        );
      }
    }

    if (written.user) {
      try {

        await request(`users/${userId}`, {
          method: 'DELETE',
          authToken: authUser.idToken,
        });

      } catch (rollbackError) {

        console.log(
          'Signup rollback (users) failed:',
          rollbackError
        );
      }
    }

    try {

      await deleteAuthAccount(
        authUser.idToken
      );

    } catch (rollbackError) {

      console.log(
        'Signup rollback failed:',
        rollbackError
      );
    }

    throw new Error(
      'Could not finish creating your account. Please check your connection and try again.'
    );
  }

  /* Sent after the record exists, so a failure here still
     leaves a usable account that can resend the email. */

  try {

    await sendEmailVerification(
      authUser.idToken
    );

  } catch (error) {

    console.log(
      'Verification email failed to send:',
      error
    );
  }

  return {
    id: userId,
    name: user.name,
    email: user.email,
    regNo: user.regNo,
    idToken: authUser.idToken,
    refreshToken: authUser.refreshToken,
    expiresAt:
      Date.now() +
      Number(authUser.expiresIn || 3600) *
        1000,
  };
};

export const loginUser = async ({
  identifier,
  password,
}) => {
  const trimmedIdentifier =
    identifier.trim();

  let userId;
  let email;

  if (trimmedIdentifier.includes('@')) {
    email = normalizeEmail(trimmedIdentifier);
  } else {
    const regIndex =
      await request(
        `regNoIndex/${getRegNoKey(trimmedIdentifier)}`,
        {
          authToken: '',
        }
      );

    if (!regIndex) {
      throw new Error(
        'No account found for this email or Reg No.'
      );
    }

    if (typeof regIndex === 'string') {
      throw new Error(
        'Please login with email once, then update your account.'
      );
    }

    userId = regIndex.userId;
    email = regIndex.email;
  }

  if (!email) {
    throw new Error(
      'No account found for this email or Reg No.'
    );
  }

  const authUser = await authRequest(
    'accounts:signInWithPassword',
    {
      email,
      password,
      returnSecureToken: true,
    }
  );

  const authAccount =
    await getAuthAccountInfo(
      authUser.idToken
    );

  if (!authAccount?.emailVerified) {

    /* The token is attached so the verify prompt can resend the
       email without asking for the password a second time. */

    const verifyError =
      new Error('EMAIL_NOT_VERIFIED');

    verifyError.idToken = authUser.idToken;
    verifyError.email = email;

    throw verifyError;
  }

  userId = userId || authUser.localId;

  /* Best effort only: hardened database rules only allow this write
     to succeed when the userId matches the token's own uid, so it
     silently no-ops for anyone else. A failure here must never fail
     a login whose password already verified correctly. */

  try {

    await request(
      `emailIndex/${getEmailKey(email)}`,
      {
        method: 'PUT',
        authToken: authUser.idToken,
        body: JSON.stringify({
          userId,
        }),
      }
    );

  } catch (error) {

    console.log(
      'emailIndex refresh on login failed:',
      error
    );
  }

  const user = await getUserById(
    userId,
    authUser.idToken
  );

  if (!user) {
    throw new Error(
      'No account found for this email or Reg No.'
    );
  }

  return {
    id: userId,
    name: user.name,
    email: user.email,
    regNo: user.regNo,
    idToken: authUser.idToken,
    refreshToken: authUser.refreshToken,
    expiresAt:
      Date.now() +
      Number(authUser.expiresIn || 3600) *
        1000,
  };
};

export const getUserById = (
  userId,
  authToken
) =>
  request(`users/${userId}`, {
    authToken,
  });

export const updateUserProfile = async (
  userId,
  updates
) => {
  await request(`users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
};

export const saveUserProfile = async (
  userId,
  updates
) => {
  const currentUser =
    await getUserById(userId);

  if (!currentUser) {
    throw new Error('User not found.');
  }

  const nextEmail =
    normalizeEmail(
      updates.email || currentUser.email
    );

  const currentToken =
    await getStoredAuthToken();
  const storedUser =
    await getStoredUser();

  let nextIdToken = currentToken;

  if (
    nextEmail &&
    nextEmail !== currentUser.email
  ) {
    const existingEmail =
      await request(
        `emailIndex/${getEmailKey(nextEmail)}`,
        {
          authToken: '',
        }
      );

    if (
      existingEmail &&
      existingEmail.userId !== userId
    ) {
      throw new Error(
        'An account with this email already exists.'
      );
    }

    const authUpdate =
      await authRequest(
        'accounts:update',
        {
          idToken: currentToken,
          email: nextEmail,
          returnSecureToken: true,
        }
      );

    nextIdToken =
      authUpdate.idToken || currentToken;

    await request(
      `emailIndex/${getEmailKey(currentUser.email)}`,
      {
        method: 'DELETE',
        authToken: nextIdToken,
      }
    );
  }

  const nextUser = {
    ...currentUser,
    ...updates,
    id: userId,
    email: nextEmail,
    updatedAt: new Date().toISOString(),
  };

  await request(`users/${userId}`, {
    method: 'PUT',
    authToken: nextIdToken,
    body: JSON.stringify(nextUser),
  });

  if (nextUser.regNo) {
    await request(
      `regNoIndex/${getRegNoKey(nextUser.regNo)}`,
      {
        method: 'PUT',
        authToken: nextIdToken,
        body: JSON.stringify({
          userId,
          email: nextEmail,
        }),
      }
    );
  }

  await request(
    `emailIndex/${getEmailKey(nextEmail)}`,
    {
      method: 'PUT',
      authToken: nextIdToken,
      body: JSON.stringify({
        userId,
      }),
    }
  );

  return {
    id: userId,
    name: nextUser.name,
    email: nextUser.email,
    regNo: nextUser.regNo,
    idToken: nextIdToken,
    refreshToken: storedUser?.refreshToken,

    /* Falls back to 0 rather than undefined for older stored records
       that never carried an expiresAt - getStoredAuthToken treats a
       falsy expiresAt as "unknown, refresh now" rather than "never
       refresh". */

    expiresAt: storedUser?.expiresAt || 0,
  };
};

export const deleteUserAccount = async (
  userId
) => {
  const user = await getUserById(userId);
  const authToken =
    await getStoredAuthToken();

  /* The auth account is deleted first. Firebase issues signed ID
     tokens that Realtime Database verifies without checking whether
     the auth account still exists, so this same token still
     authorizes the database cleanup that follows even though the
     account is already gone. Doing it in this order means a failure
     here - most commonly CREDENTIAL_TOO_OLD_LOGIN_AGAIN, when the
     session is not fresh enough for Firebase to allow the deletion -
     leaves the profile untouched instead of the old order, which
     nulled the profile first and then very commonly failed to delete
     the still-alive account. */

  if (authToken) {
    try {

      await authRequest('accounts:delete', {
        idToken: authToken,
      });

    } catch (error) {

      if (error?.message === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') {
        throw new Error(
          'Please sign in again before deleting your account.'
        );
      }

      throw error;
    }
  }

  /* Realtime Database supports an atomic multi-location PATCH. Keeping the
     indexes and profile in one write avoids an interrupted delete leaving a
     registration number or email permanently blocked for a future account. */
  const deletionPatch = {
    [`users/${userId}`]: null,
  };

  if (user?.regNo) {
    deletionPatch[
      `regNoIndex/${getRegNoKey(user.regNo)}`
    ] = null;
  }

  if (user?.email) {
    deletionPatch[
      `emailIndex/${getEmailKey(user.email)}`
    ] = null;
  }

  await request('', {
    method: 'PATCH',
    body: JSON.stringify(deletionPatch),
    authToken,
  });
};

/* Archived subjects stay in the database but are hidden from
   every screen by default, so archiving is a safe alternative
   to deleting a semester's worth of data. Only the Subjects
   screen asks for them explicitly. */

export const loadUserSubjects = async (
  userId,
  { includeArchived = false } = {}
) => {
  const subjects =
    await request(`users/${userId}/subjects`);

  const all =
    subjects ? Object.values(subjects) : [];

  return includeArchived
    ? all
    : all.filter((subject) => !subject.archived);
};

/* The raw tasks-by-subject map, so a list screen can show task
   counts with one request instead of one per subject. */

export const loadUserTasksBySubject = async (
  userId
) => {
  const tasks =
    await request(`users/${userId}/tasks`);

  return tasks || {};
};

export const saveUserSubjects = (
  userId,
  subjects
) => {
  const subjectsById = {};

  subjects.forEach((subject) => {
    subjectsById[subject.id] = subject;
  });

  return request(`users/${userId}/subjects`, {
    method: 'PUT',
    body: JSON.stringify(subjectsById),
  });
};

export const loadSubjectTasks = async (
  userId,
  subjectId
) => {
  const tasks =
    await request(
      `users/${userId}/tasks/${subjectId}`
    );

  return tasks ? Object.values(tasks) : [];
};

export const saveSubjectTasks = (
  userId,
  subjectId,
  tasks
) => {
  const tasksById = {};

  tasks.forEach((task) => {
    tasksById[task.id] = task;
  });

  return request(
    `users/${userId}/tasks/${subjectId}`,
    {
      method: 'PUT',
      body: JSON.stringify(tasksById),
    }
  );
};

export const deleteSubjectTasks = (
  userId,
  subjectId
) =>
  request(`users/${userId}/tasks/${subjectId}`, {
    method: 'DELETE',
  });

export const loadUserAttendance = async (
  userId
) => {
  const attendance =
    await request(`users/${userId}/attendance`);

  return attendance || {};
};

export const saveSubjectAttendance = (
  userId,
  subjectId,
  attendance
) =>
  request(
    `users/${userId}/attendance/${subjectId}`,
    {
      method: 'PUT',
      body: JSON.stringify(attendance),
    }
  );

export const deleteSubjectAttendance = (
  userId,
  subjectId
) =>
  request(
    `users/${userId}/attendance/${subjectId}`,
    {
      method: 'DELETE',
    }
  );

export const loadUserClassSchedules = async (
  userId
) => {
  const schedules =
    await request(
      `users/${userId}/classSchedules`
    );

  return schedules || {};
};

export const saveSubjectClassSchedules = (
  userId,
  subjectId,
  schedules
) => {
  const schedulesById = {};

  schedules.forEach((schedule) => {
    schedulesById[schedule.id] = schedule;
  });

  return request(
    `users/${userId}/classSchedules/${subjectId}`,
    {
      method: 'PUT',
      body: JSON.stringify(schedulesById),
    }
  );
};

export const deleteSubjectClassSchedules = (
  userId,
  subjectId
) =>
  request(
    `users/${userId}/classSchedules/${subjectId}`,
    {
      method: 'DELETE',
    }
  );

export const loadUserDateSheets = async (
  userId
) => {
  const dateSheets =
    await request(`users/${userId}/dateSheets`);

  return dateSheets
    ? Object.values(dateSheets)
    : [];
};

export const saveUserDateSheets = (
  userId,
  dateSheets
) => {
  const dateSheetsById = {};

  dateSheets.forEach((paper) => {
    dateSheetsById[paper.id] = paper;
  });

  return request(`users/${userId}/dateSheets`, {
    method: 'PUT',
    body: JSON.stringify(dateSheetsById),
  });
};

export const loadAllUserTasks = async (userId) => {
  const subjects = await loadUserSubjects(userId);
  const tasksBySubject =
    await request(`users/${userId}/tasks`);
  let allTasks = [];

  subjects.forEach((subject) => {
    const subjectTasks =
      tasksBySubject?.[subject.id] || {};

    allTasks = [
      ...allTasks,
      ...Object.values(subjectTasks).map(
        (task) => ({
          ...task,
          subjectName: subject.name,
          subjectId: subject.id,
        })
      ),
    ];
  });

  return {
    subjects,
    tasks: allTasks,
  };
};

export const loadUserSettings = async (userId) => {
  const settings =
    await request(`users/${userId}/settings`);

  return settings || {};
};

/* Public, optional support configuration. Contact Us always keeps a bundled
   fallback, so a missing/locked remote config can never leave support links
   blank while allowing the owner to update verified links without an app
   release. */
/* ------------------------------------------------------------------
   CLOUD BACKUP / RESTORE

   Everyday reads and writes no longer touch Firebase at all (see
   utils/localData.js) - these two are the only data-domain calls left,
   and they only run when the user explicitly taps Backup or Restore in
   Settings. The backup lives at `backups/{userId}`, deliberately kept
   separate from the legacy `users/{userId}` tree so a backup can never
   be confused with, or silently overwritten by, old code paths.

   NOTE: this requires the Firebase Realtime Database rules to allow the
   authenticated user to read/write `backups/$uid` the same way they can
   read/write `users/$uid`. That is a Firebase console change outside
   this codebase.
------------------------------------------------------------------- */

export const uploadUserBackup = (userId, backup) =>
  request(`backups/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(backup),
  });

export const downloadUserBackup = (userId) =>
  request(`backups/${userId}`);

export const loadSupportContacts = async () => {
  const contacts = await request('supportConfig/contacts');

  return contacts
    ? Object.values(contacts)
    : [];
};

export const updateUserSettings = (
  userId,
  updates
) =>
  request(`users/${userId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export const resetUserSemesterData = async (
  userId
) => {
  /* A single Firebase PATCH means a connection failure cannot leave the
     semester half-reset (for example, subjects removed but timetable kept). */
  await request(`users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      subjects: null,
      tasks: null,
      attendance: null,
      classSchedules: null,
      dateSheets: null,
      notifications: null,
    }),
  });
};

export const addUserNotification = async (
  userId,
  notification
) => {
  const id =
    notification.id ||
    `${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const nextNotification = {
    id,
    type: notification.type || 'default',
    title: notification.title,
    message: notification.message,
    subjectName: notification.subjectName || '',
    taskTitle: notification.taskTitle || '',
    notificationId:
      notification.notificationId || '',
    entityType: notification.entityType || '',
    entityId: notification.entityId || '',
    readAt: notification.readAt || null,
    scheduledFor:
      notification.scheduledFor ||
      new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  await request(
    `users/${userId}/notifications/${id}`,
    {
      method: 'PUT',
      body: JSON.stringify(nextNotification),
    }
  );

  return nextNotification;
};

export const loadUserNotifications = async (
  userId
) => {
  const notifications =
    await request(
      `users/${userId}/notifications`
    );

  return notifications
    ? Object.values(notifications)
    : [];
};

export const clearUserNotifications = (
  userId
) =>
  request(`users/${userId}/notifications`, {
    method: 'DELETE',
  });

export const deleteUserNotification = (
  userId,
  notificationId
) => request(`users/${userId}/notifications/${notificationId}`, {
  method: 'DELETE',
});

export const saveUserNotification = (
  userId,
  notification
) => request(`users/${userId}/notifications/${notification.id}`, {
  method: 'PUT',
  body: JSON.stringify(notification),
});

export const deleteUserNotificationsByIds = async (
  userId,
  notificationIds = []
) => {
  if (notificationIds.length === 0) {
    return;
  }

  const notifications =
    await loadUserNotifications(userId);

  const matchingNotifications =
    notifications.filter((notification) =>
      notificationIds.includes(
        notification.notificationId
      )
    );

  await Promise.all(
    matchingNotifications.map((notification) =>
      request(
        `users/${userId}/notifications/${notification.id}`,
        {
          method: 'DELETE',
        }
      )
    )
  );
};
