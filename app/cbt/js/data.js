let index = null;
const tests = new Map();

let learnDoc = null;
/** The writing and speaking material of the Learn pages (writing/build.py). */
export async function loadLearn() {
  if (!learnDoc) {
    const r = await fetch('data/learn.json');
    if (!r.ok) throw new Error(`data/learn.json: ${r.status}`);
    learnDoc = await r.json();
  }
  return learnDoc;
}

export async function loadIndex() {
  if (!index) {
    const r = await fetch('data/index.json');
    if (!r.ok) throw new Error('data/index.json: ' + r.status);
    index = await r.json();
  }
  return index;
}
export const books = () => index.books;
export const allTests = () => index.books.flatMap((b) => b.tests.map((t) => ({ ...t, book: b.id, bookName: b.name })));
export const testInfo = (id) => allTests().find((t) => t.id === id);

export async function loadTest(id) {
  if (!tests.has(id)) {
    const r = await fetch(`data/t/${id}.json`);
    if (!r.ok) throw new Error(`Test ${id} not found`);
    tests.set(id, await r.json());
  }
  return tests.get(id);
}

let audioMap = null;
/** Play smaller copies of the recordings where they exist: `map` is { original path: [smaller path, bytes, seconds] } (tools/mobile_audio.py). */
export function useAudioMap(map) { audioMap = map; }
export const audioPath = (path) => audioMap?.[path]?.[0] || path;

export function audioUrl(path) {
  return audioPath(path).split('/').map(encodeURIComponent).join('/');
}

/** Short name, e.g. "Book 15 · Test 2" */
export function testName(t) {
  return `Book ${t.book} · ${t.label}`;
}
