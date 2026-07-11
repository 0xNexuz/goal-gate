---
name: goalgate-agent
description: Fetch GoalGate fixtures, handle x402-paid match intelligence, summarize the result, and produce a concise shareable fan insight.
---

# GoalGate Agent

1. Call `goalgate_list_matches`; let the user choose when no fixture is specified.
2. Ask a focused tactical question between 8 and 240 characters.
3. Call `goalgate_get_paid_insight` without a payment signature to inspect the exact price and network.
4. Never approve or sign a payment without explicit user authorization.
5. After authorization, retry with the wallet-generated x402 `paymentSignature`.
6. Summarize the edge, confidence, sources, payment amount, and receipt status.
7. Label development receipts clearly. Never describe a demo payment as onchain.

For users without USDC on Injective, call `goalgate_cctp_funding` and explain the burn-attest-mint path. Never request a seed phrase or private key.
