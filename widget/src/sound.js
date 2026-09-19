// The widget's sounds, synthesised with Web Audio: no audio file to host, fetch or cache, and nothing for a
// site's Content-Security-Policy to block. All short and quiet; the visitor can mute them in the chat header.

let ctx = null;

/** Browsers only let a page make sound after the visitor has interacted with it. Called from clicks (open,
 *  Send), so by the time a reply arrives the audio context is already allowed to play. */
export function primeAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null; // no sound is never a reason to break the chat
  }
}

/** One note: a pitch sweep from `fromHz` to `toHz` with a quick attack and a soft tail. */
function tone(startAt, fromHz, toHz, length, volume, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, startAt);
  osc.frequency.exponentialRampToValueAtTime(toHz, startAt + length * 0.7);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.012, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + length + 0.01);
}

function play(notes) {
  if (!ctx || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    notes.forEach(([at, from, to, length, volume, type]) => tone(now + at, from, to, length, volume, type));
  } catch {
    /* ignore */
  }
}

/** A reply arrived while the visitor is watching: two short rising notes. */
export const playChirp = () => play([[0, 1350, 2050, 0.1, 0.11], [0.095, 1650, 2500, 0.1, 0.11]]);

/** The chat opens: a soft rising pop. */
export const playOpen = () => play([[0, 520, 880, 0.09, 0.07, "triangle"]]);

/** The chat closes: the same pop, falling. */
export const playClose = () => play([[0, 820, 480, 0.08, 0.06, "triangle"]]);

/** The visitor sends a message: a quick upward swish. */
export const playSend = () => play([[0, 600, 1500, 0.07, 0.05]]);

/** Contact details sent: a small, bright three-note "done". */
export const playSuccess = () => play([[0, 1047, 1047, 0.12, 0.08], [0.09, 1319, 1319, 0.12, 0.08], [0.18, 1568, 1568, 0.2, 0.08]]);

/** A reply arrived while the visitor is away (chat closed, or another tab): louder, bell-like, twice. */
export const playAlert = () => play([
  [0, 988, 988, 0.18, 0.16, "triangle"], [0.12, 1319, 1319, 0.26, 0.16, "triangle"],
  [0.55, 988, 988, 0.18, 0.13, "triangle"], [0.67, 1319, 1319, 0.26, 0.13, "triangle"],
]);
