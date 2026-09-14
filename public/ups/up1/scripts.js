document.querySelectorAll('.size-btn').forEach(button => {
    button.addEventListener('click', function() {
      document.querySelectorAll('.size-btn').forEach(btn => btn.classList.remove('active'));
      this.classList.add('active');
    });
  });
  
  function showAd2() {
    document.getElementById('ad1').style.display = 'none';
    document.getElementById('ad2').style.display = 'block';
  
    setTimeout(() => {
      document.getElementById('loadingGif').style.display = 'none';
      document.getElementById('text1').classList.remove('hidden');
  
      setTimeout(() => {
        document.getElementById('loadingGif2').classList.remove('hidden');
  
        setTimeout(() => {
          document.getElementById('loadingGif2').style.display = 'none';
          document.getElementById('text2').classList.remove('hidden');
  
          setTimeout(() => {
            document.getElementById('loadingGif3').classList.remove('hidden');
  
            setTimeout(() => {
              document.getElementById('loadingGif3').style.display = 'none';
              document.getElementById('text3').classList.remove('hidden');
  
              setTimeout(() => {
                document.getElementById('finalButton').classList.remove('hidden');
              }, 2000);
            }, 4000);
          }, 2000);
        }, 2000);
      }, 2000);
    }, 3000);
  }
  
  let pixIsOpen = false;
  let pixIsLoading = false;
  let lastPixCode = '';
  let lastPixTx = '';
  let lastPixAmount = 0;
  let statusTimer = null;
  
  function $(id) {
    return document.getElementById(id);
  }
  
  function setPixState(state) {
    $('pixStateLoading').style.display = state === 'loading' ? 'block' : 'none';
    $('pixStateSuccess').style.display = state === 'success' ? 'block' : 'none';
    $('pixStateError').style.display = state === 'error' ? 'block' : 'none';
  }
  
  function openPixModal() {
    $('pixModalOverlay').style.display = 'flex';
    pixIsOpen = true;
  }
  
  function closePixModal() {
    $('pixModalOverlay').style.display = 'none';
    pixIsOpen = false;
    stopStatusPolling();
  }
  
  function getUtmObject() {
    const qs = window.location.search.replace(/^\?/, '');
    if (!qs) return {};
    const p = new URLSearchParams(qs);
    const out = {};
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','src'].forEach(k => {
      const v = p.get(k);
      if (v) out[k] = v;
    });
    return out;
  }
  
  function formatBRL(v) {
    try {
      return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } catch (e) {
      return 'R$ ' + String(v).replace('.', ',');
    }
  }
  
  function makeQrUrl(pixCode) {
    const data = encodeURIComponent(pixCode || '');
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${data}`;
  }
  
  // Recupera o comprador salvo no checkout principal (js/checkout.js) para
  // reutilizar o mesmo CPF/dados ao gerar a cobrança do upsell na Mangofy.
  function getStoredBuyer() {
    try {
      return JSON.parse(localStorage.getItem('arremata_buyer') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function upsellOrderId() {
    return 'up1-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  async function gerarPix(amount) {
    const buyer = getStoredBuyer();
    const utm = getUtmObject();

    const res = await fetch('/api/pix/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: upsellOrderId(),
        slug: 'upsell-up1',
        title: 'Taxa de regularização do pedido',
        price: Number(amount),
        name: buyer.name,
        email: buyer.email,
        cpf: buyer.cpf,
        phone: buyer.phone,
        source: utm.utm_source,
        medium: utm.utm_medium,
        campaign: utm.utm_campaign
      })
    });

    const json = await res.json().catch(() => null);

    if (!res.ok || !json || !json.payload) {
      const msg = (json && json.error) ? json.error : `Erro ao gerar PIX (HTTP ${res.status})`;
      throw new Error(msg);
    }

    return {
      pix_code: json.payload,
      transaction_id: json.id || '',
      amount: amount
    };
  }

  async function consultarStatus(transactionId) {
    const url = `/api/pix/status/${encodeURIComponent(transactionId)}`;
    const res = await fetch(url, { method: 'GET' });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json) {
      return { ok: false, paid: false, raw: json, http: res.status };
    }

    return { ok: true, paid: json.status === 'AUTHORIZED', status: json.status || '', data: json };
  }
  
  function stopStatusPolling() {
    if (statusTimer) {
      clearInterval(statusTimer);
      statusTimer = null;
    }
  }
  
  function startStatusPolling(transactionId) {
    stopStatusPolling();
  
    statusTimer = setInterval(async () => {
      if (!pixIsOpen) return;
  
      const r = await consultarStatus(transactionId);
  
      if (r.ok && r.paid) {
        stopStatusPolling();
        window.location.href = '../up2/index.html' + window.location.search;
      }
    }, 4000);
  }
  
  async function openPixTenf(amount) {
    if (pixIsLoading) return;
  
    lastPixAmount = Number(amount) || 0;
    openPixModal();
    setPixState('loading');
    pixIsLoading = true;
  
    try {
      const data = await gerarPix(lastPixAmount);
  
      lastPixCode = data.pix_code;
      lastPixTx = data.transaction_id || '';
  
      $('pixAmountLabel').textContent = `Valor: ${formatBRL(Number(data.amount || lastPixAmount))}`;
      $('pixTxLabel').textContent = lastPixTx ? `Transação: ${lastPixTx}` : '';
      $('pixCodeBox').value = lastPixCode;
      $('pixQrImg').src = makeQrUrl(lastPixCode);
      $('pixToast').style.display = 'none';
  
      setPixState('success');
  
      if (lastPixTx) startStatusPolling(lastPixTx);
    } catch (e) {
      $('pixErrorMsg').textContent = e && e.message ? e.message : 'Erro desconhecido.';
      setPixState('error');
    } finally {
      pixIsLoading = false;
    }
  }
  
  function wirePixModal() {
    const overlay = $('pixModalOverlay');
    if (!overlay) return;
  
    $('pixCloseBtn').addEventListener('click', closePixModal);
    $('pixCloseBtn2').addEventListener('click', closePixModal);
  
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePixModal();
    });
  
    $('pixCopyBtn').addEventListener('click', async () => {
      const text = $('pixCodeBox').value || '';
      if (!text) return;
  
      try {
        await navigator.clipboard.writeText(text);
        $('pixToast').style.display = 'block';
        setTimeout(() => { $('pixToast').style.display = 'none'; }, 1800);
      } catch (e) {
        $('pixCodeBox').focus();
        $('pixCodeBox').select();
        document.execCommand('copy');
        $('pixToast').style.display = 'block';
        setTimeout(() => { $('pixToast').style.display = 'none'; }, 1800);
      }
    });
  
    $('pixOpenBankBtn').addEventListener('click', () => {
      if (!lastPixCode) return;
      $('pixCodeBox').focus();
      $('pixCodeBox').select();
    });
  
    $('pixRetryBtn').addEventListener('click', () => {
      openPixTenf(lastPixAmount || 27.13);
    });
  
    document.addEventListener('keydown', (e) => {
      if (!pixIsOpen) return;
      if (e.key === 'Escape') closePixModal();
    });
  }
  
  document.addEventListener('DOMContentLoaded', wirePixModal);
  