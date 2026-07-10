const DONE_KEY = "pb_done_signatures";
const CONCURRENCY = 3;

const els = {
  picker: document.getElementById("picker"),
  keepAwake: document.getElementById("keepAwake"),
  progressCard: document.getElementById("progressCard"),
  bar: document.getElementById("bar"),
  cTotal: document.getElementById("cTotal"),
  cUp: document.getElementById("cUp"),
  cSkip: document.getElementById("cSkip"),
  cErr: document.getElementById("cErr"),
  log: document.getElementById("log"),
  statusPill: document.getElementById("statusPill"),
};

const counters = { total: 0, up: 0, skip: 0, err: 0, done: 0 };
let wakeLock = null;

function loadDone() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveDone(set) {
  localStorage.setItem(DONE_KEY, JSON.stringify([...set]));
}
const done = loadDone();

function signature(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function logLine(msg, cls = "") {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.textContent = msg;
  els.log.prepend(div);
}

function render() {
  els.cTotal.textContent = counters.total;
  els.cUp.textContent = counters.up;
  els.cSkip.textContent = counters.skip;
  els.cErr.textContent = counters.err;
  const pct = counters.total
    ? Math.round((counters.done / counters.total) * 100)
    : 0;
  els.bar.style.width = `${pct}%`;
}

async function sha256Hex(file) {
  if (!(window.crypto && window.crypto.subtle)) return null;
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null; // e.g. insecure context or memory limits
  }
}

async function requestWakeLock() {
  if (!els.keepAwake.checked) return;
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch {
    /* wake lock is best-effort */
  }
}
async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && counters.done < counters.total) {
    requestWakeLock();
  }
});

async function uploadOne(file) {
  const sig = signature(file);
  if (done.has(sig)) {
    counters.skip++;
    counters.done++;
    render();
    return;
  }

  // Skip transferring bytes if the laptop already has this exact content.
  const hash = await sha256Hex(file);
  if (hash) {
    try {
      const { exists } = await fetch(`/api/exists/${hash}`).then((r) =>
        r.json(),
      );
      if (exists) {
        done.add(sig);
        saveDone(done);
        counters.skip++;
        counters.done++;
        logLine(`↷ already backed up: ${file.name}`, "skip");
        render();
        return;
      }
    } catch {
      /* fall through to upload */
    }
  }

  const form = new FormData();
  form.append("photo", file, file.name);
  form.append("name", file.name);
  form.append("type", file.type || "application/octet-stream");

  let attempt = 0;
  while (attempt < 4) {
    attempt++;
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      done.add(sig);
      saveDone(done);
      if (data.status === "skipped") {
        counters.skip++;
        logLine(`↷ already backed up: ${file.name}`, "skip");
      } else {
        counters.up++;
        logLine(`✓ backed up: ${file.name}`, "ok");
      }
      counters.done++;
      render();
      return;
    } catch (err) {
      if (attempt >= 4) {
        counters.err++;
        counters.done++;
        logLine(`✗ failed: ${file.name} (${err.message})`, "err");
        render();
        return;
      }
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
}

async function runQueue(files) {
  const queue = [...files];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const file = queue.shift();
      await uploadOne(file);
    }
  });
  await Promise.all(workers);
}

els.picker.addEventListener("change", async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;

  Object.assign(counters, { total: files.length, up: 0, skip: 0, err: 0, done: 0 });
  els.progressCard.style.display = "block";
  els.log.innerHTML = "";
  render();

  await requestWakeLock();
  logLine(`Starting backup of ${files.length} item(s)…`);
  await runQueue(files);
  await releaseWakeLock();
  logLine(
    `Done — ${counters.up} uploaded, ${counters.skip} skipped, ${counters.err} failed.`,
  );
  els.picker.value = "";
});

// Connectivity indicator.
(async function ping() {
  try {
    await fetch("/api/health");
    els.statusPill.textContent = "● connected";
    els.statusPill.classList.add("live");
  } catch {
    els.statusPill.textContent = "● no connection";
    els.statusPill.classList.remove("live");
  }
  setTimeout(ping, 5000);
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
