// Speaking recordings: MediaRecorder -> IndexedDB (audio is too big for localStorage).
// Each recording is also uploaded to serve.py (../progress/recordings), which keeps it in git.
const DB = 'ielts-cbt', STORE = 'recordings';
let dbp;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}
async function upload(rec) {
  try {
    const r = await fetch(`/api/rec/${rec.id}`, { method: 'PUT', headers: { 'Content-Type': rec.blob.type || 'audio/webm' }, body: rec.blob });
    if (r.ok) await tx('readwrite', (s) => s.put({ ...rec, up: 1 }));
  } catch { /* the Mac is out of reach: sendRecordings() tries again later */ }
}
export async function putRec(rec) {
  await tx('readwrite', (s) => s.put(rec));
  upload(rec);
}
/** Send the recordings made while the Mac was out of reach (the phone, away from home). */
export async function sendRecordings() {
  const all = await tx('readonly', (s) => s.getAll()).catch(() => []);
  for (const rec of all || []) if (!rec.up && rec.blob) await upload(rec);
}
export async function getRec(id) {
  const local = await tx('readonly', (s) => s.get(id)).catch(() => null);
  if (local) return local;
  // not in this browser (cleared storage, another browser): use the copy saved on disk
  const r = await fetch(`/api/rec/${id}`).catch(() => null);
  return r?.ok ? { id, blob: await r.blob() } : null;
}
export const delRec = (id) => tx('readwrite', (s) => s.delete(id));

/** Start recording from the microphone. Returns { stop(): Promise<Blob>, stream }. */
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream);
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start(1000);
  return {
    stream,
    stop: () => new Promise((res) => {
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); };
      if (mr.state !== 'inactive') mr.stop(); else mr.onstop();
    }),
  };
}

/** Speak text with the browser's voice (British English if available). Resolves when finished. */
export function say(text) {
  return new Promise((res) => {
    if (!('speechSynthesis' in window)) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /en[-_]GB/i.test(v.lang) && /female|serena|kate|martha|daniel|google uk/i.test(v.name)) || voices.find((v) => /en[-_]GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
    u.rate = 0.95;
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
  });
}
