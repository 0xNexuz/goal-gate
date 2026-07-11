const header = document.querySelector('[data-header]');
const navToggle = document.querySelector('[data-nav-toggle]');
const toast = document.querySelector('[data-toast]');

function notify(message, type = 'info') {
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('show');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('show'), 4200);
}

navToggle?.addEventListener('click', () => {
  const open = header.classList.toggle('is-open');
  navToggle.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.nav a').forEach((link) => link.addEventListener('click', () => {
  header?.classList.remove('is-open');
  navToggle?.setAttribute('aria-expanded', 'false');
}));

document.querySelectorAll('[data-launch-app]').forEach((button) => button.addEventListener('click', () => { window.location.href = './app.html'; }));

const reveals = document.querySelectorAll('main > section, .product-note, .developer-points article');
if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  reveals.forEach((element) => element.classList.add('reveal'));
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('revealed'); observer.unobserve(entry.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -40px' });
  reveals.forEach((element) => observer.observe(element));
}

document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = 'Copied'; notify('Code copied to clipboard.', 'success'); }
  catch { notify('Clipboard access was blocked. Select the code manually.', 'error'); }
}));

const baseUrl = document.querySelector('[data-base-url]');
if (baseUrl) baseUrl.textContent = `${window.location.origin}/api/v1`;

const matchList = document.querySelector('[data-match-list]');
const activeMatch = document.querySelector('[data-active-match]');
const insightForm = document.querySelector('[data-insight-form]');
const paymentPanel = document.querySelector('[data-payment-panel]');
const paymentNote = document.querySelector('[data-payment-note]');
const insightOutput = document.querySelector('[data-insight-output]');
const approveButton = document.querySelector('[data-approve-payment]');
let selectedMatch = null;
let pendingRequest = null;
const INJECTIVE_TESTNET_CHAIN_ID = '0x59f';
const INJECTIVE_TESTNET_USDC = '0x0c382e685bbeefe5d3d9c29e29e341fee8e84c5d';

const encodeBase64Json = (value) => window.btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

async function connectInjectiveWallet() {
  if (!window.ethereum) throw new Error('Install MetaMask or Rabby to authorize the USDC payment.');
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: INJECTIVE_TESTNET_CHAIN_ID }] });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: INJECTIVE_TESTNET_CHAIN_ID,
        chainName: 'Injective EVM Testnet',
        nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
        rpcUrls: ['https://k8s.testnet.json-rpc.injective.network/'],
        blockExplorerUrls: ['https://testnet.blockscout.injective.network']
      }]
    });
  }
  const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!account) throw new Error('No wallet account was selected.');
  const walletStatus = document.querySelector('[data-wallet-status]');
  if (walletStatus) walletStatus.textContent = `${account.slice(0, 6)}...${account.slice(-4)}`;
  return account;
}

async function createPaymentSignature(challenge) {
  const accepted = challenge?.accepts?.[0];
  const validRecipient = /^0x[a-fA-F0-9]{40}$/.test(accepted?.payTo || '');
  if (accepted?.network !== 'eip155:1439' || accepted?.asset?.toLowerCase() !== INJECTIVE_TESTNET_USDC || accepted?.amount !== '10000' || !validRecipient) {
    throw new Error('The payment quote does not match GoalGate testnet policy.');
  }

  const from = await connectInjectiveWallet();
  const now = Math.floor(Date.now() / 1000);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const authorization = {
    from,
    to: accepted.payTo,
    value: accepted.amount,
    validAfter: String(now - 30),
    validBefore: String(now + Math.min(accepted.maxTimeoutSeconds || 90, 300)),
    nonce: `0x${Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  };
  const typedData = {
    domain: { name: accepted.extra?.name || 'USDC', version: accepted.extra?.version || '2', chainId: 1439, verifyingContract: accepted.asset },
    primaryType: 'TransferWithAuthorization',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
      ]
    },
    message: authorization
  };
  const signature = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [from, JSON.stringify(typedData)] });
  return encodeBase64Json({
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: { signature, authorization }
  });
}

function renderActiveMatch(match) {
  selectedMatch = match;
  activeMatch.innerHTML = `<span>${match.status.toUpperCase()}${match.minute ? ` · ${match.minute}'` : ''}</span><strong>${match.homeCode} <b>${match.score}</b> ${match.awayCode}</strong><small>${match.home} vs ${match.away}</small>`;
  matchList.querySelectorAll('button').forEach((button) => button.classList.toggle('selected', button.dataset.matchId === match.id));
  paymentPanel.hidden = true;
  insightOutput.hidden = true;
}

async function loadWorkspace() {
  if (!matchList) return;
  try {
    const response = await fetch('/api/v1/matches');
    if (!response.ok) throw new Error('Match feed unavailable');
    const { data, source } = await response.json();
    if (source?.fallback) notify('Live provider is unavailable. Showing the verified World Cup schedule fallback.', 'info');
    matchList.innerHTML = '';
    data.forEach((match) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.matchId = match.id;
      button.innerHTML = `<span>${match.status === 'live' ? `LIVE · ${match.minute}'` : 'UPCOMING'}</span><strong>${match.homeCode} <b>${match.score}</b> ${match.awayCode}</strong>`;
      button.addEventListener('click', () => renderActiveMatch(match));
      matchList.append(button);
    });
    if (data[0]) renderActiveMatch(data[0]);
  } catch (error) {
    matchList.innerHTML = '<p class="load-error">The live feed is unavailable. Start the GoalGate server and retry.</p>';
    notify(error.message, 'error');
  }
}

async function requestInsight(paymentSignature) {
  const question = document.querySelector('#app-query')?.value.trim();
  const headers = { 'content-type': 'application/json' };
  if (paymentSignature) headers['PAYMENT-SIGNATURE'] = paymentSignature;
  return fetch('/api/v1/insights', { method: 'POST', headers, body: JSON.stringify({ matchId: selectedMatch?.id, question }) });
}

insightForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedMatch) return notify('Select a match first.', 'error');
  const submit = insightForm.querySelector('button[type="submit"]');
  submit.disabled = true; submit.textContent = 'CHECKING...';
  try {
    const response = await requestInsight();
    const body = await response.json();
    if (response.status !== 402) throw new Error(body.error || 'Expected an x402 price challenge.');
    pendingRequest = body;
    document.querySelector('[data-payment-price]').textContent = body.accepts?.[0]?.amount === '10000' ? '0.01 USDC' : 'USDC payment';
    paymentNote.textContent = 'Your wallet signs an exact 0.01 USDC authorization. The facilitator pays gas and settles on Injective testnet.';
    paymentPanel.hidden = false;
    paymentPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { notify(error.message, 'error'); }
  finally { submit.disabled = false; submit.textContent = 'CHECK PRICE'; }
});

approveButton?.addEventListener('click', async () => {
  if (!pendingRequest) return;
  approveButton.disabled = true; approveButton.textContent = 'CONNECTING...';
  try {
    const localDemo = ['localhost', '127.0.0.1'].includes(window.location.hostname) && !window.ethereum;
    const paymentSignature = localDemo ? 'demo' : await createPaymentSignature(pendingRequest);
    approveButton.textContent = 'SETTLING...';
    const response = await requestInsight(paymentSignature);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Payment could not be verified. Configure a facilitator for production.');
    const { data, payment } = body;
    const explorerUrl = typeof payment.explorerUrl === 'string' && payment.explorerUrl.startsWith('https://testnet.blockscout.injective.network/tx/') ? payment.explorerUrl : null;
    const receipt = explorerUrl ? `<a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noreferrer">View transaction</a>` : '<span>Development receipt</span>';
    insightOutput.innerHTML = `<header><span>EDGE ${Math.round(data.edge * 100)}%</span><b>${escapeHtml(data.signal)}</b></header><p>${escapeHtml(data.summary)}</p><footer><span>Confidence ${Math.round(data.confidence * 100)}%</span><span>${escapeHtml(payment.amount)}</span>${receipt}</footer>`;
    insightOutput.hidden = false;
    paymentPanel.hidden = true;
    insightOutput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    notify('Insight unlocked.', 'success');
  } catch (error) { notify(error.message, 'error'); paymentNote.textContent = error.message; }
  finally { approveButton.disabled = false; approveButton.textContent = 'APPROVE & UNLOCK'; }
});

const network = document.querySelector('[data-network]');
if (network) fetch('/api/v1/network').then((response) => response.json()).then((data) => {
  network.classList.toggle('degraded', data.status !== 'operational');
  network.querySelector('span').textContent = data.status === 'operational' ? `Injective · block ${data.blockNumber.toLocaleString()}` : 'Injective RPC degraded';
}).catch(() => { network.classList.add('degraded'); network.querySelector('span').textContent = 'Network unavailable'; });

loadWorkspace();
