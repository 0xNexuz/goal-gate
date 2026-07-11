import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.js';

let base;
test.before(async () => { await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('health endpoint responds', async () => { const response = await fetch(`${base}/api/health`); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'ok'); });
test('match feed is free', async () => { const response = await fetch(`${base}/api/v1/matches`); const body = await response.json(); assert.equal(response.status, 200); assert.ok(body.data.length >= 3); });
test('CCTP funding endpoint returns official Injective testnet configuration', async () => {
  const response = await fetch(`${base}/api/v1/funding/cctp`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.destinationDomain, 29);
  assert.equal(body.usdcContract, '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d');
  assert.equal(body.tokenMessenger, '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA');
});
test('premium insight returns an x402 challenge', async () => {
  const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matchId: 'fra-arg', question: 'Where is the next opening?' }) });
  const body = await response.json();
  assert.equal(response.status, 402);
  assert.ok(response.headers.get('payment-required'));
  assert.equal(body.accepts[0].network, 'eip155:1439');
  assert.equal(body.accepts[0].asset, '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d');
  assert.equal(body.accepts[0].extra.name, 'USDC');
  assert.equal(body.accepts[0].extra.assetTransferMethod, 'eip3009');
});
test('development payment unlocks an insight and returns a receipt', async () => {
  const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json', 'PAYMENT-SIGNATURE': 'demo' }, body: JSON.stringify({ matchId: 'fra-arg', question: 'Where is the next opening?' }) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.payment.demo, true);
  assert.ok(response.headers.get('payment-response'));
});
test('invalid insight request is rejected before payment', async () => { const response = await fetch(`${base}/api/v1/insights`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(response.status, 400); });
