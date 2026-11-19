// GitHub progress sync writes (commits) only when asked: "Exchange now" calls flush(); push() only notes it.
import test from 'node:test'; import assert from 'node:assert';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const calls = [];
globalThis.fetch = async (url, opts = {}) => { calls.push(opts.method || 'GET');
  return new Response(JSON.stringify(opts.method === 'PUT' ? { sha: 'b' } : { sha: 'a', doc: { x: 1 } }), { status: 200 }); };
const { makeGitHubSync } = await import('../cbt/js/ghsync.js');
test('GitHub is written only when asked', async () => {
  const g = makeGitHubSync({ get: () => ({ y: 2 }), merge: () => true, server: true });
  await g.pull();                        // reads; finds this side has more
  g.push('Result: test'); g.push();       // a finished test, a routine save
  await new Promise((r) => setTimeout(r, 300));
  assert.deepStrictEqual(calls, ['GET'], 'nothing written by itself');
  assert.equal(g.status().pending, true);
  await g.flush();                        // "Exchange now"
  assert.deepStrictEqual(calls, ['GET', 'PUT']);
  assert.equal(g.status().pending, false);
  await g.flush();                        // nothing waiting: nothing sent
  assert.deepStrictEqual(calls, ['GET', 'PUT']);
});
