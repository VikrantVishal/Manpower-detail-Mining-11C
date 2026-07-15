// ============================================================
// firebase-config.js
// Shared Firebase init + constants + helpers for the
// Deposit-11C Mine Attendance Management System
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAJyGv7HABWuW7pd3TgXIOhwCALbQBijYg",
  authDomain: "mine-attendance-system.firebaseapp.com",
  projectId: "mine-attendance-system",
  storageBucket: "mine-attendance-system.firebasestorage.app",
  messagingSenderId: "1042371303076",
  appId: "1:1042371303076:web:b0cd32f2edf17c4b37f831"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Offline persistence — lets the app keep working with spotty mine-site
// connectivity and sync automatically once back online.
try {
  enableIndexedDbPersistence(db).catch(() => {
    // Fails silently in multi-tab situations or unsupported browsers;
    // app still works online-only in that case.
  });
} catch (e) {
  /* no-op */
}

export {
  db,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, writeBatch, serverTimestamp
};

// ------------------------------------------------------------
// Constants shared across pages
// ------------------------------------------------------------

export const DUTY_CHART_URL =
  "https://dl.dropboxusercontent.com/scl/fi/ptpv93vsf2p99zuhz5ygh/DUTY-CHART.xlsx?rlkey=lwbwu01l3837c7191fqp992ks&st=6hcwp5gy&dl=1";

export const SHIFTS = {
  first:  { key: "first",  label: "1st Shift",   start: "05:30", end: "13:30", code: "1" },
  second: { key: "second", label: "2nd Shift",    start: "13:30", end: "21:30", code: "2" },
  night:  { key: "night",  label: "Night Shift",  start: "21:30", end: "05:30", code: "N", spansMidnight: true }
};

export const OTHER_STATUS_OPTIONS = [
  "Absent (Mutual)",
  "Personal Leave",
  "Medical Leave",
  "Official Tour",
  "PME",
  "Meeting",
  "Official Work",
  "Training",
  "Others",
  "Public Holiday",
  "General Shift"
];

// Statuses that make an employee "unavailable" in Section 1 / disable buttons
export const AWAY_STATUSES = [
  "Personal Leave",
  "Medical Leave",
  "Official Tour",
  "PME",
  "Meeting",
  "Official Work",
  "Training",
  "Others"
];

export const STATUS_COLORS = {
  "Present": "#3ddc84",
  "Absent": "#ff5470",
  "Present (Mutual)": "#3ddc84",
  "Absent (Mutual)": "#eaa0a0",
  "Personal Leave": "#a685e2",
  "Medical Leave": "#e29bd8",
  "Official Tour": "#5aa9e6",
  "PME": "#f5c563",
  "Meeting": "#7fd8be",
  "Official Work": "#5aa9e6",
  "Training": "#7fd8be",
  "Others": "#9aa5b1",
  "Public Holiday": "#ea59c6",
  "OT": "#e6851e",
  "General Shift":"#baef33",
  "Present in OT": "#d2664b"
};

// ------------------------------------------------------------
// Standard group display order — used consistently across every
// dropdown, attendance page, summary, and report in the app.
// Any group not in this list is appended alphabetically after it.
// ------------------------------------------------------------
export const GROUP_ORDER = [
  "EXECUTIVE", "SHOVEL", "DUMPER", "DRILL", "DOZER", "DRIVER", "HELPER", "RS-04", "BIT"
];

export function groupSortIndex(g) {
  const norm = String(g ?? "").trim().toUpperCase();
  const idx = GROUP_ORDER.indexOf(norm);
  return idx === -1 ? GROUP_ORDER.length : idx;
}

// Sorts an array of group name strings into the standard order,
// falling back to alphabetical for anything not in GROUP_ORDER.
export function sortGroups(groupNames) {
  return [...groupNames].sort((a, b) => {
    const ia = groupSortIndex(a), ib = groupSortIndex(b);
    if (ia !== ib) return ia - ib;
    return String(a).localeCompare(String(b));
  });
}

// ------------------------------------------------------------
// Date / time helpers
// ------------------------------------------------------------

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Is the given shift on the given date allowed to be marked yet?
// (current or past shifts only — future shifts of today, and any future date, are blocked)
export function isShiftSelectable(dateStr, shiftKey) {
  const today = todayStr();
  if (dateStr > today) return false;
  if (dateStr < today) return true;
  // dateStr === today: only allow if the shift's reporting time has passed
  const shift = SHIFTS[shiftKey];
  return nowHM() >= shift.start;
}

export function formatDateLong(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-IN", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

export function attendanceDocId(dateStr, shiftKey) {
  return `${dateStr}_${shiftKey}`;
}

// Given a duration range (fromDate,toDate inclusive) and a single check date,
// tells whether check date falls in range.
export function dateInRange(checkDate, fromDate, toDate) {
  return checkDate >= fromDate && checkDate <= toDate;
}

// ------------------------------------------------------------
// Duty Chart Excel fetch + parse (SheetJS)
// Uses the same CORS-fallback chain proven out in ot-turn-viewer.html
// ------------------------------------------------------------

export async function fetchDutyChartWorkbook(url = DUTY_CHART_URL) {
  const attempts = [
    () => fetch(url, { cache: "no-store" }),
    () => fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, { cache: "no-store" }),
    () => fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { cache: "no-store" })
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      // cellDates:false + manual serial handling avoids the IST/UTC
      // fractional-day date bug seen in ot-turn-viewer.html
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      return wb;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("Could not fetch Duty Chart workbook: " + (lastErr ? lastErr.message : "unknown error"));
}

// Convert an Excel serial date number (IST-safe: floor before converting)
// to a YYYY-MM-DD string.
export function excelSerialToDateStr(serial) {
  const wholeDay = Math.floor(Number(serial));
  const utcDays = wholeDay - 25569; // Excel epoch -> Unix epoch offset
  const utcMs = utcDays * 86400000;
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Escape helper for building safe HTML strings from data.
export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ------------------------------------------------------------
// Duty Chart column mapping (persisted in localStorage so it only
// needs to be configured once per browser, like the other portal apps)
// ------------------------------------------------------------

const MAPPING_KEY = "dutyChartMapping_v1";

export const DEFAULT_SHIFT_CODES = {
  first: ["1", "I", "A"],
  second: ["2", "II", "B"],
  night: ["3", "N", "NS", "III", "C"]
};

export function getDutyChartMapping() {
  try {
    const raw = localStorage.getItem(MAPPING_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return {
    sheetName: null,
    headerRow: 1,
    idCol: null,
    nameCol: null,
    groupCol: null,
    dateColStart: null,
    dateColEnd: null,
    shiftCodes: JSON.parse(JSON.stringify(DEFAULT_SHIFT_CODES))
  };
}

export function saveDutyChartMapping(mapping) {
  localStorage.setItem(MAPPING_KEY, JSON.stringify(mapping));
}

// Try to detect if a header cell represents a date, returning YYYY-MM-DD or null.
export function parseHeaderAsDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (value > 30000 && value < 80000) return excelSerialToDateStr(value);
    return null;
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  return null;
}

// Auto-detect date columns across a header row, scanning from startCol.
export function autoDetectDateColumns(headerRowArr, startCol = 0) {
  const map = {};
  for (let c = startCol; c < headerRowArr.length; c++) {
    const ds = parseHeaderAsDate(headerRowArr[c]);
    if (ds) map[c] = ds;
  }
  return map;
}

export function findDateColumn(dateColMap, dateStr) {
  for (const [col, ds] of Object.entries(dateColMap)) {
    if (ds === dateStr) return parseInt(col, 10);
  }
  return -1;
}

export function classifyShiftCode(code, shiftCodes) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (!c) return null;
  
  // Explicitly catch common Rest Day markers used in your Mine Duty charts
  if (["R", "REST", "OFF", "HO"].includes(c)) return "rest";

  for (const key of ["first", "second", "night"]) {
    const list = shiftCodes[key] || [];
    if (list.some(x => String(x).toUpperCase() === c)) return key;
  }
  return "other";
}
