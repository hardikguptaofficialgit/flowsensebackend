import {
  buildSessionCookie,
  clearSessionCookie,
  cookieName,
  findUserBySessionToken,
  parseCookies,
  revokeSessionToken,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
} from "../services/authStore.js";
import { sendJsonError } from "../utils/http.js";

async function verifyGoogleToken(idToken, expectedEmail) {
  const token = String(idToken || "").trim();
  if (!token) {
    throw new Error("Google token is required.");
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!response.ok) {
    throw new Error("Google token verification failed.");
  }

  const payload = await response.json();
  const verifiedEmail = String(payload.email || "").trim().toLowerCase();
  const verifiedSub = String(payload.sub || "").trim();
  const emailVerified = String(payload.email_verified || "").toLowerCase() === "true";
  const requiredAudience = String(process.env.GOOGLE_CLIENT_ID || "").trim();

  if (requiredAudience && String(payload.aud || "") !== requiredAudience) {
    throw new Error("Google token audience mismatch.");
  }

  if (!emailVerified || !verifiedEmail || !verifiedSub) {
    throw new Error("Google account is not verified.");
  }

  const normalizedExpectedEmail = String(expectedEmail || "").trim().toLowerCase();
  if (normalizedExpectedEmail && verifiedEmail !== normalizedExpectedEmail) {
    throw new Error("Google token email mismatch.");
  }

  return {
    email: verifiedEmail,
    googleId: verifiedSub,
    displayName: String(payload.name || "").trim(),
    photoURL: String(payload.picture || "").trim(),
  };
}

export async function signUp(req, res) {
  try {
    const user = await signUpWithEmail({
      email: req.body?.email,
      password: req.body?.password,
      displayName: req.body?.displayName,
    });

    const session = await signInWithEmail({
      email: req.body?.email,
      password: req.body?.password,
    });

    res.setHeader("Set-Cookie", buildSessionCookie(session.token));
    res.status(201).json({ user, session: { authenticated: true } });
  } catch (error) {
    sendJsonError(res, 400, "Unable to create account.");
  }
}

export async function signIn(req, res) {
  try {
    const session = await signInWithEmail({
      email: req.body?.email,
      password: req.body?.password,
    });

    res.setHeader("Set-Cookie", buildSessionCookie(session.token));
    res.json({ user: session.user, session: { authenticated: true } });
  } catch (error) {
    sendJsonError(res, 401, error instanceof Error ? error.message : "Authentication failed.");
  }
}

export async function signOut(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[cookieName()];
  if (token) {
    await revokeSessionToken(token);
  }

  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
}

export async function authSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[cookieName()];
  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  const user = await findUserBySessionToken(token);
  if (!user) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true, user });
}

export async function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[cookieName()];
  if (!token) {
    sendJsonError(res, 401, "Authentication required.");
    return;
  }

  const user = await findUserBySessionToken(token);
  if (!user) {
    res.setHeader("Set-Cookie", clearSessionCookie());
    sendJsonError(res, 401, "Session expired. Please sign in again.");
    return;
  }

  req.user = user;
  next();
}

export async function googleAuth(req, res) {
  try {
    const { email, displayName, photoURL, idToken } = req.body || {};

    if (!idToken) {
      throw new Error("Google token is required.");
    }

    const verified = await verifyGoogleToken(idToken, email);

    const session = await signInWithGoogle({
      googleId: verified.googleId,
      email: verified.email,
      displayName: String(displayName || "").trim() || verified.displayName,
      photoURL: String(photoURL || "").trim() || verified.photoURL,
    });

    res.setHeader("Set-Cookie", buildSessionCookie(session.token));
    res.status(200).json({
      user: session.user,
      session: { authenticated: true },
    });
  } catch (error) {
    sendJsonError(res, 401, "Google sign-in failed.");
  }
}
