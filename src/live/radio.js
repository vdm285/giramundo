// One audio element for the whole app, so a station keeps playing while
// you wander to other countries. Streams come from the Radio-Browser
// directory (public/data/radio.json); we only play, never re-host.

// Directory names often carry the city, the owner and a URL after dashes.
// Keep the first part for display; the full name stays in the title.
export function shortName(name) {
  const first = String(name || '').split(/\s[-–|]\s/)[0].trim();
  return first.length > 3 ? first : String(name || '').trim();
}

export function createRadio() {
  const audio = new Audio();
  audio.preload = 'none';
  const subs = new Set();
  const state = { station: null, iso2: null, status: 'idle', volume: 0.8, error: '' };
  let token = 0;

  function emit() { for (const fn of subs) fn({ ...state }); }
  function setStatus(status, error = '') { state.status = status; state.error = error; emit(); }

  audio.addEventListener('playing', () => setStatus('playing'));
  audio.addEventListener('waiting', () => { if (state.status !== 'idle') setStatus('loading'); });
  audio.addEventListener('stalled', () => { if (state.status === 'playing') setStatus('loading'); });
  audio.addEventListener('pause', () => { if (state.status !== 'error' && state.station) setStatus('paused'); });
  audio.addEventListener('error', () => setStatus('error', 'stream'));

  try { state.volume = Number(localStorage.getItem('giramundo:volume') ?? 0.8); } catch { /* ignore */ }
  audio.volume = state.volume;

  async function play(station, iso2) {
    const my = ++token;
    state.station = station;
    state.iso2 = iso2;
    setStatus('loading');
    audio.src = station.url;
    // A live stream that has not started within 15 s is treated as down.
    const watchdog = setTimeout(() => {
      if (my === token && state.status === 'loading') { audio.pause(); setStatus('error', 'stream'); }
    }, 15000);
    try {
      await audio.play();
      if (my !== token) return;
      clearTimeout(watchdog);
      setStatus('playing');
    } catch (err) {
      clearTimeout(watchdog);
      if (my !== token) return;
      setStatus('error', err?.name === 'NotAllowedError' ? 'gesture' : 'stream');
    }
  }

  return {
    get state() { return { ...state }; },
    play,
    pause() { audio.pause(); },
    resume() { if (state.station) { if (audio.src) audio.play().catch(() => setStatus('error', 'stream')); else play(state.station, state.iso2); } },
    toggle() { if (state.status === 'playing' || state.status === 'loading') audio.pause(); else this.resume(); },
    stop() { token += 1; audio.pause(); audio.removeAttribute('src'); audio.load(); state.station = null; state.iso2 = null; setStatus('idle'); },
    setVolume(v) {
      state.volume = Math.max(0, Math.min(1, v));
      audio.volume = state.volume;
      try { localStorage.setItem('giramundo:volume', String(state.volume)); } catch { /* ignore */ }
      emit();
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
