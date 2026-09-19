// The "new message" chirp, synthesised with Web Audio: no audio file to host, fetch or cache,
// and nothing for a site's Content-Security-Policy to block.

let ctx = null;

/** Browsers only let a page make sound after the visitor has interacted with it. Called from the
 *  Send click, so by the time the reply arrives the audio context is already allowed to play. */
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

function note(startAt, fromHz, toHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(fromHz, startAt);
  osc.frequency.exponentialRampToValueAtTime(toHz, startAt + 0.07);   // the upward sweep is what reads as a chirp
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.11, startAt + 0.012);      // quick attack, kept quiet on purpose
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.1);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + 0.11);
}

/** Two short rising notes, about a fifth of a second in total. */
export function playChirp() {
  if (!ctx || ctx.state !== "running") return;
  try {
    const now = ctx.currentTime;
    note(now, 1350, 2050);
    note(now + 0.095, 1650, 2500);
  } catch {
    /* ignore */
  }
}
