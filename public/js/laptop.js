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

async function refreshStats() {
  try {
    const stats = await fetch("/api/stats").then((r) => r.json());
    document.getElementById("statCount").textContent = stats.count;
    document.getElementById("statSize").textContent = humanBytes(
      stats.totalBytes,
    );
    document.getElementById("statLast").textContent = timeAgo(
      stats.lastBackupAt,
    );
    document.getElementById("statDir").textContent = stats.backupDir;
    document.getElementById("downloadAll").style.display =
      stats.count > 0 ? "" : "none";
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
    gallery.innerHTML = photos
      .slice(0, 60)
      .map(
        (p) =>
          `<a href="/photos/${encodeURIComponent(p.storedName)}" target="_blank" title="${p.originalName}">
             <img loading="lazy" src="/photos/${encodeURIComponent(p.storedName)}" alt="${p.originalName}" />
           </a>`,
      )
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

setupConnect();
refreshStats();
refreshGallery();
setInterval(() => {
  refreshStats();
  refreshGallery();
}, 3000);
