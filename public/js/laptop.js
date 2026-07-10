function humanBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

async function refreshStats() {
  try {
    const stats = await fetch("/api/stats").then((r) => r.json());
    document.getElementById("statMedia").textContent = stats.mediaCount ?? 0;
    document.getElementById("statFiles").textContent = stats.fileCount ?? 0;
    document.getElementById("statContacts").textContent =
      stats.contactsCount ?? 0;
    document.getElementById("statSize").textContent = humanBytes(
      stats.totalBytes,
    );
    document.getElementById("statLast").textContent = `Last backup: ${timeAgo(
      stats.lastBackupAt,
    )}`;
    document.getElementById("statDir").textContent = `💾 ${stats.backupDir}`;
  } catch {
    document.getElementById("statusPill").textContent = "● offline";
    document.getElementById("statusPill").classList.remove("live");
  }
}

async function refreshGallery() {
  try {
    const { photos } = await fetch("/api/photos").then((r) => r.json());
    const gallery = document.getElementById("gallery");
    const empty = document.getElementById("galleryEmpty");
    empty.style.display = photos.length ? "none" : "block";
    document.getElementById("downloadAll").style.display = photos.length
      ? ""
      : "none";
    gallery.innerHTML = photos
      .slice(0, 60)
      .map((p) => {
        const src = `/photos/${encodeURIComponent(p.storedName)}`;
        if (p.kind === "video") {
          return `<a href="${src}" target="_blank" title="${escapeHtml(p.originalName)}">
                    <video src="${src}" muted preload="metadata"></video>
                  </a>`;
        }
        return `<a href="${src}" target="_blank" title="${escapeHtml(p.originalName)}">
                  <img loading="lazy" src="${src}" alt="${escapeHtml(p.originalName)}" />
                </a>`;
      })
      .join("");
  } catch {
    /* ignore */
  }
}

async function refreshFiles() {
  try {
    const { files } = await fetch("/api/files").then((r) => r.json());
    const list = document.getElementById("filesList");
    document.getElementById("filesEmpty").style.display = files.length
      ? "none"
      : "block";
    list.innerHTML = files
      .map(
        (f) =>
          `<div class="list-row">
             <span class="list-main">📄 <a class="link" href="/photos/${encodeURIComponent(
               f.storedName,
             )}" target="_blank">${escapeHtml(f.originalName)}</a></span>
             <span class="list-sub">${humanBytes(f.size)}</span>
           </div>`,
      )
      .join("");
  } catch {
    /* ignore */
  }
}

async function refreshContacts() {
  try {
    const { contacts } = await fetch("/api/contacts").then((r) => r.json());
    const list = document.getElementById("contactsList");
    document.getElementById("contactsEmpty").style.display = contacts.length
      ? "none"
      : "block";
    document.getElementById("downloadVcf").style.display = contacts.length
      ? ""
      : "none";
    list.innerHTML = contacts
      .map((c) => {
        const detail = [...(c.tels || []), ...(c.emails || [])].join(" · ");
        return `<div class="list-row">
                  <span class="list-main">👤 ${escapeHtml(c.name || "Unknown")}</span>
                  <span class="list-sub">${escapeHtml(detail)}</span>
                </div>`;
      })
      .join("");
  } catch {
    /* ignore */
  }
}

async function refreshDevices() {
  try {
    const { devices } = await fetch("/api/devices").then((r) => r.json());
    const list = document.getElementById("devicesList");
    document.getElementById("devicesEmpty").style.display = devices.length
      ? "none"
      : "block";
    list.innerHTML = devices
      .map((d) => {
        const parts = [];
        if (d.mediaCount) parts.push(`${d.mediaCount} photos/videos`);
        if (d.fileCount) parts.push(`${d.fileCount} files`);
        if (d.contactsCount) parts.push(`${d.contactsCount} contacts`);
        const summary = parts.length ? parts.join(" · ") : "no items yet";
        return `<div class="list-row">
                  <span class="list-main">📱 ${escapeHtml(d.name)}</span>
                  <span class="list-sub">${summary} · seen ${timeAgo(d.lastSeen)}</span>
                </div>`;
      })
      .join("");
  } catch {
    /* ignore */
  }
}

async function setupConnect() {
  try {
    const info = await fetch("/api/server-info").then((r) => r.json());
    const addr = info.addresses[0] || "localhost";
    const url = `http://${addr}:${info.port}/phone.html`;
    document.getElementById("phoneUrl").textContent = url;
  } catch {
    document.getElementById("phoneUrl").textContent = "server unavailable";
  }
}

function refreshAll() {
  refreshStats();
  refreshDevices();
  refreshGallery();
  refreshFiles();
  refreshContacts();
}

setupConnect();
refreshAll();
setInterval(refreshAll, 3000);
