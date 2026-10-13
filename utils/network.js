import {
  Platform,
} from 'react-native';

/* CONNECTIVITY
   Deliberately dependency free: a short, abortable request to
   the backend host tells us whether the device can reach the
   network at all. A plausible status (2xx-4xx, so even a 401
   still proves the request left the device and got a real
   answer) counts as online; a 5xx does not, since that usually
   means something between the device and our backend, not the
   backend itself, answered. */

const CONNECTIVITY_URL =
  'https://quizmate-274c8-default-rtdb.firebaseio.com/.json?shallow=true';

const DEFAULT_TIMEOUT = 5000;

export const checkConnection = async (
  timeout = DEFAULT_TIMEOUT
) => {

  /* The browser already knows, so skip the round trip. */

  if (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine === false
  ) {
    return false;
  }

  try {

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () => controller.abort(),
        timeout
      );

    try {

      /* A plausible successful status is required, not just "any
         response arrived": a captive portal answers every request
         with HTTP 200 (its login page), which would otherwise read
         as a working connection to our own backend.
         Residual limitation: a captive portal that also fakes a
         200-599 range status matching what we expect can still fool
         this - there is no fully reliable client-side way to detect
         that without an endpoint the portal cannot spoof. */

      const response =
        await fetch(CONNECTIVITY_URL, {
          method: 'GET',
          signal: controller.signal,
        });

      return (
        response.status >= 200 &&
        response.status < 500
      );

    } finally {

      clearTimeout(timer);
    }

  } catch (error) {

    return false;
  }
};

/* Wraps an action so an offline device fails fast with a
   clear message instead of hanging on a doomed request. */

export const requireConnection = async (
  message = 'You are offline. Please check your internet connection and try again.'
) => {

  const online =
    await checkConnection(4000);

  if (!online) {
    throw new Error(message);
  }

  return true;
};
