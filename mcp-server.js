import readline from 'node:readline';

const apiOrigin = process.env.GOALGATE_API_ORIGIN || 'http://127.0.0.1:4173';
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const fail = (id, code, message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);

const tools = [
  { name: 'goalgate_list_matches', description: 'List free live and upcoming football fixtures.', inputSchema: { type: 'object', properties: {} } },
  { name: 'goalgate_get_paid_insight', description: 'Request premium match intelligence. Without a payment signature, returns the x402 requirement.', inputSchema: { type: 'object', required: ['matchId', 'question'], properties: { matchId: { type: 'string' }, question: { type: 'string', minLength: 8, maxLength: 240 }, paymentSignature: { type: 'string' } } } },
  { name: 'goalgate_network_status', description: 'Check Injective EVM status observed by GoalGate.', inputSchema: { type: 'object', properties: {} } },
  { name: 'goalgate_cctp_funding', description: 'Get CCTP destination configuration for USDC funding on Injective.', inputSchema: { type: 'object', properties: {} } }
];

async function callTool(name, args = {}) {
  let path;
  let options = {};
  if (name === 'goalgate_list_matches') path = '/api/v1/matches';
  else if (name === 'goalgate_network_status') path = '/api/v1/network';
  else if (name === 'goalgate_cctp_funding') path = '/api/v1/funding/cctp';
  else if (name === 'goalgate_get_paid_insight') {
    path = '/api/v1/insights';
    const headers = { 'content-type': 'application/json' };
    if (args.paymentSignature) headers['PAYMENT-SIGNATURE'] = args.paymentSignature;
    options = { method: 'POST', headers, body: JSON.stringify({ matchId: args.matchId, question: args.question }) };
  } else throw new Error(`Unknown tool: ${name}`);
  const response = await fetch(`${apiOrigin}${path}`, options);
  const data = await response.json();
  return { content: [{ type: 'text', text: JSON.stringify({ status: response.status, paymentRequired: response.headers.get('payment-required'), data }) }], isError: !response.ok && response.status !== 402 };
}

input.on('line', async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return fail(null, -32700, 'Parse error'); }
  try {
    if (request.method === 'initialize') return reply(request.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'goalgate-mcp', version: '1.0.0' } });
    if (request.method === 'notifications/initialized') return;
    if (request.method === 'tools/list') return reply(request.id, { tools });
    if (request.method === 'tools/call') return reply(request.id, await callTool(request.params?.name, request.params?.arguments));
    return fail(request.id, -32601, 'Method not found');
  } catch (error) { fail(request.id, -32000, error.message); }
});
