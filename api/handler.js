import { randomUUID } from 'node:crypto';

const matches = [
  { id: 'fra-arg', home: 'France', away: 'Argentina', homeCode: 'FRA', awayCode: 'ARG', score: '2 : 1', minute: 72, status: 'live' },
  { id: 'eng-bra', home: 'England', away: 'Brazil', homeCode: 'ENG', awayCode: 'BRA', score: '0 : 0', minute: 38, status: 'live' },
  { id: 'esp-ger', home: 'Spain', away: 'Germany', homeCode: 'ESP', awayCode: 'GER', score: '18:00', minute: null, status: 'upcoming' }
];

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const productionOrigin = process.env.PUBLIC_ORIGIN || 'https://goal-gate.vercel.app';
const requirement = () => ({
  x402Version: 2,
  resource: { url: `${productionOrigin}/api/v1/insights`, description: 'GoalGate premium match intelligence', mimeType: 'application/json' },
  accepts: [{ scheme: 'exact', network: process.env.X402_NETWORK || 'eip155:1776', amount: '10000', asset: process.env.X402_USDC_ASSET || 'CONFIGURE_USDC', payTo: process.env.X402_PAY_TO || 'CONFIGURE_RECIPIENT', maxTimeoutSeconds: 90 }]
});

function route(req) {
  const url = new URL(req.url, productionOrigin);
  const marker = '/api/handler';
  if (url.pathname === marker && url.searchParams.get('path')) return url.searchParams.get('path') === 'well-known-x402' ? '/.well-known/x402.json' : `/api/${url.searchParams.get('path')}`;
  const forwarded = req.headers['x-vercel-rewritten-path'];
  return forwarded || url.pathname;
}

async function verify(signature, paymentRequirement) {
  const facilitator = process.env.X402_FACILITATOR_URL;
  if (!facilitator) return { success: false, error: 'Production payment facilitator is not configured.' };
  const payload = { paymentPayload: signature, paymentRequirements: paymentRequirement.accepts[0] };
  const verified = await fetch(`${facilitator.replace(/\/$/, '')}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  const verification = await verified.json();
  if (!verified.ok || !verification.isValid) return { success: false, error: verification.invalidReason || 'Payment verification failed.' };
  const settled = await fetch(`${facilitator.replace(/\/$/, '')}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
  return settled.json();
}

export default async function handler(req, res) {
  const path = route(req);
  res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  if (req.method === 'GET' && path === '/api/health') return res.status(200).json({ status: 'ok', service: 'goalgate', runtime: 'vercel', timestamp: new Date().toISOString() });
  if (req.method === 'GET' && path === '/api/v1/matches') return res.status(200).json({ data: matches, freshness: new Date().toISOString() });
  if (req.method === 'GET' && path === '/api/v1/funding/cctp') return res.status(200).json({ protocol: 'CCTP', destination: 'Injective', destinationDomain: 29, asset: 'USDC', transferModel: 'burn-attest-mint', tutorial: 'https://docs.injective.network/developers-defi/usdc-cctp-tutorial' });
  if (req.method === 'GET' && path === '/api/v1/network') {
    try {
      const rpc = await fetch(process.env.INJECTIVE_RPC_URL || 'https://sentry.evm-rpc.injective.network/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(3500) });
      const data = await rpc.json();
      return res.status(200).json({ status: data.result ? 'operational' : 'degraded', chainId: 1776, blockNumber: data.result ? Number.parseInt(data.result, 16) : null });
    } catch { return res.status(200).json({ status: 'degraded', chainId: 1776, blockNumber: null }); }
  }
  if (req.method === 'GET' && path === '/.well-known/x402.json') return res.status(200).json({ version: 2, resources: [requirement()] });
  if (req.method === 'GET' && path === '/api/openapi.json') return res.status(200).json({ openapi: '3.1.0', info: { title: 'GoalGate API', version: '1.0.0' }, servers: [{ url: productionOrigin }], paths: { '/api/v1/matches': { get: { summary: 'Free match feed' } }, '/api/v1/insights': { post: { summary: 'x402-paid match insight' } }, '/api/v1/network': { get: { summary: 'Injective network status' } } } });
  if (req.method === 'POST' && path === '/api/v1/insights') {
    const { matchId, question } = req.body || {};
    const match = matches.find((item) => item.id === matchId);
    if (!match || typeof question !== 'string' || question.trim().length < 8 || question.trim().length > 240) return res.status(400).json({ error: 'Provide a valid matchId and question.' });
    const paymentRequirement = requirement();
    const signature = req.headers['payment-signature'];
    if (!signature) { res.setHeader('PAYMENT-REQUIRED', encode(paymentRequirement)); return res.status(402).json({ error: 'Payment required', ...paymentRequirement }); }
    const settlement = await verify(signature, paymentRequirement);
    if (!settlement.success) return res.status(402).json({ error: settlement.error || settlement.errorReason || 'Settlement failed.' });
    const insight = match.id === 'fra-arg' ? "France is creating a right-channel overload. Watch the next transition after Argentina's left-back advances." : 'A high-value transition window is forming behind the first defensive line.';
    res.setHeader('PAYMENT-RESPONSE', encode(settlement));
    return res.status(200).json({ data: { id: randomUUID(), matchId, question: question.trim(), edge: 0.68, confidence: 0.87, signal: 'attacking-overload', summary: insight }, payment: { amount: '0.01 USDC', network: 'Injective EVM', transaction: settlement.transaction, demo: false } });
  }
  return res.status(404).json({ error: 'API route not found.' });
}
