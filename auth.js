// ============================================================
// auth.js
// Login / session / user-management helpers for the
// Deposit-11C Mine Attendance Management System
// ============================================================

import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc
} from "./firebase-config.js";

const SESSION_KEY = "d11c_session_v1";

// ------------------------------------------------------------
// Inactivity auto-logout
// ------------------------------------------------------------
const LAST_ACTIVE_KEY = "d11c_lastActive_v1";
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000; // 10 minutes
let inactivityCheckId = null;
let inactivityWatcherStarted = false;

// Bootstrap administrator — always works even before the "users"
// collection has been seeded in Firestore. On first successful login
// this account is also written to Firestore so it shows up in the
// Password Manager like any other user.
const BOOTSTRAP_ADMIN = { username: "VIKRANT", password: "140795", displayName: "Vikrant Vishal" };

// ------------------------------------------------------------
// Hashing (client-side SHA-256 — this is an internal site tool,
// not a public-facing login, so this lightweight approach is used
// instead of a full auth backend).
// ------------------------------------------------------------
export async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------
// Session (stored in sessionStorage — deliberately NOT localStorage —
// so it survives navigation between the portal's own pages but is
// automatically wiped by the browser the moment the tab/window is
// closed. Important on the shared site PC.)
// ------------------------------------------------------------
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setSession(s) { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LAST_ACTIVE_KEY);
  stopInactivityWatcher();
}

// Records "now" as the last-activity moment (per-tab, alongside the session).
function touchActivity() {
  try { sessionStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch (e) { /* ignore */ }
}

function getLastActive() {
  const raw = sessionStorage.getItem(LAST_ACTIVE_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

// Starts listening for user activity and periodically checks whether the
// inactivity limit has been exceeded, logging out automatically if so.
// Safe to call multiple times — only sets up once per page load.
function startInactivityWatcher() {
  if (inactivityWatcherStarted) return;
  inactivityWatcherStarted = true;

  touchActivity();

  const activityEvents = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click"];
  activityEvents.forEach(evt => {
    window.addEventListener(evt, touchActivity, { passive: true });
  });

  inactivityCheckId = setInterval(() => {
    if (!getSession()) { stopInactivityWatcher(); return; }
    const idleFor = Date.now() - getLastActive();
    if (idleFor >= INACTIVITY_LIMIT_MS) {
      stopInactivityWatcher();
      clearSession();
      const here = window.location.pathname.split('/').pop() || 'index.html';
      window.location.href = `login.html?redirect=${encodeURIComponent(here)}&reason=timeout`;
    }
  }, 15000); // check every 15s — frequent enough to feel accurate, cheap enough to ignore
}

function stopInactivityWatcher() {
  inactivityWatcherStarted = false;
  if (inactivityCheckId) {
    clearInterval(inactivityCheckId);
    inactivityCheckId = null;
  }
}

// Call at the top of every protected page. Redirects to login.html
// (preserving the current page so the user returns here after login)
// if nobody is signed in. Returns the session object otherwise.
export function requireAuth() {
  const s = getSession();
  if (!s) {
    const here = window.location.pathname.split('/').pop() || 'index.html';
    window.location.href = `login.html?redirect=${encodeURIComponent(here)}`;
    return null;
  }
  startInactivityWatcher();
  return s;
}

export function isAdmin() {
  const s = getSession();
  return !!(s && s.role === "admin");
}

// Blocks a page for non-administrators, replacing the body with an
// explanatory message. Returns true if access was blocked.
export function requireAdmin() {
  if (isAdmin()) return false;
  document.body.innerHTML = `
    <div class="page" style="max-width:520px; margin:60px auto;">
      <div class="card" style="text-align:center;">
        <h2 style="color:var(--red);">🔒 Access Restricted</h2>
        <p style="color:var(--text-mid);">Kindly log in as an administrator to access this section.</p>
        <a class="btn-outline" href="index.html" style="display:inline-block; margin-top:14px;">← Back to Home</a>
      </div>
    </div>`;
  return true;
}

// ------------------------------------------------------------
// Login / logout
// ------------------------------------------------------------
export async function login(username, password) {
  const uname = String(username || "").trim().toUpperCase();
  if (!uname || !password) throw new Error("Enter both username and password.");

  if (uname === BOOTSTRAP_ADMIN.username && password === BOOTSTRAP_ADMIN.password) {
    const session = { username: uname, displayName: BOOTSTRAP_ADMIN.displayName, role: "admin" };
    setSession(session);
    // Seed/refresh this account in Firestore (non-blocking on failure)
    try {
      const passwordHash = await sha256Hex(password);
      await setDoc(doc(db, "users", uname), {
        username: uname, displayName: BOOTSTRAP_ADMIN.displayName, role: "admin", passwordHash
      }, { merge: true });
    } catch (e) { /* offline is fine — bootstrap login still works */ }
    startInactivityWatcher();
    return session;
  }

  const snap = await getDoc(doc(db, "users", uname));
  if (!snap.exists()) throw new Error("Invalid username or password.");
  const data = snap.data();
  const passwordHash = await sha256Hex(password);
  if (data.passwordHash !== passwordHash) throw new Error("Invalid username or password.");

  const session = { username: uname, displayName: data.displayName || uname, role: data.role === "admin" ? "admin" : "user" };
  setSession(session);
  startInactivityWatcher();
  return session;
}

export function logout() {
  clearSession();
  window.location.href = "login.html";
}

// Renders a small "Signed in as X · Logout" badge into the given
// container element id. Call on every protected page's header.
export function renderUserBadge(containerId) {
  const s = getSession();
  const host = document.getElementById(containerId);
  if (!host || !s) return;
  host.innerHTML = `
    <span class="user-badge-name">${s.displayName}${s.role === 'admin' ? ' <span class="admin-tag">ADM</span>' : ''}</span>
    <button class="btn-outline btn-sm" id="logoutBtn" type="button">Logout</button>
  `;
  const btn = document.getElementById('logoutBtn');
  if (btn) btn.addEventListener('click', logout);
}

// ------------------------------------------------------------
// User management (admin only — Password Manager)
// ------------------------------------------------------------
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  const list = [];
  snap.forEach(d => list.push({ username: d.id, ...d.data() }));
  return list.sort((a, b) => a.username.localeCompare(b.username));
}

export async function saveUser({ username, displayName, role, password }) {
  const uname = String(username || "").trim().toUpperCase();
  if (!uname) throw new Error("Username is required.");
  if (!/^[A-Z0-9_.]+$/.test(uname)) throw new Error("Username may only contain letters, numbers, underscore, and dot.");
  const payload = {
    username: uname,
    displayName: (displayName || uname).trim(),
    role: role === "admin" ? "admin" : "user"
  };
  if (password) {
    if (password.length < 4) throw new Error("Password must be at least 4 characters.");
    payload.passwordHash = await sha256Hex(password);
  } else {
    // New user with no password supplied is not allowed
    const existing = await getDoc(doc(db, "users", uname));
    if (!existing.exists()) throw new Error("A password is required for a new user.");
  }
  await setDoc(doc(db, "users", uname), payload, { merge: true });
  return uname;
}

export async function deleteUser(username) {
  const uname = String(username || "").trim().toUpperCase();
  if (uname === BOOTSTRAP_ADMIN.username) throw new Error("The built-in administrator account cannot be deleted.");
  await deleteDoc(doc(db, "users", uname));
}