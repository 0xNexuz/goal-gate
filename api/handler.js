import { randomUUID } from 'node:crypto';
import { CCTP, INJECTIVE, paymentConfiguration, paymentRequirement, verifyAndSettle } from '../lib/injective.js';

const matches = [
  { id: 'fra-arg', home: 'France', away: 'Argentina', homeCode: 'FRA', awayCode: 'ARG', score: '2 : 1', minute: 72, status: 'live' },
  { id: 'eng-bra', home: 'England', away: 'Brazil', homeCode: 'ENG', awayCode: 'BRA', score: '0 : 0', minute: 38, status: 'live' },
  { id: 'esp-ger', home: 'Spain', away: 'Germany', homeCode: 'ESP', awayCode: 'GER', score: '18:00', minute: null, status: 'upcoming' }
];

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64');
const productionOrigin = process.env.PUBLIC_ORIGIN || 'https://goal-gate.vercel.app';

function route(req) {
  const url = new URL(req.url, productionOrigin);
  const marker = '/api/handler';
  if (url.pathname === marker && url.searchParams.get('path')) return url.searchParams.get('path') === 'well-known-x402' ? '/.well-known/x402.json' : `/api/${url.searchParams.get('path')}`;
  const forwarded = req.headers['x-vercel-rewritten-path'];
  return forwarded || url.pathname;
}

export default async function handler(req, res) {
  const path = route(req);
  res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE');
  if (req.method === 'GET' && path === '/api/health') return res.status(200).json({ status: 'ok', service: 'goalgate', runtime: 'vercel', payments: paymentConfiguration(), timestamp: new Date().toISOString() });
  if (req.method === 'GET' && path === '/api/v1/matches') return res.status(200).json({ data: matches, freshness: new Date().toISOString() });
  if (req.method === 'GET' && path === '/api/v1/funding/cctp') return res.status(200).json({ ...CCTP, usdcContract: INJECTIVE.usdc, note: 'Clients complete the CCTP transfer with a connected wallet. GoalGate does not simulate, custody, or claim a transfer.' });
  if (req.method === 'GET' && path === '/api/v1/network') {
    try {
      const rpc = await fetch(process.env.INJECTIVE_RPC_URL || INJECTIVE.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }), signal: AbortSignal.timeout(3500) });
      const data = await rpc.json();
      return res.status(200).json({ status: data.result ? 'operational' : 'degraded', network: INJECTIVE.name, chainId: INJECTIVE.chainId, blockNumber: data.result ? Number.parseInt(data.result, 16) : null, explorer: INJECTIVE.explorerUrl });
    } catch { return res.status(200).json({ status: 'degraded', network: INJECTIVE.name, chainId: INJECTIVE.chainId, blockNumber: null, explorer: INJECTIVE.explorerUrl }); }
  }
  if (req.method === 'GET' && path === '/.well-known/x402.json') {
    const config = paymentConfiguration();
    return res.status(200).json({ version: 2, ready: config.recipientConfigured && config.facilitatorConfigured, facilitatorMode: config.mode, resources: config.recipientConfigured ? [paymentRequirement(productionOrigin)] : [] });
  }
  if (req.method === 'GET' && path === '/api/openapi.json') return res.status(200).json({ openapi: '3.1.0', info: { title: 'GoalGate API', version: '1.0.0' }, servers: [{ url: productionOrigin }], paths: { '/api/v1/matches': { get: { summary: 'Free match feed' } }, '/api/v1/insights': { post: { summary: 'x402-paid match insight' } }, '/api/v1/network': { get: { summary: 'Injective network status' } } } });
  if (req.method === 'POST' && path === '/api/v1/insights') {
    const { matchId, question } = req.body || {};
    const match = matches.find((item) => item.id === matchId);
    if (!match || typeof question !== 'string' || question.trim().length < 8 || question.trim().length > 240) return res.status(400).json({ error: 'Provide a valid matchId and question.' });
    const config = paymentConfiguration();
    if (!config.recipientConfigured || !config.facilitatorConfigured) return res.status(503).json({ error: 'Onchain payments are not configured yet.', missing: { recipient: !config.recipientConfigured, facilitator: !config.facilitatorConfigured } });
    const challenge = paymentRequirement(productionOrigin);
    const signature = req.headers['payment-signature'];
    if (!signature) { res.setHeader('PAYMENT-REQUIRED', encode(challenge)); return res.status(402).json({ error: 'Payment required', ...challenge }); }
    const settlement = await verifyAndSettle(signature, challenge);
    if (!settlement.success) return res.status(402).json({ error: settlement.error || settlement.errorReason || 'Settlement failed.' });
    const insight = match.id === 'fra-arg' ? "France is creating a right-channel overload. Watch the next transition after Argentina's left-back advances." : 'A high-value transition window is forming behind the first defensive line.';
    res.setHeader('PAYMENT-RESPONSE', encode(settlement));
    return res.status(200).json({ data: { id: randomUUID(), matchId, question: question.trim(), edge: 0.68, confidence: 0.87, signal: 'attacking-overload', summary: insight }, payment: { amount: '0.01 USDC', network: INJECTIVE.name, transaction: settlement.transaction, explorerUrl: `${INJECTIVE.explorerUrl}/tx/${settlement.transaction}`, demo: false } });
  }
  return res.status(404).json({ error: 'API route not found.' });
}
