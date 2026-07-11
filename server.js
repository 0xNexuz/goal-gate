import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const production = process.env.NODE_ENV === 'production';
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`;
const rpcUrl = process.env.INJECTIVE_RPC_URL || 'https://sentry.evm-rpc.injective.network/';
const demoPayments = !production && process.env.GOALGATE_DEMO_PAYMENTS !== 'false';
const rateBuckets = new Map();

function validateProductionConfig() {
  if (!production) return;
  const required = ['PUBLIC_ORIGIN', 'X402_PAY_TO', 'X402_USDC_ASSET', 'X402_FACILITATOR_URL'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing production configuration: ${missing.join(', ')}`);
}

const matches = [
  { id: 'fra-arg', home: 'France', away: 'Argentina', homeCode: 'FRA', awayCode: 'ARG', score: '2 : 1', minute: 72, status: 'live' },
  { id: 'eng-bra', home: 'England', away: 'Brazil', homeCode: 'ENG', awayCode: 'BRA', score: '0 : 0', minute: 38, status: 'live' },
  { id: 'esp-ger', home: 'Spain', away: 'Germany', homeCode: 'ESP', awayCode: 'GER', score: '18:00', minute: null, status: 'upcoming' }
];

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const send = (res, status, data, headers = {}) => {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : mime['.json'], 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
};

function securityHeaders(res, requestId) {
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' https://sentry.evm-rpc.injective.network");
  if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function allowRequest(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, reset: now + 60_000 };
  if (now > bucket.reset) Object.assign(bucket, { count: 0, reset: now + 60_000 });
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= 120;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('INVALID_JSON'); }
}

function paymentRequirement() {
  return {
    x402Version: 2,
    resource: { url: `${origin}/api/v1/insights`, description: 'GoalGate premium match intelligence', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: process.env.X402_NETWORK || 'eip155:1776', amount: '10000', asset: process.env.X402_USDC_ASSET || 'USDC', payTo: process.env.X402_PAY_TO || 'CONFIGURE_X402_PAY_TO', maxTimeoutSeconds: 90 }]
  };
}

async function verifyAndSettle(signature, requirement) {
  if (demoPayments && signature === 'demo') return { success: true, transaction: `demo_${randomUUID()}`, network: requirement.accepts[0].network, demo: true };
  const facilitator = process.env.X402_FACILITATOR_URL;
  if (!facilitator) return { success: false, error: 'Payment facilitator is not configured.' };
  const payload = { paymentPayload: signature, paymentRequirements: requirement.accepts[0] };
  const verify = await fetch(`${facilitator.replace(/\/$/, '')}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  const verification = await verify.json();
  if (!verify.ok || !verification.isValid) return { success: false, error: verification.invalidReason || 'Payment verification failed.' };
  const settle = await fetch(`${facilitator.replace(/\/$/, '')}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
  const settlement = await settle.json();
  return settle.ok && settlement.success ? settlement : { success: false, error: settlement.errorReason || 'Payment settlement failed.' };
}

function buildInsight(match, question) {
  const insights = {
    'fra-arg': { edge: 0.68, summary: "France is creating a right-channel overload. Watch the next transition after Argentina's left-back advances.", signal: 'attacking-overload' },
    'eng-bra': { edge: 0.61, summary: 'England is finding space behind the first press. The next high-value opening is likely through a third-man run.', signal: 'press-break' },
    'esp-ger': { edge: 0.57, summary: 'Spain projects a possession edge, while Germany carries the stronger transition threat.', signal: 'pre-match-balance' }
  };
  return { id: randomUUID(), matchId: match.id, question, ...insights[match.id], confidence: 0.87, sources: ['live-events', 'lineups', 'momentum-model'], generatedAt: new Date().toISOString() };
}

async function networkStatus() {
  try {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(3500) });
    const data = await response.json();
    if (!response.ok || !data.result) throw new Error('RPC unavailable');
    return { status: 'operational', chainId: 1776, blockNumber: Number.parseInt(data.result, 16), rpc: 'connected' };
  } catch { return { status: 'degraded', chainId: 1776, blockNumber: null, rpc: 'unavailable' }; }
}

const openapi = {
  openapi: '3.1.0', info: { title: 'GoalGate API', version: '1.0.0' },
  servers: [{ url: origin }],
  paths: {
    '/api/health': { get: { summary: 'Service health', responses: { 200: { description: 'Healthy' } } } },
    '/api/v1/matches': { get: { summary: 'Free match feed', responses: { 200: { description: 'Match list' } } } },
    '/api/v1/funding/cctp': { get: { summary: 'CCTP funding configuration', responses: { 200: { description: 'Injective CCTP destination details' } } } },
    '/api/v1/insights': { post: { summary: 'Paid match insight', parameters: [{ in: 'header', name: 'PAYMENT-SIGNATURE', schema: { type: 'string' } }], responses: { 200: { description: 'Insight delivered' }, 402: { description: 'x402 payment required' } } } }
  }
};

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ok', service: 'goalgate', version: '1.0.0', timestamp: new Date().toISOString() });
  if (req.method === 'GET' && url.pathname === '/api/v1/network') return send(res, 200, await networkStatus());
  if (req.method === 'GET' && url.pathname === '/api/v1/matches') return send(res, 200, { data: matches, freshness: new Date().toISOString() }, { 'Cache-Control': 'public, max-age=15' });
  if (req.method === 'GET' && url.pathname === '/api/v1/funding/cctp') return send(res, 200, { protocol: 'CCTP', destination: 'Injective', destinationDomain: 29, asset: 'USDC', transferModel: 'burn-attest-mint', tutorial: 'https://docs.injective.network/developers-defi/usdc-cctp-tutorial', note: 'Clients must complete the CCTP transaction with a connected wallet; this endpoint never claims or simulates a transfer.' });
  if (req.method === 'GET' && url.pathname === '/api/openapi.json') return send(res, 200, openapi);
  if (req.method === 'GET' && url.pathname === '/.well-known/x402.json') return send(res, 200, { version: 2, resources: [paymentRequirement()] });
  if (req.method === 'POST' && url.pathname === '/api/v1/insights') {
    const body = await readJson(req);
    const match = matches.find((item) => item.id === body.matchId);
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!match || question.length < 8 || question.length > 240) return send(res, 400, { error: 'Provide a valid matchId and a question between 8 and 240 characters.' });
    const requirement = paymentRequirement();
    const signature = req.headers['payment-signature'];
    if (!signature) return send(res, 402, { error: 'Payment required', ...requirement }, { 'PAYMENT-REQUIRED': encode(requirement), 'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE' });
    const settlement = await verifyAndSettle(signature, requirement);
    if (!settlement.success) return send(res, 402, { error: settlement.error }, { 'PAYMENT-REQUIRED': encode(requirement) });
    const response = { data: buildInsight(match, question), payment: { amount: '0.01 USDC', network: 'Injective EVM', transaction: settlement.transaction, demo: Boolean(settlement.demo) } };
    return send(res, 200, response, { 'PAYMENT-RESPONSE': encode(settlement), 'Access-Control-Expose-Headers': 'PAYMENT-REQUIRED, PAYMENT-RESPONSE' });
  }
  return send(res, 404, { error: 'API route not found.' });
}

async function staticFile(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const publicFile = /^\/(?:index|app|docs|privacy)\.html$/.test(requested) || requested === '/styles.css' || requested === '/script.js' || /^\/assets\/[a-zA-Z0-9._-]+\.(?:png|svg)$/.test(requested);
  if (!publicFile) return send(res, 404, { error: 'Page not found.' });
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const path = join(root, safePath);
  if (!path.startsWith(root)) return send(res, 403, { error: 'Forbidden' });
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not found');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': /assets/.test(path) ? 'public, max-age=86400' : 'no-cache' });
    res.end(data);
  } catch { send(res, 404, { error: 'Page not found.' }); }
}

export const server = http.createServer(async (req, res) => {
  const requestId = randomUUID();
  securityHeaders(res, requestId);
  if (!allowRequest(req)) return send(res, 429, { error: 'Rate limit exceeded.' }, { 'Retry-After': '60' });
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && req.headers.origin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,PAYMENT-SIGNATURE' }); return res.end(); }
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return await api(req, res, url);
    return await staticFile(req, res, url);
  } catch (error) {
    const status = error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'INVALID_JSON' ? 400 : 500;
    send(res, status, { error: status === 500 ? 'Internal server error.' : error.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateProductionConfig();
  server.listen(port, () => console.log(`GoalGate running at ${origin}`));
}
