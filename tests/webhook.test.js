// Webhook da InfinitePay: sem assinatura, então todo aviso é confirmado no
// payment_check antes de virar venda; idempotente; loga tudo, até payload inválido.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/webhook-infinitepay.js');

process.env.SUPABASE_URL = 'https://exemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-teste';
process.env.INFINITEPAY_HANDLE = 'malbe';
process.env.GESTAO_URL = 'https://malbe-gestao.vercel.app';
process.env.INTEGRACAO_SECRET = 'segredo';

function resFalsa() {
  return {
    codigo: null, corpo: null,
    setHeader() {},
    status(c) { this.codigo = c; return this; },
    json(o) { this.corpo = o; return this; },
    end() { return this; },
  };
}

const PAYLOAD = {
  invoice_slug: 'abc123', amount: 1000, paid_amount: 1000, installments: 1,
  capture_method: 'pix', transaction_nsu: 'TX1', order_nsu: 'malbe-1', receipt_url: 'https://r/1',
};

function fetchFalso(t, { paid = true, confirmacao, falhaSupabase } = {}) {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes = {}) => {
    const u = String(url);
    chamadas.push({ url: u, corpo: opcoes.body ? JSON.parse(opcoes.body) : null, headers: opcoes.headers || {} });
    if (u.includes('payment_check')) return { ok: true, status: 200, json: async () => ({ success: true, paid, amount: 1000, paid_amount: 1000 }) };
    if (u.includes('/rpc/confirmar_pedido_site')) {
      if (falhaSupabase) return { ok: false, status: 500, json: async () => ({ message: 'banco fora' }) };
      return { ok: true, status: 200, json: async () => (confirmacao || { venda_id: 'V9', esgotou: false, repetido: false }) };
    }
    if (u.includes('/rpc/estornar_pedido_site')) return { ok: true, status: 200, json: async () => null };
    return { ok: true, status: 201, json: async () => null };
  });
  return chamadas;
}

const req = (body, extra = {}) => ({ method: 'POST', headers: {}, body, ...extra });

test('paid confirmado no payment_check vira venda e responde 200', async t => {
  const chamadas = fetchFalso(t);
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 200);
  const check = chamadas.find(c => c.url.includes('payment_check'));
  assert.deepEqual(check.corpo, { handle: 'malbe', order_nsu: 'malbe-1', transaction_nsu: 'TX1', slug: 'abc123' });
  const conf = chamadas.find(c => c.url.includes('confirmar_pedido_site'));
  assert.equal(conf.corpo.p_order_nsu, 'malbe-1');
  assert.equal(conf.corpo.p_transaction_nsu, 'TX1');
  const logs = chamadas.filter(c => c.url.includes('integracao_logs')).map(c => c.corpo.direcao);
  assert.ok(logs.includes('webhook') && logs.includes('payment_check'));
});

test('reenvio do mesmo webhook responde 200 sem duplicar (RPC idempotente)', async t => {
  const chamadas = fetchFalso(t, { confirmacao: { venda_id: 'V9', esgotou: false, repetido: true } });
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 200);
  assert.equal(chamadas.filter(c => c.url.includes('confirmar_pedido_site')).length, 1);
});

test('payment_check sem paid:true responde 200 e nada confirma', async t => {
  const chamadas = fetchFalso(t, { paid: false });
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 200);
  assert.ok(!chamadas.some(c => c.url.includes('confirmar_pedido_site')), 'não pode confirmar');
  const log = chamadas.filter(c => c.url.includes('integracao_logs')).map(c => c.corpo).find(l => l.direcao === 'payment_check');
  assert.ok(log.erro, 'log do payment_check sem erro registrado');
});

test('payload sem campos essenciais → 400 e log mesmo assim', async t => {
  const chamadas = fetchFalso(t);
  const res = resFalsa();
  await handler(req({ qualquer: 1 }), res);
  assert.equal(res.codigo, 400);
  const log = chamadas.find(c => c.url.includes('integracao_logs'));
  assert.equal(log.corpo.direcao, 'webhook');
  assert.deepEqual(log.corpo.request, { qualquer: 1 });
});

test('evento refunded/canceled NÃO estorna sozinho (sem como verificar): só loga', async t => {
  // O webhook não tem assinatura e o payment_check só prova pagamento: um
  // refunded forjado não pode devolver estoque nem apagar receita.
  const chamadas = fetchFalso(t);
  const res = resFalsa();
  await handler(req({ ...PAYLOAD, event: 'refunded' }), res);
  assert.equal(res.codigo, 200);
  assert.ok(!chamadas.some(c => c.url.includes('estornar_pedido_site')), 'estorno automático é forjável');
  assert.ok(!chamadas.some(c => c.url.includes('confirmar_pedido_site')));
  const log = chamadas.filter(c => c.url.includes('integracao_logs')).map(c => c.corpo).find(l => l.erro);
  assert.ok(log, 'evento não tratado precisa ficar no log com erro');
});

test('esgotou não republica dentro do webhook (cron cobre); notificação sai', async t => {
  const chamadas = fetchFalso(t, { confirmacao: { venda_id: 'V9', esgotou: true, repetido: false } });
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 200);
  assert.ok(!chamadas.some(c => c.url.includes('/api/publicar-site')), 'republicar no webhook estoura o prazo de 1s');
  const notif = chamadas.find(c => c.url === 'https://malbe-gestao.vercel.app/api/notificar');
  assert.ok(notif, 'notificação ausente');
  assert.equal(notif.headers['x-integracao-secret'], 'segredo');
});

test('payment_check fora do ar (não-2xx) → 500 para a InfinitePay reenviar', async t => {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes = {}) => {
    const u = String(url);
    chamadas.push({ url: u });
    if (u.includes('payment_check')) return { ok: false, status: 503, json: async () => ({ erro: 'manutenção' }) };
    return { ok: true, status: 201, json: async () => null };
  });
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 500);
  assert.ok(!chamadas.some(c => c.url.includes('confirmar_pedido_site')));
});

test('sem INFINITEPAY_HANDLE configurado → 500, nunca confirma às cegas', async t => {
  const antigo = process.env.INFINITEPAY_HANDLE;
  delete process.env.INFINITEPAY_HANDLE;
  fetchFalso(t);
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  process.env.INFINITEPAY_HANDLE = antigo;
  assert.equal(res.codigo, 500);
});

test('falha da Supabase na confirmação → 500 (InfinitePay reenvia)', async t => {
  fetchFalso(t, { falhaSupabase: true });
  const res = resFalsa();
  await handler(req(PAYLOAD), res);
  assert.equal(res.codigo, 500);
});
