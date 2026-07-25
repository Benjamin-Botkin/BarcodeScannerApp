const MAX_LINES = 60;

let panel;
let list;

function ensurePanel() {
  if (panel) return;
  panel = document.createElement("div");
  panel.id = "debug-panel";
  panel.innerHTML = `
    <div id="debug-header">Debug log (tap to hide)</div>
    <div id="debug-list"></div>
  `;
  Object.assign(panel.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    maxHeight: "45vh",
    overflowY: "auto",
    background: "rgba(0,0,0,0.85)",
    color: "#0f0",
    fontFamily: "monospace",
    fontSize: "11px",
    zIndex: "9999",
    padding: "6px",
    boxSizing: "border-box",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  });
  panel.querySelector("#debug-header").style.cssText =
    "color:#fff;font-weight:bold;margin-bottom:4px;";
  document.body.appendChild(panel);
  list = panel.querySelector("#debug-list");

  panel.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });
}

function log(level, args) {
  ensurePanel();
  const line = document.createElement("div");
  const time = new Date().toISOString().split("T")[1].replace("Z", "");
  const text = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "object") {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(" ");
  line.textContent = `[${time}] ${level}: ${text}`;
  if (level === "error") line.style.color = "#f66";
  else if (level === "warn") line.style.color = "#ff0";
  list.appendChild(line);
  while (list.children.length > MAX_LINES) {
    list.removeChild(list.firstChild);
  }
  panel.scrollTop = panel.scrollHeight;
}

export function installDebugOverlay() {
  ensurePanel();
  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args) => {
    original.log(...args);
    log("log", args);
  };
  console.warn = (...args) => {
    original.warn(...args);
    log("warn", args);
  };
  console.error = (...args) => {
    original.error(...args);
    log("error", args);
  };
  window.addEventListener("error", (e) => {
    log("error", [`Uncaught: ${e.message}`, `${e.filename}:${e.lineno}`]);
  });
  window.addEventListener("unhandledrejection", (e) => {
    log("error", ["Unhandled rejection:", e.reason]);
  });
  log("log", ["Debug overlay installed."]);
}
