// IndexedDB store for speaking recordings (audio blobs are too big for localStorage).
const DB = 'ielts-suite', STORE = 'recordings';
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
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
export const putRec = (rec) => tx('readwrite', (s) => s.put(rec));
export const delRec = (id) => tx('readwrite', (s) => s.delete(id));
export const allRecs = () => tx('readonly', (s) => s.getAll());
