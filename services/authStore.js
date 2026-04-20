import dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, "..", "data", "auth.json");

dotenv.config({ path: path.resolve(__dirname, "..", ".env"), override: false, quiet: true });

const SESSION_TTL_DAYS = Math.max(1, Math.min(Number.parseInt(process.env.SESSION_TTL_DAYS || "7", 10) || 7, 30));
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * SESSION_TTL_DAYS;
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "flowsense_session";
const FIRESTORE_COLLECTION_USERS = "users";
const FIRESTORE_COLLECTION_SESSIONS = "sessions";
const FIRESTORE_COLLECTION_PROFILES = "profiles";
const FIRESTORE_COLLECTION_ANALYSES = "analyses";

let writeChain = Promise.resolve();
let firestoreInitAttempted = false;
let firestoreDb = null;

function nowIso() {
  return new Date().toISOString();
}

function decodePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return !normalized || normalized.startsWith("YOUR_");
}

function isFirestoreConfigured() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");

  if (isPlaceholder(projectId) || isPlaceholder(clientEmail) || isPlaceholder(privateKey)) {
    return false;
  }

  return privateKey.includes("BEGIN PRIVATE KEY");
}

function getFirestoreDb() {
  if (firestoreInitAttempted) return firestoreDb;
  firestoreInitAttempted = true;

  if (!isFirestoreConfigured()) {
    console.warn("Firestore not configured. Using local JSON auth store (backend/data/auth.json).");
    return null;
  }

  try {
    const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
    const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
    const privateKey = decodePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");

    if (!getApps().length) {
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
        projectId,
      });
    }

    firestoreDb = getFirestore();
    console.log("Auth store persistence: Firestore");
  } catch (error) {
    console.error(`Firestore init failed. Falling back to local JSON store: ${error instanceof Error ? error.message : "Unknown error"}`);
    firestoreDb = null;
  }

  return firestoreDb;
}

function safeBase64(buffer) {
  return buffer.toString("base64url");
}

function parseBase64(value) {
  return Buffer.from(value, "base64url");
}

function getAuthSecret() {
  const secret = String(process.env.AUTH_JWT_SECRET || "").trim();
  if (!secret) {
    throw new Error("AUTH_JWT_SECRET is required.");
  }
  return secret;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, digest) {
  const [salt, hash] = String(digest || "").split(":");
  if (!salt || !hash) return false;
  const incoming = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(incoming, "hex"));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function cleanExpiredSessions(store) {
  const now = Date.now();
  Object.entries(store.sessions || {}).forEach(([tokenHash, session]) => {
    if (!session || Number(session.expiresAt) <= now) {
      delete store.sessions[tokenHash];
    }
  });
}

async function readStore() {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      users: parsed.users || {},
      sessions: parsed.sessions || {},
      profiles: parsed.profiles || {},
      analyses: parsed.analyses || {},
    };
  } catch {
    return { users: {}, sessions: {}, profiles: {}, analyses: {} };
  }
}

async function writeStore(store) {
  writeChain = writeChain.then(() => fs.writeFile(DATA_PATH, JSON.stringify(store, null, 2), "utf8"));
  await writeChain;
}

export function cookieName() {
  return COOKIE_NAME;
}

export function buildSessionCookie(value) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function parseCookies(headerValue) {
  if (!headerValue) return {};
  return String(headerValue)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) return acc;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function createSessionToken(userId) {
  const nonce = safeBase64(crypto.randomBytes(24));
  const issuedAt = String(Date.now());
  const secret = getAuthSecret();
  const signature = safeBase64(
    crypto.createHmac("sha256", secret)
      .update(`${userId}.${issuedAt}.${nonce}`)
      .digest()
  );

  return `${safeBase64(Buffer.from(userId, "utf8"))}.${issuedAt}.${nonce}.${signature}`;
}

function parseSessionToken(token) {
  const [encodedId, issuedAt, nonce, signature] = String(token || "").split(".");
  if (!encodedId || !issuedAt || !nonce || !signature) return null;

  const userId = parseBase64(encodedId).toString("utf8");
  const secret = getAuthSecret();
  const expected = safeBase64(
    crypto.createHmac("sha256", secret)
      .update(`${userId}.${issuedAt}.${nonce}`)
      .digest()
  );

  const incoming = Buffer.from(signature);
  const baseline = Buffer.from(expected);
  if (incoming.length !== baseline.length) return null;
  if (!crypto.timingSafeEqual(incoming, baseline)) return null;

  return {
    userId,
    issuedAt: Number(issuedAt),
    nonce,
  };
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName || "",
    createdAt: user.createdAt,
  };
}

function defaultProfile(user, overrides = {}) {
  return {
    displayName: String(overrides.displayName || user.displayName || ""),
    companyName: "",
    companyStage: "",
    organization: "",
    role: "",
    website: "",
    productUrl: "",
    relevantUrls: "",
    agentName: "",
    agentMode: "",
    agentNotes: "",
    bio: "",
    email: user.email,
    photoURL: String(overrides.photoURL || user.photoURL || ""),
    profileComplete: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

async function findFirestoreUserByEmail(db, normalizedEmail) {
  const snapshot = await db
    .collection(FIRESTORE_COLLECTION_USERS)
    .where("email", "==", normalizedEmail)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function signUpWithEmail({ email, password, displayName }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password || password.length < 8) {
    throw new Error("Email and a password with at least 8 characters are required.");
  }

  const db = getFirestoreDb();
  if (db) {
    const existing = await findFirestoreUserByEmail(db, normalizedEmail);
    if (existing) {
      throw new Error("An account with this email already exists.");
    }

    const userId = crypto.randomUUID();
    const user = {
      id: userId,
      email: normalizedEmail,
      displayName: String(displayName || "").trim(),
      passwordHash: hashPassword(password),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    await db.collection(FIRESTORE_COLLECTION_USERS).doc(userId).set(user);
    await db.collection(FIRESTORE_COLLECTION_PROFILES).doc(userId).set(defaultProfile(user));
    return publicUser(user);
  }

  const store = await readStore();
  const existing = Object.values(store.users).find((user) => user.email === normalizedEmail);
  if (existing) {
    throw new Error("An account with this email already exists.");
  }

  const userId = crypto.randomUUID();
  const user = {
    id: userId,
    email: normalizedEmail,
    displayName: String(displayName || "").trim(),
    passwordHash: hashPassword(password),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  store.users[userId] = user;
  store.profiles[userId] = {
    displayName: user.displayName,
    companyName: "",
    companyStage: "",
    organization: "",
    role: "",
    website: "",
    productUrl: "",
    relevantUrls: "",
    agentName: "",
    agentMode: "",
    agentNotes: "",
    bio: "",
    email: user.email,
    profileComplete: false,
    updatedAt: nowIso(),
  };

  await writeStore(store);
  return publicUser(user);
}

export async function signInWithEmail({ email, password }) {
  const normalizedEmail = normalizeEmail(email);

  const db = getFirestoreDb();
  if (db) {
    const user = await findFirestoreUserByEmail(db, normalizedEmail);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      throw new Error("Invalid email or password.");
    }

    const token = createSessionToken(user.id);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.collection(FIRESTORE_COLLECTION_SESSIONS).doc(tokenHash).set({
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: nowIso(),
    });

    return { token, user: publicUser(user) };
  }

  const store = await readStore();
  const user = Object.values(store.users).find((entry) => entry.email === normalizedEmail);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Invalid email or password.");
  }

  const token = createSessionToken(user.id);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  store.sessions[tokenHash] = {
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: nowIso(),
  };
  cleanExpiredSessions(store);
  await writeStore(store);

  return { token, user: publicUser(user) };
}

export async function findUserBySessionToken(token) {
  const parsed = parseSessionToken(token);
  if (!parsed) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const db = getFirestoreDb();
  if (db) {
    const sessionRef = db.collection(FIRESTORE_COLLECTION_SESSIONS).doc(tokenHash);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return null;

    const session = sessionSnap.data() || {};
    if (!session.userId || Number(session.expiresAt || 0) <= Date.now() || session.userId !== parsed.userId) {
      await sessionRef.delete().catch(() => null);
      return null;
    }

    const userSnap = await db.collection(FIRESTORE_COLLECTION_USERS).doc(session.userId).get();
    if (!userSnap.exists) return null;

    const user = { id: userSnap.id, ...userSnap.data() };
    return publicUser(user);
  }

  const store = await readStore();
  cleanExpiredSessions(store);

  const session = store.sessions[tokenHash];
  if (!session || session.userId !== parsed.userId) {
    await writeStore(store);
    return null;
  }

  const user = store.users[session.userId];
  if (!user) return null;

  return publicUser(user);
}

export async function revokeSessionToken(token) {
  if (!token) return;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const db = getFirestoreDb();
  if (db) {
    await db.collection(FIRESTORE_COLLECTION_SESSIONS).doc(tokenHash).delete().catch(() => null);
    return;
  }

  const store = await readStore();
  delete store.sessions[tokenHash];
  await writeStore(store);
}

export async function getProfileForUser(userId) {
  const db = getFirestoreDb();
  if (db) {
    const [profileSnap, userSnap] = await Promise.all([
      db.collection(FIRESTORE_COLLECTION_PROFILES).doc(userId).get(),
      db.collection(FIRESTORE_COLLECTION_USERS).doc(userId).get(),
    ]);

    const profile = profileSnap.exists ? profileSnap.data() || {} : {};
    const user = userSnap.exists ? userSnap.data() || {} : null;

    return {
      displayName: String(profile.displayName || user?.displayName || ""),
      companyName: String(profile.companyName || ""),
      companyStage: String(profile.companyStage || ""),
      organization: String(profile.organization || ""),
      role: String(profile.role || ""),
      website: String(profile.website || ""),
      productUrl: String(profile.productUrl || ""),
      relevantUrls: String(profile.relevantUrls || ""),
      agentName: String(profile.agentName || ""),
      agentMode: String(profile.agentMode || ""),
      agentNotes: String(profile.agentNotes || ""),
      bio: String(profile.bio || ""),
      email: user?.email || profile.email,
      photoURL: String(profile.photoURL || ""),
      profileComplete: Boolean(profile.profileComplete),
    };
  }

  const store = await readStore();
  const profile = store.profiles[userId] || {};
  const user = store.users[userId];
  return {
    displayName: String(profile.displayName || user?.displayName || ""),
    companyName: String(profile.companyName || ""),
    companyStage: String(profile.companyStage || ""),
    organization: String(profile.organization || ""),
    role: String(profile.role || ""),
    website: String(profile.website || ""),
    productUrl: String(profile.productUrl || ""),
    relevantUrls: String(profile.relevantUrls || ""),
    agentName: String(profile.agentName || ""),
    agentMode: String(profile.agentMode || ""),
    agentNotes: String(profile.agentNotes || ""),
    bio: String(profile.bio || ""),
    email: user?.email || profile.email,
    photoURL: String(profile.photoURL || ""),
    profileComplete: Boolean(profile.profileComplete),
  };
}

export async function saveProfileForUser(userId, profile) {
  const db = getFirestoreDb();
  if (db) {
    const userRef = db.collection(FIRESTORE_COLLECTION_USERS).doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) throw new Error("User not found.");

    const user = userSnap.data() || {};
    const normalized = {
      displayName: String(profile.displayName || "").trim(),
      companyName: String(profile.companyName || "").trim(),
      companyStage: String(profile.companyStage || "").trim(),
      organization: String(profile.organization || "").trim(),
      role: String(profile.role || "").trim(),
      website: String(profile.website || "").trim(),
      productUrl: String(profile.productUrl || "").trim(),
      relevantUrls: String(profile.relevantUrls || "").trim(),
      agentName: String(profile.agentName || "").trim(),
      agentMode: String(profile.agentMode || "").trim(),
      agentNotes: String(profile.agentNotes || "").trim(),
      bio: String(profile.bio || "").trim(),
      email: String(user.email || "").trim(),
      photoURL: String(profile.photoURL || "").trim(),
      profileComplete: Boolean(
        String(profile.displayName || "").trim() &&
        String(profile.companyName || "").trim() &&
        String(profile.website || "").trim() &&
        String(profile.productUrl || "").trim() &&
        String(profile.agentName || "").trim()
      ),
      updatedAt: nowIso(),
    };

    await db.collection(FIRESTORE_COLLECTION_PROFILES).doc(userId).set(normalized, { merge: true });
    await userRef.set(
      {
        displayName: normalized.displayName || user.displayName || "",
        updatedAt: nowIso(),
      },
      { merge: true }
    );

    return normalized;
  }

  const store = await readStore();
  const user = store.users[userId];
  if (!user) throw new Error("User not found.");

  const normalized = {
    displayName: String(profile.displayName || "").trim(),
    companyName: String(profile.companyName || "").trim(),
    companyStage: String(profile.companyStage || "").trim(),
    organization: String(profile.organization || "").trim(),
    role: String(profile.role || "").trim(),
    website: String(profile.website || "").trim(),
    productUrl: String(profile.productUrl || "").trim(),
    relevantUrls: String(profile.relevantUrls || "").trim(),
    agentName: String(profile.agentName || "").trim(),
    agentMode: String(profile.agentMode || "").trim(),
    agentNotes: String(profile.agentNotes || "").trim(),
    bio: String(profile.bio || "").trim(),
    email: user.email,
    photoURL: String(profile.photoURL || "").trim(),
    profileComplete: Boolean(
      String(profile.displayName || "").trim() &&
      String(profile.companyName || "").trim() &&
      String(profile.website || "").trim() &&
      String(profile.productUrl || "").trim() &&
      String(profile.agentName || "").trim()
    ),
    updatedAt: nowIso(),
  };

  store.profiles[userId] = normalized;
  user.displayName = normalized.displayName || user.displayName;
  user.updatedAt = nowIso();
  store.users[userId] = user;
  await writeStore(store);
  return normalized;
}

export async function saveAnalysisForUser(userId, report, execution) {
  const db = getFirestoreDb();
  if (db) {
    const entryRef = db
      .collection(FIRESTORE_COLLECTION_ANALYSES)
      .doc(userId)
      .collection("entries")
      .doc(String(report.id));

    const payload = {
      ...report,
      execution: execution || null,
      createdAt: nowIso(),
    };

    await entryRef.set(payload);

    const allEntriesSnap = await db
      .collection(FIRESTORE_COLLECTION_ANALYSES)
      .doc(userId)
      .collection("entries")
      .orderBy("analyzedAt", "desc")
      .get();

    if (allEntriesSnap.size > 24) {
      const overflow = allEntriesSnap.docs.slice(24);
      await Promise.all(overflow.map((doc) => doc.ref.delete()));
    }

    return payload;
  }

  const store = await readStore();
  const existing = store.analyses[userId] || [];
  const cleaned = existing.filter((item) => item.id !== report.id);
  const payload = {
    ...report,
    execution: execution || null,
    createdAt: nowIso(),
  };
  store.analyses[userId] = [payload, ...cleaned].slice(0, 24);
  await writeStore(store);
  return payload;
}

export async function listAnalysesForUser(userId, max = 12) {
  const db = getFirestoreDb();
  if (db) {
    const snapshot = await db
      .collection(FIRESTORE_COLLECTION_ANALYSES)
      .doc(userId)
      .collection("entries")
      .orderBy("analyzedAt", "desc")
      .limit(max)
      .get();

    return snapshot.docs.map((doc) => doc.data());
  }

  const store = await readStore();
  const entries = store.analyses[userId] || [];
  return entries
    .slice()
    .sort((a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime())
    .slice(0, max);
}

export async function signInWithGoogle({ googleId, email, displayName, photoURL }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !googleId) {
    throw new Error("Google ID and email are required for OAuth sign-in.");
  }

  const db = getFirestoreDb();
  if (db) {
    let user = await findFirestoreUserByEmail(db, normalizedEmail);

    if (!user) {
      const userId = crypto.randomUUID();
      user = {
        id: userId,
        email: normalizedEmail,
        displayName: String(displayName || "").trim() || normalizedEmail.split("@")[0],
        googleId,
        photoURL: String(photoURL || "").trim(),
        passwordHash: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      await db.collection(FIRESTORE_COLLECTION_USERS).doc(userId).set(user);
      await db.collection(FIRESTORE_COLLECTION_PROFILES).doc(userId).set(defaultProfile(user, { photoURL: user.photoURL }));
    } else {
      const nextUser = {
        ...user,
        googleId: user.googleId || googleId,
        photoURL: user.photoURL || String(photoURL || "").trim(),
        updatedAt: nowIso(),
      };
      await db.collection(FIRESTORE_COLLECTION_USERS).doc(user.id).set(nextUser, { merge: true });
      user = nextUser;
    }

    const token = createSessionToken(user.id);
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.collection(FIRESTORE_COLLECTION_SESSIONS).doc(tokenHash).set({
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
      createdAt: nowIso(),
    });

    return {
      token,
      user: publicUser(user),
    };
  }

  const store = await readStore();
  
  // Try to find existing user by email
  let user = Object.values(store.users).find((u) => u.email === normalizedEmail);
  
  if (!user) {
    // Create new user from Google credentials
    const userId = crypto.randomUUID();
    user = {
      id: userId,
      email: normalizedEmail,
      displayName: String(displayName || "").trim() || normalizedEmail.split("@")[0],
      googleId,
      photoURL: String(photoURL || "").trim(),
      // Google OAuth users don't have password hash
      passwordHash: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    
    store.users[userId] = user;
    store.profiles[userId] = {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      companyName: "",
      companyStage: "",
      organization: "",
      role: "",
      website: "",
      productUrl: "",
      relevantUrls: "",
      agentName: "",
      agentMode: "",
      agentNotes: "",
      bio: "",
      profileComplete: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  } else {
    // Update existing user with Google ID if not already linked
    if (!user.googleId) {
      user.googleId = googleId;
      user.updatedAt = nowIso();
    }
    // Update photo if provided
    if (photoURL && !user.photoURL) {
      user.photoURL = String(photoURL).trim();
    }
    store.users[user.id] = user;
  }
  
  await writeStore(store);
  
  // Create session token
  const token = createSessionToken(user.id);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  store.sessions[tokenHash] = {
    userId: user.id,
    expiresAt: Date.now() + SESSION_TTL_MS,
    createdAt: nowIso(),
  };
  cleanExpiredSessions(store);
  await writeStore(store);
  
  return {
    token,
    user: publicUser(user),
  };
}
