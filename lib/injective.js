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
      return { success: false, error: verification.invalidMessage || verification.invalidReason || 'Payment verification failed.' };
    }

    const settlement = facilitator
      ? await facilitator.settle(request)
      : await callRemote('settle', request, SettleResponseSchema, 15000);
    if (!settlement.success) {
      return { success: false, error: settlement.errorMessage || settlement.errorReason || 'Payment settlement failed.' };
    }
    return settlement;
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Payment facilitator failed.' };
  }
}
