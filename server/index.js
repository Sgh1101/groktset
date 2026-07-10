import express from "express";
import multer from "multer";
import archiver from "archiver";
import QRCode from "qrcode";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import * as storage from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "0.0.0.0";

await storage.init();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) =>
      cb(null, path.join(storage.getBackupDir(), ".tmp")),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per photo/video
});

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUBLIC_DIR));

// Serve stored photos for the gallery / preview.
app.use(
  "/photos",
  express.static(storage.getPhotosDir(), {
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=86400"),
  }),
);

// Which local IP addresses the phone can use to reach this laptop.
function localAddresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addrs.push(net.address);
      }
    }
  }
  return addrs;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/server-info", (req, res) => {
  res.json({
    hostname: os.hostname(),
    addresses: localAddresses(),
    port: PORT,
  });
});

// Locally-generated QR code pointing the phone at this laptop (no external CDN).
app.get("/api/qr", async (req, res) => {
  const addr = localAddresses()[0] || "localhost";
  const url = `http://${addr}:${PORT}/phone.html`;
  try {
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 176 });
    res.setHeader("Content-Type", "image/svg+xml");
    res.send(svg);
  } catch {
    res.status(500).json({ error: "failed to generate qr" });
  }
});

app.get("/api/stats", (req, res) => {
  res.json(storage.getStats());
});

app.get("/api/photos", (req, res) => {
  res.json({ photos: storage.listMedia() });
});

app.get("/api/files", (req, res) => {
  res.json({ files: storage.listFiles() });
});

// Contacts the phone owner explicitly picked and sent over.
app.get("/api/contacts", (req, res) => {
  res.json({ contacts: storage.listContacts() });
});

app.post("/api/contacts", async (req, res) => {
  const items = Array.isArray(req.body?.contacts) ? req.body.contacts : null;
  if (!items) {
    return res.status(400).json({ error: "expected { contacts: [...] }" });
  }
  try {
    const result = await storage.addContacts(items);
    res.json(result);
  } catch (err) {
    console.error("Failed to save contacts:", err);
    res.status(500).json({ error: "failed to save contacts" });
  }
});

app.get("/api/contacts.vcf", (req, res) => {
  if (storage.listContacts().length === 0) {
    return res.status(404).json({ error: "no contacts backed up yet" });
  }
  res.setHeader("Content-Type", "text/vcard; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contacts.vcf"');
  res.sendFile(storage.getContactsVcfPath());
});

// The phone fetches known hashes so it can skip already-backed-up photos.
app.get("/api/manifest", (req, res) => {
  res.json({ hashes: storage.getKnownHashes() });
});

// Lightweight existence check for a single hash (used before uploading).
app.get("/api/exists/:hash", (req, res) => {
  res.json({ exists: storage.hasHash(req.params.hash) });
});

app.post("/api/upload", upload.single("photo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "no file provided (field 'photo')" });
  }
  try {
    const result = await storage.ingest({
      tmpPath: req.file.path,
      originalName: req.body.name || req.file.originalname,
      mimeType: req.body.type || req.file.mimetype,
    });
    res.json(result);
  } catch (err) {
    console.error("Upload failed:", err);
    try {
      fs.rmSync(req.file.path, { force: true });
    } catch {
      /* ignore cleanup errors */
    }
    res.status(500).json({ error: "failed to store photo" });
  }
});

// Download every backed-up photo as a single zip.
app.get("/api/download-all", (req, res) => {
  const photos = storage.listAll();
  if (photos.length === 0) {
    return res.status(404).json({ error: "no files backed up yet" });
  }
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="photo-backup-${Date.now()}.zip"`,
  );
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => {
    console.error("Archive error:", err);
    res.status(500).end();
  });
  archive.pipe(res);
  for (const p of photos) {
    archive.file(path.join(storage.getPhotosDir(), p.storedName), {
      name: p.originalName,
    });
  }
  archive.finalize();
});

app.listen(PORT, HOST, () => {
  const addrs = localAddresses();
  console.log(`\n  Photo backup server running`);
  console.log(`  Laptop dashboard:  http://localhost:${PORT}`);
  for (const addr of addrs) {
    console.log(`  Phone uploader:    http://${addr}:${PORT}/phone.html`);
  }
  console.log(`  Saving photos to:  ${storage.getBackupDir()}\n`);
});
