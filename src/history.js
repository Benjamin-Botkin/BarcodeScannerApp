const STORAGE_KEY = "barcode-scan-history";
const MAX_ENTRIES = 200;

export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addToHistory({ text, format }) {
  const entries = getHistory();
  entries.unshift({ text, format, timestamp: Date.now() });
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_ENTRIES)),
  );
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
}
