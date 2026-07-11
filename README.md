# GoalGate

Production-oriented football intelligence service with free match data and x402-paid premium insights settled in USDC on Injective EVM.

## Run locally

```bash
npm start
```

Open `http://localhost:4173`. Development mode accepts the explicit `PAYMENT-SIGNATURE: demo` value so the complete interface can be tested without moving funds. Every demo receipt is labeled as development-only.

## Production configuration

Copy `.env.example` into your deployment environment and configure:

- `PUBLIC_ORIGIN`: canonical HTTPS origin.
- `ALLOWED_ORIGIN`: allowed browser origin for CORS.
- `X402_PAY_TO`: EVM address receiving USDC.
- `X402_USDC_ASSET`: official Injective USDC contract address for the selected network.
- `X402_FACILITATOR_URL`: x402 v2 facilitator supporting `eip155:1776`.
- `GOALGATE_DEMO_PAYMENTS=false`.

Production startup fails when required payment configuration is missing. Never deploy with the placeholder asset or recipient values.

## API

- `GET /api/health`
- `GET /api/v1/network`
- `GET /api/v1/matches`
- `GET /api/v1/funding/cctp`
- `POST /api/v1/insights`
- `GET /api/openapi.json`
- `GET /.well-known/x402.json`

The premium route returns `402 Payment Required` and a Base64-encoded `PAYMENT-REQUIRED` header. Clients retry with `PAYMENT-SIGNATURE`; successful settlement returns `PAYMENT-RESPONSE`.

## MCP and agent skill

Run the stdio MCP server with `npm run mcp`. It exposes match, paid insight, network status, and CCTP funding tools. The reusable workflow is documented in `skills/goalgate-agent/SKILL.md`.

## Test

```bash
npm test
```
