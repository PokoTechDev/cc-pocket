import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createSseBroadcaster,
  SSE_KEEPALIVE_INTERVAL_MS,
  formatSseFrame,
} from '../../server/sse.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = null;
    this.headers = null;
    this.writes = [];
    this.ended = false;
    this.shouldThrow = false;
  }
  writeHead(status, headers) {
    this.statusCode = status;
    this.headers = headers;
  }
  write(chunk) {
    if (this.shouldThrow) throw new Error('socket closed');
    this.writes.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
}

describe('formatSseFrame', () => {
  test('formats event, id, and JSON data', () => {
    const out = formatSseFrame({ event: 'output', id: 42, data: { text: 'hi' } });
    assert.equal(out, 'event: output\nid: 42\ndata: {"text":"hi"}\n\n');
  });

  test('omits event line when missing', () => {
    const out = formatSseFrame({ data: { x: 1 } });
    assert.equal(out, 'data: {"x":1}\n\n');
  });

  test('omits id line when missing', () => {
    const out = formatSseFrame({ event: 'ping', data: { ts: 100 } });
    assert.equal(out, 'event: ping\ndata: {"ts":100}\n\n');
  });
});

describe('createSseBroadcaster — attach', () => {
  test('writes SSE headers on attach', () => {
    const bc = createSseBroadcaster();
    const res = new FakeResponse();
    bc.attach(res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    assert.equal(res.headers['Cache-Control'], 'no-cache');
  });

  test('clientCount tracks attached clients', () => {
    const bc = createSseBroadcaster();
    assert.equal(bc.clientCount(), 0);
    bc.attach(new FakeResponse());
    assert.equal(bc.clientCount(), 1);
    bc.attach(new FakeResponse());
    assert.equal(bc.clientCount(), 2);
  });

  test("client is removed when its response emits 'close'", () => {
    const bc = createSseBroadcaster();
    const res = new FakeResponse();
    bc.attach(res);
    assert.equal(bc.clientCount(), 1);
    res.emit('close');
    assert.equal(bc.clientCount(), 0);
  });
});

describe('createSseBroadcaster — broadcast', () => {
  test('writes the same frame to every attached client', () => {
    const bc = createSseBroadcaster();
    const a = new FakeResponse();
    const b = new FakeResponse();
    bc.attach(a);
    bc.attach(b);
    const delivered = bc.broadcast({ event: 'state', data: { id: '0', state: 'streaming' }, id: 1 });
    assert.equal(delivered, 2);
    const expected = 'event: state\nid: 1\ndata: {"id":"0","state":"streaming"}\n\n';
    assert.equal(a.writes[0], expected);
    assert.equal(b.writes[0], expected);
  });

  test('drops a client whose write throws', () => {
    const bc = createSseBroadcaster();
    const good = new FakeResponse();
    const bad = new FakeResponse();
    bad.shouldThrow = true;
    bc.attach(good);
    bc.attach(bad);
    bc.broadcast({ event: 'x', data: {} });
    assert.equal(bc.clientCount(), 1);
    assert.equal(good.writes.length, 1);
  });
});

describe('createSseBroadcaster — send to single client', () => {
  test('writes only to the targeted client', () => {
    const bc = createSseBroadcaster();
    const a = new FakeResponse();
    const b = new FakeResponse();
    const clientA = bc.attach(a);
    bc.attach(b);
    bc.send(clientA, { event: 'snapshot', data: { hello: 1 } });
    assert.equal(a.writes.length, 1);
    assert.equal(b.writes.length, 0);
  });
});

describe('createSseBroadcaster — keepalive', () => {
  test('startKeepalive emits ping events at the configured interval', async () => {
    const bc = createSseBroadcaster({
      keepaliveInterval: 10,
      now: () => 1234,
    });
    const res = new FakeResponse();
    bc.attach(res);
    const stop = bc.startKeepalive();
    await new Promise((r) => setTimeout(r, 35));
    stop();
    const pings = res.writes.filter((w) => w.startsWith('event: ping'));
    assert.ok(pings.length >= 2, `expected at least 2 pings, got ${pings.length}`);
    assert.match(pings[0], /"timestamp":1234/);
  });

  test('default keepalive interval is 30s', () => {
    assert.equal(SSE_KEEPALIVE_INTERVAL_MS, 30_000);
  });
});

describe('createSseBroadcaster — shutdown', () => {
  test('shutdown ends all clients and clears registry', () => {
    const bc = createSseBroadcaster();
    const a = new FakeResponse();
    const b = new FakeResponse();
    bc.attach(a);
    bc.attach(b);
    bc.shutdown();
    assert.equal(bc.clientCount(), 0);
    assert.equal(a.ended, true);
    assert.equal(b.ended, true);
  });
});
