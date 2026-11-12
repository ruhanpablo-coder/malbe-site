// Checkout: registra o pedido no gestão (preço e estoque validados no banco)
// antes de criar o link da InfinitePay, com webhook, validade e log completo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/checkout.js');

process.env.SUPABASE_URL = 'https://exemplo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-teste';
process.env.INFINITEPAY_API_KEY = 'inf-teste';
process.env.FUNCOES_URL = 'https://malbe-site.vercel.app';

function resFalsa() {
  const res = {
    cab: {}, codigo: null, corpo: null,
    setHeader(k, v) { this.cab[k] = v; },
    status(c) { this.codigo = c; return this; },
    json(o) { this.corpo = o; return this; },
    end() { return this; },
  };
  return res;
}

const REQ = {
  method: 'POST',
  headers: { origin: 'https://www.malbevinhos.com.br' },
  body: { itens: { 'vinho-teste': 2 }, nome: 'Cliente X', telefone: '(47) 99999-1234' },
};

const RPC_OK = {
  pedido_id: 'PED1',
  total_centavos: 1000,
  itens: [{ descricao: 'Vinho Teste', quantidade: 2, preco_centavos: 500 }],
};

function fetchFalso(t, { rpcResposta, infiniteResposta } = {}) {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes = {}) => {
    const u = String(url);
    chamadas.push({ url: u, corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
    if (u.includes('/rpc/criar_pedido_site')) {
      const r = rpcResposta || { status: 200, corpo: RPC_OK };
      return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
    }
    if (u.includes('infinitepay.io/links')) {
      const r = infiniteResposta || { status: 200, corpo: { url: 'https://pay.infinitepay.io/abc' } };
      return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
    }
    return { ok: true, status: 204, json: async () => null };
  });
  return chamadas;
}

test('pedido criado no banco e link com webhook, validade e pagamento único', async t => {
  const chamadas = fetchFalso(t);
  const res = resFalsa();
  await handler(REQ, res);
  assert.equal(res.codigo, 200);
  assert.ok(res.corpo.url.startsWith('https://pay.infinitepay.io/'));

  const rpc = chamadas.find(c => c.url.includes('/rpc/criar_pedido_site'));
  assert.deepEqual(rpc.corpo.p_itens, [{ slug: 'vinho-teste', quantidade: 2 }]);
  assert.equal(rpc.corpo.p_cliente_nome, 'Cliente X');

  const inf = chamadas.find(c => c.url.includes('infinitepay.io/links'));
  // preço vem da RPC (banco), nunca do navegador nem do produtos.json
  assert.deepEqual(inf.corpo.items, [{ quantity: 2, price: 500, description: 'Vinho Teste' }]);
  assert.deepEqual(inf.corpo.webhook, {
    url: 'https://malbe-site.vercel.app/api/webhook-infinitepay',
    events: ['paid', 'refunded', 'canceled'],
  });
  assert.equal(inf.corpo.options.single_payment, true);
  assert.ok(new Date(inf.corpo.options.valid_until) > new Date(), 'valid_until precisa estar no futuro');

  const patch = chamadas.find(c => c.url.includes('/pedidos?id=eq.PED1'));
  assert.equal(patch.corpo.checkout_url, 'https://pay.infinitepay.io/abc');

  const log = chamadas.find(c => c.url.includes('/integracao_logs'));
  assert.equal(log.corpo.direcao, 'checkout');
  assert.deepEqual(log.corpo.response, { url: 'https://pay.infinitepay.io/abc' });
  assert.equal(log.corpo.request.items[0].price, 500);
});

test('erro do banco (estoque) vira 400 sem chamar a InfinitePay', async t => {
  const chamadas = fetchFalso(t, { rpcResposta: { status: 400, corpo: { message: 'Estoque insuficiente de Vinho Teste.' } } });
  const res = resFalsa();
  await handler(REQ, res);
  assert.equal(res.codigo, 400);
  assert.equal(res.corpo.erro, 'Estoque insuficiente de Vinho Teste.');
  assert.ok(!chamadas.some(c => c.url.includes('infinitepay.io')), 'não pode chamar a InfinitePay');
});

test('InfinitePay 422 vira 502 e o body do erro fica no log', async t => {
  const chamadas = fetchFalso(t, { infiniteResposta: { status: 422, corpo: { message: 'invalid' } } });
  const res = resFalsa();
  await handler(REQ, res);
  assert.equal(res.codigo, 502);
  const log = chamadas.find(c => c.url.includes('/integracao_logs'));
  assert.deepEqual(log.corpo.response, { message: 'invalid' });
  assert.equal(log.corpo.status_http, 422);
});

test('body inválido continua recusado', async t => {
  fetchFalso(t);
  const res = resFalsa();
  await handler({ ...REQ, body: { itens: { x: 0 } } }, res);
  assert.equal(res.codigo, 400);
});

test('sem nome recusa com 400 antes de chamar o banco', async t => {
  const chamadas = fetchFalso(t);
  const res = resFalsa();
  await handler({ ...REQ, body: { itens: { 'vinho-teste': 1 }, nome: ' ', telefone: '47999991234' } }, res);
  assert.equal(res.codigo, 400);
  assert.match(res.corpo.erro, /nome/i);
  assert.ok(!chamadas.some(c => c.url.includes('/rpc/')), 'não devia chamar o banco');
});

test('sem WhatsApp válido recusa com 400', async t => {
  fetchFalso(t);
  for (const telefone of [undefined, '', '1234', 'abcdefghijk']) {
    const res = resFalsa();
    await handler({ ...REQ, body: { itens: { 'vinho-teste': 1 }, nome: 'Cliente X', telefone } }, res);
    assert.equal(res.codigo, 400, `telefone ${JSON.stringify(telefone)} devia ser recusado`);
    assert.match(res.corpo.erro, /whatsapp/i);
  }
});

test('telefone vai para o banco só com dígitos', async t => {
  const chamadas = fetchFalso(t);
  await handler(REQ, resFalsa());
  const rpc = chamadas.find(c => c.url.includes('/rpc/criar_pedido_site'));
  assert.equal(rpc.corpo.p_cliente_telefone, '47999991234');
});
