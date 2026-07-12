import { randomUUID } from 'node:crypto';
import { decodePaymentSignatureHeader } from '@injectivelabs/x402/client';
import { InjectiveFacilitator } from '@injectivelabs/x402/facilitator';
import { createFacilitatorRequest } from '@injectivelabs/x402/protocol';
import { SettleResponseSchema, VerifyResponseSchema } from '@injectivelabs/x402/schemas';

export const INJECTIVE = Object.freeze({
  name: 'Injective EVM Testnet',
  chainId: 1439,
  network: 'eip155:1439',
  rpcUrl: 'https://k8s.testnet.json-rpc.injective.network/',
  explorerUrl: 'https://testnet.blockscout.injective.network',
  usdc: '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d'
});

export const CCTP = Object.freeze({
  protocol: 'CCTP V2',
  destination: 'Injective EVM Testnet',
  destinationDomain: 29,
  asset: 'USDC',
  transferModel: 'burn-attest-mint',
  tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
  messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
  tokenMinter: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
  tutorial: 'https://docs.injective.network/developers-defi/usdc-cctp-tutorial'
});

const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const authorizationUsedTopic = '0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5';
const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
let localFacilitator;

export function paymentConfiguration() {
  const payTo = process.env.X402_PAY_TO || '';
  const facilitatorUrl = process.env.X402_FACILITATOR_URL || '';
  const facilitatorPrivateKey = process.env.X402_FACILITATOR_PRIVATE_KEY || '';
  return {
    payTo,
    recipientConfigured: addressPattern.test(payTo) && !/^0x0{40}$/i.test(payTo),
    facilitatorConfigured: Boolean(facilitatorUrl || /^0x[a-fA-F0-9]{64}$/.test(facilitatorPrivateKey)),
    mode: facilitatorUrl ? 'remote' : facilitatorPrivateKey ? 'embedded' : 'unconfigured'
  };
}

export function paymentRequirement(origin, { allowDemoRecipient = false } = {}) {
  const config = paymentConfiguration();
  const payTo = config.recipientConfigured ? config.payTo : allowDemoRecipient ? '0x0000000000000000000000000000000000000001' : '';
  return {
    x402Version: 2,
    resource: { url: `${origin}/api/v1/insights`, description: 'GoalGate premium match intelligence', mimeType: 'application/json' },
    accepts: [{
      scheme: 'exact',
      network: process.env.X402_NETWORK || INJECTIVE.network,
      amount: '10000',
      asset: process.env.X402_USDC_ASSET || INJECTIVE.usdc,
      payTo,
      maxTimeoutSeconds: 90,
      extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009' }
    }]
  };
}

function getLocalFacilitator() {
  const privateKey = process.env.X402_FACILITATOR_PRIVATE_KEY;
  if (!privateKey) return null;
  if (!localFacilitator) {
    const asset = (process.env.X402_USDC_ASSET || INJECTIVE.usdc).toLowerCase();
    localFacilitator = new InjectiveFacilitator({
      privateKey,
      rpcUrl: process.env.INJECTIVE_RPC_URL || INJECTIVE.rpcUrl,
      confirmations: 1,
      allowedAssets: [asset],
      minPaymentPerAsset: { [asset]: '10000' }
    });
  }
  return localFacilitator;
}

async function callRemote(path, request, schema, timeout) {
  const base = process.env.X402_FACILITATOR_URL;
  if (!base) throw new Error('No remote x402 facilitator is configured.');
  const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createFacilitatorRequest(request)),
    signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw new Error(`Facilitator ${path} failed with HTTP ${response.status}.`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`Facilitator ${path} returned an invalid x402 response.`);
  return parsed.data;
}

async function rpcCall(method, params) {
  const response = await fetch(process.env.INJECTIVE_RPC_URL || INJECTIVE.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5000)
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `RPC ${method} failed.`);
  return payload.result;
}

const addressTopic = (address) => `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;

function validTransferReceipt(receipt, request) {
  if (!receipt || receipt.status !== '0x1') return false;
  const requirements = request.paymentRequirements;
  const authorization = request.paymentPayload.payload.authorization;
  return receipt.logs?.some((log) =>
    log.address?.toLowerCase() === requirements.asset.toLowerCase()
    && log.topics?.[0]?.toLowerCase() === transferTopic
    && log.topics?.[1]?.toLowerCase() === addressTopic(authorization.from)
    && log.topics?.[2]?.toLowerCase() === addressTopic(requirements.payTo)
    && BigInt(log.data || '0x0') === BigInt(requirements.amount)
  );
}

async function recoverSettlement(request, attempts = 1) {
  const requirements = request.paymentRequirements;
  const authorization = request.paymentPayload.payload.authorization;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const latestHex = await rpcCall('eth_blockNumber', []);
      const latest = BigInt(latestHex);
      const fromBlock = latest > 20_000n ? latest - 20_000n : 0n;
      const logs = await rpcCall('eth_getLogs', [{
        address: requirements.asset,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: 'latest',
        topics: [authorizationUsedTopic, addressTopic(authorization.from), authorization.nonce]
      }]);
      for (const log of [...(logs || [])].reverse()) {
        const receipts = await rpcCall('eth_getBlockReceipts', [log.blockNumber]);
        const receipt = receipts?.find((item) => item.transactionHash?.toLowerCase() === log.transactionHash?.toLowerCase());
        if (validTransferReceipt(receipt, request)) {
          return {
            success: true,
            transaction: log.transactionHash,
            network: requirements.network,
            payer: authorization.from,
            amount: requirements.amount,
            recovered: true,
            extra: { blockNumber: BigInt(log.blockNumber).toString(), receiptMethod: 'eth_getBlockReceipts' }
          };
        }
      }
    } catch {
      // The standard facilitator result remains authoritative if recovery is unavailable.
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 650));
  }
  return null;
}

export async function verifyAndSettle(signatureHeader, requirement, { demo = false } = {}) {
  if (demo && signatureHeader === 'demo') {
    return { success: true, transaction: `demo_${randomUUID()}`, network: requirement.accepts[0].network, demo: true };
  }

  let paymentPayload;
  try {
    paymentPayload = decodePaymentSignatureHeader(signatureHeader);
  } catch {
    return { success: false, error: 'Invalid PAYMENT-SIGNATURE header encoding.' };
  }

  const request = { paymentPayload, paymentRequirements: requirement.accepts[0] };
  try {
    const facilitator = getLocalFacilitator();
    const verification = facilitator
      ? await facilitator.verify(request)
      : await callRemote('verify', request, VerifyResponseSchema, 8000);
    if (!verification.isValid) {
      if (verification.invalidReason === 'nonce_already_used' || verification.invalidReason === 'payment_expired') {
        const recovered = await recoverSettlement(request);
        if (recovered) return recovered;
      }
      return { success: false, error: verification.invalidMessage || verification.invalidReason || 'Payment verification failed.' };
    }

    const settlement = facilitator
      ? await facilitator.settle(request)
      : await callRemote('settle', request, SettleResponseSchema, 15000);
    if (!settlement.success) {
      const recovered = await recoverSettlement(request, 4);
      if (recovered) return recovered;
      return { success: false, error: settlement.errorMessage || settlement.errorReason || 'Payment settlement failed.' };
    }
    return settlement;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Payment facilitator failed.' };
  }
}
