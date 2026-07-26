// Hatch content translation
//
// Hatch listings are written by clients in their own language. When a browsing
// Operator's content-language preference doesn't match, this module fetches a
// machine translation from /api/translate and caches it, keyed by Hatch id +
// target language + a hash of the source text. The hash means an edited Hatch
// re-translates instead of serving a stale cached copy.
//
// Every failure path returns null so callers fall back to the original text —
// an untranslated Hatch is always better than a blank card.
window.HatchTranslate = (() => {
  const CACHE_KEY = "hatchTranslationCache";
  const MAX_ENTRIES = 300;
  const FIELDS = ["title", "objective", "description", "business", "deliverables"];

  // In-flight requests, so a grid with the same Hatch rendered twice (or a
  // re-render mid-flight) issues one call rather than two.
  const pending = new Map();

  function apiUrl(path) {
    if (window.location.protocol === "file:") return `http://127.0.0.1:8132${path}`;
    return path;
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function writeCache(cache) {
    try {
      // Trim oldest-first when the cache outgrows its cap; localStorage is a
      // shared ~5MB budget with drafts and attached files.
      const entries = Object.entries(cache);
      if (entries.length > MAX_ENTRIES) {
        entries.sort((a, b) => (a[1].savedAt || 0) - (b[1].savedAt || 0));
        cache = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES));
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota exceeded — translations are disposable, so drop the cache */
    }
    return cache;
  }

  // Cheap, stable string hash (djb2). Only needs to change when the source
  // text changes; collisions are harmless beyond a rare stale translation.
  function hash(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function sourceFields(task = {}) {
    const fields = {};
    for (const key of FIELDS) {
      const value = task[key];
      if (Array.isArray(value)) {
        if (value.length) fields[key] = value.filter(Boolean).map(String);
      } else if (typeof value === "string" && value.trim()) {
        fields[key] = value;
      }
    }
    return fields;
  }

  function cacheKey(task, target) {
    const fields = sourceFields(task);
    return `${task.id || "anon"}:${target}:${hash(JSON.stringify(fields))}`;
  }

  // Synchronous cache read — used during render so an already-translated Hatch
  // paints translated on the first frame with no flash of the original.
  function getCached(task, target) {
    if (!task || !target) return null;
    const entry = readCache()[cacheKey(task, target)];
    return entry?.translation || null;
  }

  // Merge a translation over the original so any field the model omitted keeps
  // its source text rather than disappearing.
  function merge(task, translation) {
    if (!translation) return task;
    const merged = { ...task };
    for (const key of FIELDS) {
      const value = translation[key];
      if (Array.isArray(value) && value.length) merged[key] = value.map(String);
      else if (typeof value === "string" && value.trim()) merged[key] = value;
    }
    merged.translatedFrom = window.HatchI18n?.taskLanguage(task) || null;
    merged.translatedTo = translation.__target || merged.translatedTo || null;
    merged.originalTask = task;
    return merged;
  }

  async function translate(task, target) {
    if (!task || !target) return null;
    const cached = getCached(task, target);
    if (cached) return cached;

    const key = cacheKey(task, target);
    if (pending.has(key)) return pending.get(key);

    const fields = sourceFields(task);
    if (!Object.keys(fields).length) return null;

    const request = (async () => {
      try {
        const response = await fetch(apiUrl("/api/translate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, fields }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.translation) {
          console.warn("[Hatch translate] failed", data.error || response.status);
          return null;
        }
        const translation = { ...data.translation, __target: target };
        const cache = readCache();
        cache[key] = { translation, savedAt: Date.now() };
        writeCache(cache);
        return translation;
      } catch (error) {
        console.warn("[Hatch translate] request error", error?.message || error);
        return null;
      } finally {
        pending.delete(key);
      }
    })();

    pending.set(key, request);
    return request;
  }

  // Resolve a Hatch for display: returns the original untouched unless it is in
  // a foreign language AND the reader asked for translations. `onReady` fires
  // only when a network translation lands, so callers can repaint that card.
  function forDisplay(task, onReady) {
    const I18n = window.HatchI18n;
    if (!I18n || !task) return task;
    const { contentLanguage, foreignHatches } = I18n.getPrefs();
    const source = I18n.taskLanguage(task);
    if (source === contentLanguage || foreignHatches !== "translate") return task;

    const cached = getCached(task, contentLanguage);
    if (cached) return merge(task, cached);

    if (typeof onReady === "function") {
      translate(task, contentLanguage).then((translation) => {
        if (translation) onReady(merge(task, translation), task);
      });
    }
    return task;
  }

  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  return { translate, getCached, forDisplay, merge, clearCache };
})();
