// One store for the whole app. Views render from it; actions patch it.
// Keep it flat and serializable: the router mirrors part of it into the hash.

export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key of Object.keys(next)) {
        if (!Object.is(state[key], next[key])) { changed = true; break; }
      }
      if (!changed) return;
      const prev = state;
      state = { ...state, ...next };
      for (const fn of subs) fn(state, prev);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function readSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(`giramundo:${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeSetting(key, value) {
  try { localStorage.setItem(`giramundo:${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}
