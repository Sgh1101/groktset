# groktset — PhotoBackup

Background photo backup: a phone opens the app over the local network and its
photos are uploaded and saved **directly to the machine running the server**
(the "laptop"). Backups are incremental and deduplicated by SHA-256 content
hash, so re-running only transfers new photos.

## Layout

- `server/` — Node/Express server (`index.js` routes, `storage.js` disk + manifest).
- `public/` — static frontend, **no build step**: `index.html`/`js/laptop.js`
  (laptop dashboard), `phone.html`/`js/phone.js` (mobile uploader), `sw.js` +
  `manifest.webmanifest` (installable PWA shell).
- `scripts/make_test_photos.py` — generates valid PNGs for manual testing.

## Commands

Standard scripts live in `package.json`:

- `npm run dev` — dev server via nodemon on port `4000` (dashboard at
  `http://localhost:4000`, phone uploader at `/phone.html`).
- `npm start` — production start (plain `node`).
- `npm run lint` — ESLint (flat config in `eslint.config.js`).
- `npm test` — `node --test` (no test files exist yet).

## Cursor Cloud specific instructions

- Run the server with `npm run dev` (port `4000`). The phone/laptop distinction
  is only conceptual — in this VM, browse both `/` and `/phone.html` on
  `localhost:4000`. Manual GUI testing works via Chrome on `localhost`.
- Uploaded photos are written to `BACKUP_DIR` (default `./backups/`, git-ignored)
  and tracked in `backups/manifest.json`. Override with `BACKUP_DIR` / `PORT`.
- The dedup manifest is loaded into memory **once at startup**. If you edit files
  under `backups/` by hand, restart the server (type `rs` in the nodemon
  terminal) so it reloads. To fully reset state, delete the whole `backups/`
  directory and restart — deleting only the photo files leaves stale manifest
  entries that resurface on the next startup.
- `nodemon` watches `server/` only; edits under `public/` are served immediately
  (static) and do **not** need a restart.
- The QR code is generated server-side at `/api/qr` (no external CDN), so it
  works with no internet egress.
- Client-side hashing (used to skip re-uploading photos before sending bytes)
  needs a secure context — it runs on `localhost`/HTTPS but not over plain HTTP
  to a LAN IP. In that fallback case the client just uploads and the server still
  deduplicates by hash, so backups stay correct (only bytes are re-sent).
- Real always-on background backup while the phone is **locked** requires a
  native mobile app; this web app backs up whenever the uploader page is open
  and the screen is awake (it requests a Screen Wake Lock).
