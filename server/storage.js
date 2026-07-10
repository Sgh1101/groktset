import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Storage layer for the photo backup server.
 *
 * Photos are saved directly onto the machine running this server (the "laptop").
 * A JSON manifest tracks the SHA-256 content hash of every stored photo so that
 * re-running a backup only transfers photos that are not already present
 * (incremental / deduplicated backup).
 */

const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || "./backups");
const PHOTOS_DIR = path.join(BACKUP_DIR, "photos");
const MANIFEST_PATH = path.join(BACKUP_DIR, "manifest.json");
const TMP_DIR = path.join(BACKUP_DIR, ".tmp");

/** @type {Map<string, object>} hash -> record */
let manifest = new Map();

export function getBackupDir() {
  return BACKUP_DIR;
}

export function getPhotosDir() {
  return PHOTOS_DIR;
}

export async function init() {
  await fsp.mkdir(PHOTOS_DIR, { recursive: true });
  await fsp.mkdir(TMP_DIR, { recursive: true });
  await loadManifest();
}

async function loadManifest() {
  try {
    const raw = await fsp.readFile(MANIFEST_PATH, "utf8");
    const records = JSON.parse(raw);
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
    .basename(name || "photo")
    .replace(/[^\w.-]+/g, "_")
    .slice(-120);
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
 * Deduplicates by content hash so already-backed-up photos are never duplicated.
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
  const record = {
    id: hash.slice(0, 16),
    hash,
    originalName: originalName || safeName,
    storedName,
    size: stat.size,
    type: mimeType || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  };
  manifest.set(hash, record);
  await persistManifest();
  return { status: "stored", record };
}

export function listPhotos() {
  return [...manifest.values()].sort((a, b) =>
    b.uploadedAt.localeCompare(a.uploadedAt),
  );
}

export function getRecordById(id) {
  for (const record of manifest.values()) {
    if (record.id === id) return record;
  }
  return null;
}

export function getStats() {
  const records = [...manifest.values()];
  const totalBytes = records.reduce((sum, r) => sum + (r.size || 0), 0);
  const lastBackupAt =
    records.length > 0
      ? records
          .map((r) => r.uploadedAt)
          .sort()
          .at(-1)
      : null;
  return {
    count: records.length,
    totalBytes,
    lastBackupAt,
    backupDir: BACKUP_DIR,
  };
}
