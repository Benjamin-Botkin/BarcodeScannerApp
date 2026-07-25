import "./style.css";
import { Scanner } from "./scanner.js";
import {
  getHistory,
  addToHistory,
  clearHistory,
  historyToCsv,
} from "./history.js";
import { installDebugOverlay } from "./debug.js";

if (new URLSearchParams(location.search).has("debug")) {
  installDebugOverlay();
}

const video = document.getElementById("camera");
const canvas = document.getElementById("capture-canvas");
const cameraError = document.getElementById("camera-error");
const resultBanner = document.getElementById("result-banner");
const resultFormat = document.getElementById("result-format");
const resultText = document.getElementById("result-text");
const resultCopy = document.getElementById("result-copy");
const resultOpen = document.getElementById("result-open");
const resultDismiss = document.getElementById("result-dismiss");

const historyToggle = document.getElementById("history-toggle");
const historyPanel = document.getElementById("history-panel");
const historyClose = document.getElementById("history-close");
const historyExport = document.getElementById("history-export");
const historyClear = document.getElementById("history-clear");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");

function isLikelyUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatLabel(format) {
  return String(format).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function showResult({ text, format }) {
  console.log("showResult() called with format:", format, "text:", text);
  try {
    scanner.pause();
    historyPanel.hidden = true;
    historyToggle.setAttribute("aria-expanded", "false");
    resultFormat.textContent = formatLabel(format);
    resultText.textContent = text;
    resultOpen.hidden = !isLikelyUrl(text);
    resultBanner.hidden = false;
    console.log(
      "resultBanner.hidden is now:",
      resultBanner.hidden,
      "offsetParent:",
      !!resultBanner.offsetParent,
    );
    addToHistory({ text, format });
  } catch (err) {
    console.error("showResult() threw:", err);
  }
}

function hideResult() {
  resultBanner.hidden = true;
  resultFormat.textContent = "";
  resultText.textContent = "";
  resultOpen.hidden = true;
  scanner.resume();
}

resultCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(resultText.textContent);
    resultCopy.textContent = "Copied!";
    setTimeout(() => (resultCopy.textContent = "Copy"), 1200);
  } catch (err) {
    console.error("Clipboard write failed:", err);
  }
});

resultOpen.addEventListener("click", () => {
  window.open(resultText.textContent, "_blank", "noopener,noreferrer");
});

resultDismiss.addEventListener("click", hideResult);

function renderHistory() {
  const entries = getHistory();
  historyList.innerHTML = "";
  historyEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement("li");
    const time = new Date(entry.timestamp).toLocaleString();
    li.innerHTML = `
      <div class="h-format">${formatLabel(entry.format)}</div>
      <div class="h-text"></div>
      <div class="h-time">${time}</div>
    `;
    li.querySelector(".h-text").textContent = entry.text;
    li.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(entry.text);
      } catch (err) {
        console.error("Clipboard write failed:", err);
      }
    });
    historyList.appendChild(li);
  }
}

historyToggle.addEventListener("click", () => {
  console.log("history-toggle clicked");
  renderHistory();
  historyPanel.hidden = false;
  historyToggle.setAttribute("aria-expanded", "true");
  const cs = getComputedStyle(historyPanel);
  console.log(
    `history-panel opened: hidden=${historyPanel.hidden}, opacity=${cs.opacity}, zIndex=${cs.zIndex}, display=${cs.display}`,
  );
  for (const el of [historyExport, historyClear, historyClose]) {
    const s = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const topEl = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    console.log(
      `${el.id}: opacity=${s.opacity} pointerEvents=${s.pointerEvents} visibility=${s.visibility} elementAtCenter=${topEl ? topEl.id || topEl.tagName : "none"}`,
    );
  }
});

historyClose.addEventListener("click", () => {
  console.log("history-close clicked");
  historyPanel.hidden = true;
  historyToggle.setAttribute("aria-expanded", "false");
});

historyExport.addEventListener("click", () => {
  console.log("history-export clicked, entries:", getHistory().length);
  const entries = getHistory();
  const csv = historyToCsv(entries);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `barcode-scans-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log("history-export: download triggered");
});

historyClear.addEventListener("click", () => {
  console.log("history-clear clicked, entries before:", getHistory().length);
  clearHistory();
  renderHistory();
  console.log("history-clear: done, entries after:", getHistory().length);
});

const scanner = new Scanner({
  video,
  canvas,
  onResult: showResult,
});

scanner.start().catch((err) => {
  console.error("Camera init failed:", err);
  cameraError.hidden = false;
  cameraError.querySelector("p").textContent =
    err.name === "NotAllowedError"
      ? "Camera access was denied. Enable it in Settings > Safari > Camera for this site, then reload."
      : "Couldn't access the camera on this device.";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((err) => {
        console.error("Service worker registration failed:", err);
      });
  });
}
