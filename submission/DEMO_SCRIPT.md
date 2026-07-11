# GoalGate Demo Video Script

Target runtime: 2 minutes 30 seconds. Record at 1080p with the browser at 100% zoom. Keep the wallet account on Injective EVM Testnet and show the explorer receipt without exposing private keys or seed phrases.

## Before recording

- Open `https://goal-gate-beta.vercel.app` in one tab.
- Open the GitHub README in a second tab.
- Fund the payer wallet with testnet USDC and a small amount of testnet INJ if the wallet requires it.
- Confirm `GET /api/health` reports both payment settings as configured.
- Confirm `GET /api/v1/matches` reports `source.live: true` and `source.fallback: false`.
- Complete one practice payment and keep its Injective Blockscout URL ready.
- Hide unrelated browser extensions, bookmarks, notifications, and wallet balances.

## 0:00-0:18 | Problem

Visual: Start on the GoalGate hero. Move slowly toward the live product panel.

Narration:

> World Cup fans and autonomous agents often need one useful answer, not another account, subscription, or permanent API key. Premium sports intelligence is fragmented, difficult to verify, and awkward to buy one request at a time.

On-screen emphasis: `One question. No subscription. No API key.`

## 0:18-0:35 | Solution

Visual: Scroll through the product and proof sections, then select Launch app.

Narration:

> GoalGate turns live World Cup data into a pay-per-query intelligence service. Fixtures remain free. A focused tactical answer costs exactly one cent in USDC and is unlocked through the open x402 HTTP payment protocol on Injective EVM.

## 0:35-1:15 | Product walkthrough

Visual: Show the live fixture list. Briefly reveal the Network status, select the current match, enter “Where is the next high-value opening?”, and press Check price.

Narration:

> The app reads current FIFA World Cup 2026 scoreboard data, including score, match clock, venue, possession, and shots on target. The free request validates the question and returns HTTP 402 with the exact network, official testnet USDC contract, amount, recipient, and expiry.

Visual: Pause on the `0.01 USDC` payment panel, then click Approve and unlock. Show MetaMask or Rabby switching to Injective EVM Testnet and the EIP-712 authorization. Never show a private key.

Narration:

> My wallet signs a narrowly scoped EIP-3009 authorization. The facilitator pays the INJ gas, verifies the signature, settles USDC to GoalGate, and releases the answer only after settlement succeeds.

## 1:15-1:35 | Onchain proof

Visual: Show the returned insight, click View transaction, and hold on Injective Blockscout long enough to show status, USDC transfer, sender, recipient, and transaction hash.

Narration:

> This is not an app credit or simulated checkout. The response includes the Injective transaction receipt, creating a verifiable audit trail for a human, script, or autonomous agent.

## 1:35-2:08 | Sponsor integrations

Visual: Open the API docs, then show `/.well-known/x402.json`, `/api/v1/funding/cctp`, the MCP server file, and the Agent Skill in GitHub.

Narration:

> x402 gates the premium endpoint and settles native USDC on Injective. CCTP exposes Injective domain 29 and the official TokenMessenger, MessageTransmitter, and TokenMinter contracts so wallets and agents can prepare cross-chain USDC funding. The GoalGate MCP server makes fixtures, network status, CCTP configuration, and paid insights available as tools. The Agent Skill packages the complete workflow, including explicit consent before any payment signature.

On-screen emphasis: `x402 + CCTP + MCP Server + Agent Skills`

## 2:08-2:30 | Why it matters and close

Visual: Return to the hero, with the live app and GitHub URLs visible.

Narration:

> GoalGate shows why fast, low-cost settlement matters: information becomes purchasable at the moment it is needed, without registration or subscriptions. Today it serves World Cup fans. The same architecture can support analysts, broadcasters, fantasy tools, and agent-to-agent data markets. GoalGate is live, open source, and built on Injective.

End card:

`GoalGate`  
`goal-gate-beta.vercel.app`  
`github.com/0xNexuz/goal-gate`  
`Pay for the answer, not the subscription.`
