import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Storage layer for the backup server.
 *
 * Files (photos, videos, documents) and contacts chosen by the phone owner are
 * saved directly onto the machine running this server (the "laptop"). A JSON
 * manifest tracks the SHA-256 content hash of every stored file so re-running a
 * backup only transfers items that are not already present (incremental /
 * deduplicated backup). Contacts are deduplicated by their normalized content.
 */

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "./backups");
const PHOTOS_DIR = path.join(BACKUP_DIR, "photos");
const CONTACTS_DIR = path.join(BACKUP_DIR, "contacts");
const CONTACTS_JSON = path.join(CONTACTS_DIR, "contacts.json");
const CONTACTS_VCF = path.join(CONTACTS_DIR, "contacts.vcf");
const MANIFEST_PATH = path.join(BACKUP_DIR, "manifest.json");
const TMP_DIR = path.join(BACKUP_DIR, ".tmp");

/** @type {Map<string, object>} hash -> file record */
let manifest = new Map();
/** @type {Map<string, object>} signature -> contact record */
let contacts = new Map();

export function getBackupDir() {
  return BACKUP_DIR;
}

export function getPhotosDir() {
  return PHOTOS_DIR;
}

export function getContactsVcfPath() {
  return CONTACTS_VCF;
}

export async function init() {
  await fsp.mkdir(PHOTOS_DIR, { recursive: true });
  await fsp.mkdir(CONTACTS_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await loadManifest();
  await loadContacts();
}

async function loadManifest() {
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, "utf8");
    const records = JSON.parse(raw);
    // Backfill `kind` for records stored before it was tracked.
    for (const r of records) {
      if (!r.kind) r.kind = classify(r.type);
    }
    manifest = new Map(records.map((r) => [r.hash, r]));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Failed to read manifest, starting fresh:", err.message);
    }
    manifest = new Map();
  }
}

async function persistManifest() {
  const records = [...manifest.values()];
  const tmp = `${MANIFEST_PATH}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(records, null, 2));
  await fsp.rename(tmp, MANIFEST_PATH);
}

export function hasHash(hash) {
  return manifest.has(hash);
}

export function getKnownHashes() {
  return [...manifest.keys()];
}

function sanitize(name) {
  return path
    .basename(name || "file")
    .replace(/[^\w.-]+/g, "_")
    .slice(-120);
}

function classify(mime) {
  if (mime?.startsWith("image/")) return "photo";
  if (mime?.startsWith("video/")) return "video";
  return "file";
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Ingest an uploaded temp file. Returns { status: "stored" | "skipped", record }.
 * Deduplicates by content hash so already-backed-up files are never duplicated.
 */
export async function ingest({ tmpPath, originalName, mimeType }) {
  const hash = await hashFile(tmpPath);

  if (manifest.has(hash)) {
    await fsp.rm(tmpPath, { force: true });
    return { status: "skipped", record: manifest.get(hash) };
  }

  const safeName = sanitize(originalName);
  const storedName = `${hash.slice(0, 16)}__${safeName}`;
  const destPath = path.join(PHOTOS_DIR, storedName);
  await fsp.rename(tmpPath, destPath);

  const stat = await fsp.stat(destPath);
  const type = mimeType || "application/octet-stream";
  const record = {
    id: hash.slice(0, 16),
    hash,
    originalName: originalName || safeName,
    storedName,
    size: stat.size,
    type,
    kind: classify(type),
    uploadedAt: new Date().toISOString(),
  };
  manifest.set(hash, record);
  await persistManifest();
  return { status: "stored", record };
}

function byNewest(a, b) {
  return b.uploadedAt.localeCompare(a.uploadedAt);
}

export function listAll() {
  return [...manifest.values()].sort(byNewest);
}

export function listMedia() {
  return listAll().filter((r) => r.kind === "photo" || r.kind === "video");
}

export function listFiles() {
  return listAll().filter((r) => r.kind === "file");
}

export function getRecordById(id) {
  for (const record of manifest.values()) {
    if (record.id === id) return record;
  }
  return null;
}

/* ---------------------------------------------------------------- contacts */

function normalizeContact(raw) {
  const name = Array.isArray(raw.name)
    ? raw.name.filter(Boolean).join(" ")
    : raw.name || "";
  const tels = (raw.tel || raw.tels || []).map((t) => String(t).trim()).filter(Boolean);
  const emails = (raw.email || raw.emails || [])
    .map((e) => String(e).trim())
    .filter(Boolean);
  return { name: name.trim(), tels, emails };
}

function contactSignature(c) {
  const key = JSON.stringify([
    c.name.toLowerCase(),
    [...c.tels].sort(),
    [...c.emails].map((e) => e.toLowerCase()).sort(),
  ]);
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 24);
}

function vcardEscape(v) {
  return String(v).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function toVcf(list) {
  return list
    .map((c) => {
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${vcardEscape(c.name || "Unknown")}`];
      for (const tel of c.tels) lines.push(`TEL:${vcardEscape(tel)}`);
      for (const email of c.emails) lines.push(`EMAIL:${vcardEscape(email)}`);
      lines.push("END:VCARD");
      return lines.join("\r\n");
    })
    .join("\r\n");
}

async function loadContacts() {
  try {
    const raw = await fsp.readFile(CONTACTS_JSON, "utf8");
    const records = JSON.parse(raw);
    contacts = new Map(records.map((r) => [r.signature, r]));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("Failed to read contacts, starting fresh:", err.message);
    }
    contacts = new Map();
  }
}

async function persistContacts() {
  const records = [...contacts.values()].sort(byNewest);
  const tmp = `${CONTACTS_JSON}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(records, null, 2));
  await fsp.rename(tmp, CONTACTS_JSON);
  await fsp.writeFile(CONTACTS_VCF, toVcf(records));
}

/**
 * Add contacts the phone owner explicitly selected. Deduplicated by content.
 * Returns { added, skipped }.
 */
export async function addContacts(items) {
  let added = 0;
  let skipped = 0;
  for (const raw of items || []) {
    const c = normalizeContact(raw);
    if (!c.name && c.tels.length === 0 && c.emails.length === 0) continue;
    const signature = contactSignature(c);
    if (contacts.has(signature)) {
      skipped++;
      continue;
    }
    contacts.set(signature, {
      ...c,
      signature,
      uploadedAt: new Date().toISOString(),
    });
    added++;
  }
  if (added > 0) await persistContacts();
  return { added, skipped };
}

export function listContacts() {
  return [...contacts.values()].sort(byNewest);
}

/* ------------------------------------------------------------------- stats */

export function getStats() {
  const records = [...manifest.values()];
  const totalBytes = records.reduce((sum, r) => sum + (r.size || 0), 0);
  const mediaCount = records.filter(
    (r) => r.kind === "photo" || r.kind === "video",
  ).length;
  const fileCount = records.filter((r) => r.kind === "file").length;
  const allDates = [
    ...records.map((r) => r.uploadedAt),
    ...[...contacts.values()].map((c) => c.uploadedAt),
  ];
  const lastBackupAt = allDates.length ? allDates.sort().at(-1) : null;
  return {
    count: records.length,
    mediaCount,
    fileCount,
    contactsCount: contacts.size,
    totalBytes,
    lastBackupAt,
    backupDir: BACKUP_DIR,
  };
}
