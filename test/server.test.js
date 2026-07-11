import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.js';

let base;
test.before(async () => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('health endpoint responds', async () => { const response = await fetch(`${base}/api/health`); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ok'); });
test('match feed is free', async () => { const response = await fetch(`${base}/api/v1/matches`); const body = await response.json(); assert.equal(response.status, 200); assert.ok(body.data.length >= 3); });
test('CCTP funding endpoint identifies Injective domain 29', async () => { const response = await fetch(`${base}/api/v1/funding/cctp`); const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.destinationDomain, 29); });
test('premium insight returns an x402 challenge', async () => {
  const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchId: 'fra-arg', question: 'Where is the next opening?' }) });
  assert.equal(response.status, 402); assert.ok(response.headers.get('payment-required'));
});
test('development payment unlocks an insight and returns a receipt', async () => {
  const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': 'demo' }, body: JSON.stringify({ matchId: 'fra-arg', question: 'Where is the next opening?' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.payment.demo, true);
  assert.ok(response.headers.get('payment-response'));
});
test('invalid insight request is rejected before payment', async () => { const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 400); });
