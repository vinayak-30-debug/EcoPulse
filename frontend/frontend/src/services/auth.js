const AUTH_STORAGE_KEY = "ecopulse_auth_session";
const AUTH_API_URL = process.env.REACT_APP_AUTH_URL;
const DEFAULT_PREDICT_URL =
  process.env.REACT_APP_API_URL || "http://127.0.0.1:8000/predict";
const API_BASE_URL =
  process.env.REACT_APP_AUTH_API_BASE_URL ||
  process.env.REACT_APP_API_BASE_URL ||
  DEFAULT_PREDICT_URL.replace(/\/predict$/i, "");
const SIGNUP_REQUEST_CODE_URL =
  process.env.REACT_APP_AUTH_SIGNUP_REQUEST_URL ||
  `${API_BASE_URL}/auth/signup/request-code`;
const SIGNUP_VERIFY_CODE_URL =
  process.env.REACT_APP_AUTH_SIGNUP_VERIFY_URL ||
  `${API_BASE_URL}/auth/signup/verify-code`;

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validateEmail(email) {
  if (!email) {
    throw new Error("Please enter your email.");
  }

  if (!/\S+@\S+\.\S+/.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
}

function formatDisplayNameFromEmail(email) {
  const userPart = email.split("@")[0] || "ecopulse user";
  return userPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function createLocalToken() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateCredentials(email, password) {
  validateEmail(email);

  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }
}

function createSessionObject(email, token, name) {
  return {
    email,
    name: name || formatDisplayNameFromEmail(email),
    token,
    loggedInAt: new Date().toISOString(),
  };
}

export function loadAuthSession() {
  if (!canUseStorage()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.email) {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

export function persistAuthSession(session) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

async function buildApiError(response, fallbackMessage) {
  let reason = `${fallbackMessage} (status ${response.status})`;

  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      reason = data.detail;
    } else if (typeof data?.message === "string") {
      reason = data.message;
    }
  } catch (error) {
    // Keep fallback message if response body is not JSON.
  }

  return reason;
}

async function loginWithApi(email, password) {
  const response = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    let reason = `Login failed with status ${response.status}`;

    try {
      const data = await response.json();
      if (typeof data?.detail === "string") {
        reason = data.detail;
      } else if (typeof data?.message === "string") {
        reason = data.message;
      }
    } catch (error) {
      // Keep default message when response body is not JSON.
    }

    throw new Error(reason);
  }

  const payload = await response.json();
  const token = payload?.token || payload?.access_token;
  if (!token) {
    throw new Error("Login response is missing a token.");
  }

  return createSessionObject(
    normalizeEmail(payload?.email || email),
    token,
    payload?.name
  );
}

export async function createAuthSession({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  validateCredentials(normalizedEmail, password);

  if (AUTH_API_URL) {
    return loginWithApi(normalizedEmail, password);
  }

  return createSessionObject(normalizedEmail, createLocalToken());
}

export async function requestSignupCode(email) {
  const normalizedEmail = normalizeEmail(email);
  validateEmail(normalizedEmail);

  const response = await fetch(SIGNUP_REQUEST_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: normalizedEmail }),
  });

  if (!response.ok) {
    throw new Error(await buildApiError(response, "Unable to send verification code"));
  }

  return response.json();
}

export async function verifySignupCode({ email, code }) {
  const normalizedEmail = normalizeEmail(email);
  validateEmail(normalizedEmail);

  const sanitizedCode = String(code || "").trim();
  if (!/^\d{6}$/.test(sanitizedCode)) {
    throw new Error("Please enter the 6-digit confirmation code.");
  }

  const response = await fetch(SIGNUP_VERIFY_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: normalizedEmail,
      code: sanitizedCode,
    }),
  });

  if (!response.ok) {
    throw new Error(await buildApiError(response, "Unable to verify confirmation code"));
  }

  const payload = await response.json();
  const token = payload?.token || payload?.access_token;
  if (!token) {
    throw new Error("Verification succeeded but token is missing.");
  }

  return createSessionObject(
    normalizeEmail(payload?.email || normalizedEmail),
    token,
    payload?.name
  );
}
