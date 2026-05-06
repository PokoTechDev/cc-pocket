import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStateStore,
  IDLE_THRESHOLD_MS,
  RING_BUFFER_MAX_CHUNKS,
  RING_BUFFER_MAX_BYTES,
} from '../../server/state.js';

describe('createStateStore — window registry', () => {
  test('starts with no windows', () => {
    const store = createStateStore();
    assert.deepEqual(store.listWindows(), []);
  });

  test('setWindows adds windows with idle state', () => {
    const fixed = 1_700_000_000_000;
    const store = createStateStore({ now: () => fixed });
    store.setWindows([
      { id: '0', name: 'main' },
      { id: '1', name: 'logs' },
    ]);
    const windows = store.listWindows();
    assert.equal(windows.length, 2);
    for (const w of windows) {
      assert.equal(w.state, 'idle');
      assert.equal(w.lastActivityAt, fixed);
      assert.equal(w.outputBytes, 0);
    }
    const main = store.getWindow('0');
    assert.equal(main.name, 'main');
  });

  test('setWindows removes windows that disappeared', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'a' }, { id: '1', name: 'b' }]);
    store.setWindows([{ id: '0', name: 'a' }]);
    assert.equal(store.listWindows().length, 1);
    assert.equal(store.getWindow('1'), null);
  });

  test('setWindows updates name if changed, preserves state', () => {
    const fixed = 1_700_000_000_000;
    const store = createStateStore({ now: () => fixed });
    store.setWindows([{ id: '0', name: 'old' }]);
    store.appendOutput('0', 'hello');
    assert.equal(store.getWindow('0').state, 'streaming');
    store.setWindows([{ id: '0', name: 'new' }]);
    const w = store.getWindow('0');
    assert.equal(w.name, 'new');
    assert.equal(w.state, 'streaming');
  });

  test('getWindow returns null for unknown id', () => {
    const store = createStateStore();
    assert.equal(store.getWindow('99'), null);
  });
});

describe('createStateStore — output and state transitions', () => {
  test('appendOutput returns chunk with monotonic seq', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    const a = store.appendOutput('0', 'hi');
    const b = store.appendOutput('0', 'there');
    assert.equal(a.windowId, '0');
    assert.equal(a.seq, 1);
    assert.equal(b.seq, 2);
    assert.equal(a.text, 'hi');
    assert.equal(b.text, 'there');
  });

  test('appendOutput transitions window to streaming and updates lastActivityAt', () => {
    let now = 1000;
    const store = createStateStore({ now: () => now });
    store.setWindows([{ id: '0', name: 'main' }]);
    now = 5000;
    store.appendOutput('0', 'hi');
    const w = store.getWindow('0');
    assert.equal(w.state, 'streaming');
    assert.equal(w.lastActivityAt, 5000);
  });

  test('appendOutput accumulates outputBytes (utf8)', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'abc');     // 3 bytes
    store.appendOutput('0', 'あ');       // 3 bytes utf8
    assert.equal(store.getWindow('0').outputBytes, 6);
  });

  test('appendOutput on unknown window returns null', () => {
    const store = createStateStore();
    assert.equal(store.appendOutput('99', 'hi'), null);
  });

  test('seq counters are independent per window', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'a' }, { id: '1', name: 'b' }]);
    assert.equal(store.appendOutput('0', 'x').seq, 1);
    assert.equal(store.appendOutput('1', 'y').seq, 1);
    assert.equal(store.appendOutput('0', 'z').seq, 2);
  });
});

describe('createStateStore — tick (idle threshold)', () => {
  test('streaming window returns to idle after IDLE_THRESHOLD_MS of silence', () => {
    let now = 1000;
    const store = createStateStore({ now: () => now });
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'hi');
    assert.equal(store.getWindow('0').state, 'streaming');
    now += IDLE_THRESHOLD_MS;
    const transitions = store.tick();
    assert.equal(transitions.length, 1);
    assert.deepEqual(transitions[0], { id: '0', from: 'streaming', to: 'idle' });
    assert.equal(store.getWindow('0').state, 'idle');
  });

  test('streaming window stays streaming if recent activity', () => {
    let now = 1000;
    const store = createStateStore({ now: () => now });
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'hi');
    now += IDLE_THRESHOLD_MS - 1;
    const transitions = store.tick();
    assert.equal(transitions.length, 0);
    assert.equal(store.getWindow('0').state, 'streaming');
  });

  test('tick is no-op for idle windows', () => {
    let now = 1000;
    const store = createStateStore({ now: () => now });
    store.setWindows([{ id: '0', name: 'main' }]);
    now += 10_000;
    const transitions = store.tick();
    assert.equal(transitions.length, 0);
  });
});

describe('createStateStore — ring buffer', () => {
  test('getChunksSince(null) returns all chunks', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'a');
    store.appendOutput('0', 'b');
    const all = store.getChunksSince('0', null);
    assert.equal(all.length, 2);
  });

  test('getChunksSince(seq) returns only newer chunks', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'a');
    store.appendOutput('0', 'b');
    store.appendOutput('0', 'c');
    const since = store.getChunksSince('0', 2);
    assert.equal(since.length, 1);
    assert.equal(since[0].text, 'c');
  });

  test('returned chunks are detached copies (no mutation leak)', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    store.appendOutput('0', 'a');
    const chunks = store.getChunksSince('0', null);
    chunks.push({ tampered: true });
    assert.equal(store.getChunksSince('0', null).length, 1);
  });

  test('ring buffer trims oldest chunk when chunk count exceeds limit', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    for (let i = 0; i < RING_BUFFER_MAX_CHUNKS + 5; i++) {
      store.appendOutput('0', `${i}`);
    }
    const all = store.getChunksSince('0', null);
    assert.equal(all.length, RING_BUFFER_MAX_CHUNKS);
    assert.equal(all[0].seq, 6);
  });

  test('ring buffer trims by byte budget', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    const chunkSize = 100_000;
    const huge = 'x'.repeat(chunkSize);
    const expectedChunks = Math.ceil(RING_BUFFER_MAX_BYTES / chunkSize);
    for (let i = 0; i < expectedChunks + 3; i++) {
      store.appendOutput('0', huge);
    }
    const all = store.getChunksSince('0', null);
    const totalBytes = all.reduce((sum, c) => sum + Buffer.byteLength(c.text, 'utf8'), 0);
    assert.ok(totalBytes <= RING_BUFFER_MAX_BYTES + chunkSize, `bytes ${totalBytes} should be near budget ${RING_BUFFER_MAX_BYTES}`);
    assert.ok(all.length < expectedChunks + 3);
  });

  test('getChunksSince on unknown window returns null', () => {
    const store = createStateStore();
    assert.equal(store.getChunksSince('99', null), null);
  });
});

describe('createStateStore — screen snapshots', () => {
  test('getScreen returns null when no snapshot stored', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    assert.equal(store.getScreen('0'), null);
  });

  test('setScreen stores text retrievable by getScreen', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    const ok = store.setScreen('0', 'hello\nworld');
    assert.equal(ok, true);
    assert.equal(store.getScreen('0'), 'hello\nworld');
  });

  test('setScreen on unknown window returns false', () => {
    const store = createStateStore();
    assert.equal(store.setScreen('99', 'x'), false);
  });

  test('removed window also clears screen', () => {
    const store = createStateStore();
    store.setWindows([{ id: '0', name: 'main' }]);
    store.setScreen('0', 'kept');
    store.setWindows([{ id: '1', name: 'other' }]);
    assert.equal(store.getScreen('0'), null);
  });
});
