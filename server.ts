import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Heartbeat & Tracking
app.all('/api/heartbeat', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/track', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/checkout/initiate', (req, res) => {
  res.json({ ok: true });
});

// In-memory store for transaction statuses (synced via SigiloPay API and Webhooks)
interface TransactionRecord {
  id: string;
  identifier: string;
  amount: number;
  status: 'PENDING' | 'AUTHORIZED' | 'FAILED';
  rawStatus?: string;
  client?: any;
  createdAt: number;
}

const transactions = new Map<string, TransactionRecord>();

// Helper to normalize document / phone digits
function onlyDigits(str: string | undefined | null): string {
  return (str || '').replace(/\D/g, '');
}

// Helper to parse EMV tags for fallback info
function parseEmvTag(emv: string, tag: string): string | null {
  let i = 0;
  while (i + 4 <= emv.length) {
    const t = emv.substring(i, i + 2);
    const len = parseInt(emv.substring(i + 2, i + 4), 10);
    if (isNaN(len) || i + 4 + len > emv.length) break;
    const val = emv.substring(i + 4, i + 4 + len);
    if (t === tag) return val;
    i += 4 + len;
  }
  return null;
}

// SigiloPay Webhook endpoint
app.all(['/api/sigilopay/webhook', '/api/webhook'], (req, res) => {
  const body = req.body || {};
  console.log('[SigiloPay Webhook Received]:', JSON.stringify(body));

  const event = body.event;
  const transaction = body.transaction || {};
  const tid = transaction.id || body.transactionId || body.id;
  const status = (transaction.status || body.status || '').toUpperCase();

  const isPaid =
    event === 'TRANSACTION_PAID' ||
    event === 'TRANSACTION_COMPLETED' ||
    status === 'COMPLETED' ||
    status === 'PAID' ||
    status === 'AUTHORIZED' ||
    status === 'SETTLED';

  if (tid) {
    const record: TransactionRecord = transactions.get(tid) || {
      id: String(tid),
      identifier: transaction.identifier || String(tid),
      amount: Number(transaction.amount || 0),
      status: 'PENDING',
      rawStatus: 'PENDING',
      createdAt: Date.now(),
    };

    if (isPaid) {
      record.status = 'AUTHORIZED';
      record.rawStatus = status || 'COMPLETED';
      transactions.set(String(tid), record);
      if (record.identifier) {
        transactions.set(record.identifier, record);
      }
      console.log(`[SigiloPay Webhook] Transação ${tid} marcada como PAGA/AUTHORIZED!`);
    }
  }

  return res.status(200).json({
    ok: true,
    saved: isPaid,
    transactionId: tid,
  });
});

// Simulation endpoint for test purposes (dev/testing)
app.post('/api/pix/simulate-payment/:id', (req, res) => {
  const id = req.params.id;
  const record = transactions.get(id) || {
    id,
    identifier: id,
    amount: 0,
    status: 'PENDING',
    createdAt: Date.now(),
  };
  record.status = 'AUTHORIZED';
  record.rawStatus = 'AUTHORIZED';
  transactions.set(id, record);
  if (record.identifier) {
    transactions.set(record.identifier, record);
  }
  return res.json({ ok: true, message: `Transação ${id} marcada como paga para testes!`, record });
});

// Pix Create: SigiloPay Official Gateway with resilient fallback
app.post('/api/pix/create', async (req, res) => {
  const {
    orderId,
    price,
    name,
    email,
    cpf,
    phone,
    title,
    slug,
  } = req.body || {};

  const cleanCpf = onlyDigits(cpf);
  const cleanPhone = onlyDigits(phone);
  const amount = Number(price || 5.0);
  const amountFixed = amount.toFixed(2);
  const identifier = 'arremata_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;
  const apiBase = (process.env.SIGILOPAY_API_BASE || 'https://app.sigilopay.com.br/api/v1').replace(/\/+$/, '');

  // If SigiloPay keys are configured, call SigiloPay API
  if (publicKey && secretKey) {
    try {
      let appUrl = process.env.APP_URL;
      if (!appUrl || appUrl === 'MY_APP_URL' || appUrl.includes('localhost') || !appUrl.startsWith('https://')) {
        const origin = req.get('origin') || req.get('referer');
        if (origin && origin.startsWith('https://')) {
          try {
            const parsed = new URL(origin);
            appUrl = `${parsed.protocol}//${parsed.host}`;
          } catch {}
        }
      }
      if (!appUrl || appUrl.includes('localhost') || !appUrl.startsWith('https://')) {
        appUrl = 'https://ais-dev-avmmifxm3cemjuhfriqfv6-100192407616.us-east1.run.app';
      }

      const callbackUrl = `${appUrl.replace(/\/+$/, '')}/api/sigilopay/webhook`;

      const sigiloPayload = {
        identifier,
        amount: Number(amountFixed),
        client: {
          name: (name || 'Cliente Arremata').trim(),
          email: (email || 'cliente@arremata.com').trim(),
          phone: cleanPhone.length >= 10 ? cleanPhone : '11999999999',
          document: cleanCpf.length === 11 ? cleanCpf : '88448785347',
        },
        callbackUrl,
      };

      console.log('[SigiloPay] Enviando solicitação Pix para:', `${apiBase}/gateway/pix/receive`);

      const remoteResp = await fetch(`${apiBase}/gateway/pix/receive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-public-key': publicKey,
          'x-secret-key': secretKey,
          'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        },
        body: JSON.stringify(sigiloPayload),
      });

      const httpCode = remoteResp.status;
      const respJson: any = await remoteResp.json().catch(() => null);

      if (httpCode >= 200 && httpCode < 300 && respJson) {
        const transactionId = String(respJson.transactionId || respJson.id || identifier);
        const pixNode = respJson.pix || respJson.order?.pix || respJson;

        const pixCode =
          pixNode.code ||
          pixNode.payload ||
          pixNode.emv ||
          pixNode.qrCode ||
          pixNode.qrcode ||
          '';

        let qrDataUrl = '';
        if (pixNode.base64) {
          qrDataUrl = pixNode.base64.startsWith('data:image')
            ? pixNode.base64
            : `data:image/png;base64,${pixNode.base64}`;
        } else if (pixNode.image || pixNode.imageUrl || pixNode.qrCodeImageUrl) {
          qrDataUrl = pixNode.image || pixNode.imageUrl || pixNode.qrCodeImageUrl;
        } else if (pixCode) {
          qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(pixCode)}`;
        }

        // Store transaction in memory
        const record: TransactionRecord = {
          id: transactionId,
          identifier,
          amount,
          status: 'PENDING',
          rawStatus: 'PENDING',
          client: sigiloPayload.client,
          createdAt: Date.now(),
        };
        transactions.set(transactionId, record);
        transactions.set(identifier, record);

        console.log(`[SigiloPay] Pix gerado com sucesso! TID: ${transactionId}`);

        return res.json({
          id: transactionId,
          externalId: identifier,
          qrDataUrl,
          payload: pixCode,
        });
      } else {
        const errorMsg = respJson?.message || respJson?.errorDescription || respJson?.error || 'Erro na resposta da SigiloPay';
        console.error('[SigiloPay API Error]:', httpCode, respJson);
        // If SigiloPay rejected or failed, notify user
        return res.status(400).json({ error: errorMsg });
      }
    } catch (apiErr: any) {
      console.error('[SigiloPay Network Error]:', apiErr);
      return res.status(500).json({ error: 'Falha de comunicação com a SigiloPay. Tente novamente.' });
    }
  }

  // Fallback: When keys are not yet configured in environment
  console.log('[Pix Create] SIGILOPAY_PUBLIC_KEY / SIGILOPAY_SECRET_KEY não configuradas. Gerando Pix de demonstração.');
  const mockId = String(Math.floor(10000 + Math.random() * 90000));
  const mockExternalId = 'arremata-' + Date.now();
  const pixPayload = `00020101021226820014br.gov.bcb.pix2560pix.stone.com.br/pix/v2/${mockExternalId}520400005303986540${amountFixed.length < 10 ? '0' + amountFixed.length : amountFixed.length}${amountFixed}5802BR5925Pagar Me Instituicao De P6014RIO DE JANEIRO62290525${mockExternalId}6304`;
  const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=0&data=${encodeURIComponent(pixPayload)}`;

  const record: TransactionRecord = {
    id: mockId,
    identifier: mockExternalId,
    amount,
    status: 'PENDING',
    rawStatus: 'PENDING',
    createdAt: Date.now(),
  };
  transactions.set(mockId, record);
  transactions.set(mockExternalId, record);

  return res.json({
    id: mockId,
    externalId: mockExternalId,
    qrDataUrl,
    payload: pixPayload,
  });
});

// Pix Status: Check status with SigiloPay and local memory
app.get('/api/pix/status/:id', async (req, res) => {
  const transactionId = req.params.id;
  const record = transactions.get(transactionId);

  // If already authorized locally (e.g. via webhook)
  if (record && record.status === 'AUTHORIZED') {
    return res.json({
      status: 'AUTHORIZED',
      rawStatus: record.rawStatus || 'AUTHORIZED',
      paid: true,
    });
  }

  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;
  const apiBase = (process.env.SIGILOPAY_API_BASE || 'https://app.sigilopay.com.br/api/v1').replace(/\/+$/, '');

  // If keys are present, poll SigiloPay transactions endpoint
  if (publicKey && secretKey) {
    try {
      const remoteResp = await fetch(`${apiBase}/gateway/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-public-key': publicKey,
          'x-secret-key': secretKey,
          'User-Agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
        },
        body: JSON.stringify({
          transactionId,
        }),
      });

      if (remoteResp.ok) {
        const data: any = await remoteResp.json().catch(() => null);
        const status = (data?.status || data?.transaction?.status || '').toUpperCase();
        if (
          status === 'COMPLETED' ||
          status === 'PAID' ||
          status === 'AUTHORIZED' ||
          status === 'SETTLED'
        ) {
          if (record) {
            record.status = 'AUTHORIZED';
            record.rawStatus = status;
          }
          return res.json({
            status: 'AUTHORIZED',
            rawStatus: status,
            paid: true,
          });
        }
        return res.json({
          status: 'PENDING',
          rawStatus: status || 'PENDING',
          paid: false,
        });
      }
    } catch (err) {
      console.error('[SigiloPay Status Query Error]:', err);
    }
  }

  return res.json({
    status: record ? record.status : 'PENDING',
    rawStatus: record ? record.rawStatus || 'PENDING' : null,
    paid: record ? record.status === 'AUTHORIZED' : false,
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      // Check if direct html file exists
      const requestedPath = req.path.replace(/^\//, '');
      const candidatePath = path.join(distPath, requestedPath);
      if (requestedPath && path.extname(requestedPath) === '.html' && path.isAbsolute(candidatePath)) {
        return res.sendFile(candidatePath);
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
