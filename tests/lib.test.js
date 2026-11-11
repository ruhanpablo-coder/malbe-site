// Helpers das funções Vercel do site: RPC na Supabase, log de integração
// (nunca lança) e CORS compartilhado.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rpc, logIntegracao, aplicarCors } = require('../api/_lib.js');

const ENV = { SUPABASE_URL: 'https://exemplo.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'chave-teste' };

function fetchFalso(t, resposta) {
  const chamadas = [];
  t.mock.method(globalThis, 'fetch', async (url, opcoes) => {
    chamadas.push({ url: String(url), opcoes });
    if (resposta instanceof Error) throw resposta;
    return { ok: resposta.status < 400, status: resposta.status, json: async () => resposta.corpo };
  });
  return chamadas;
}

test('rpc chama o PostgREST com a service role e devolve os dados', async t => {
  const chamadas = fetchFalso(t, { status: 200, corpo: { pedido_id: 'P1' } });
  const r = await rpc('criar_pedido_site', { p_order_nsu: 'x' }, ENV);
  assert.deepEqual(r, { ok: true, status: 200, dados: { pedido_id: 'P1' } });
  assert.equal(chamadas[0].url, 'https://exemplo.supabase.co/rest/v1/rpc/criar_pedido_site');
  assert.equal(chamadas[0].opcoes.method, 'POST');
  assert.equal(chamadas[0].opcoes.headers.apikey, 'chave-teste');
  assert.equal(chamadas[0].opcoes.headers.Authorization, 'Bearer chave-teste');
  assert.deepEqual(JSON.parse(chamadas[0].opcoes.body), { p_order_nsu: 'x' });
});

test('rpc devolve ok false e a mensagem do banco em erro', async t => {
  fetchFalso(t, { status: 400, corpo: { message: 'Estoque insuficiente de X.' } });
  const r = await rpc('criar_pedido_site', {}, ENV);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.dados.message, 'Estoque insuficiente de X.');
});

test('logIntegracao grava o JSON completo e engole falha de rede', async t => {
  const chamadas = fetchFalso(t, { status: 201, corpo: null });
  await logIntegracao({ direcao: 'checkout', request: { a: 1 }, response: { b: 2 }, statusHttp: 200, pedidoId: 'P1' }, ENV);
  assert.ok(chamadas[0].url.endsWith('/rest/v1/integracao_logs'));
  const corpo = JSON.parse(chamadas[0].opcoes.body);
  assert.deepEqual(corpo.request, { a: 1 });
  assert.deepEqual(corpo.response, { b: 2 });
  assert.equal(corpo.status_http, 200);
  assert.equal(corpo.pedido_id, 'P1');

  fetchFalso(t, new Error('rede caiu'));
  await assert.doesNotReject(() => logIntegracao({ direcao: 'webhook', request: {} }, ENV));
});

test('aplicarCors espelha a origem permitida e responde OPTIONS', () => {
  const cab = {};
  const res = { setHeader: (k, v) => { cab[k] = v; }, status(c) { this.codigo = c; return this; }, end() { this.terminou = true; return this; } };
  const tratado = aplicarCors({ method: 'OPTIONS', headers: { origin: 'https://www.malbevinhos.com.br' } }, res);
  assert.equal(tratado, true);
  assert.equal(cab['Access-Control-Allow-Origin'], 'https://www.malbevinhos.com.br');
  assert.equal(res.codigo, 204);

  const cab2 = {};
  const res2 = { setHeader: (k, v) => { cab2[k] = v; }, status(c) { this.codigo = c; return this; }, end() { return this; } };
  const tratado2 = aplicarCors({ method: 'POST', headers: { origin: 'https://invasor.com' } }, res2);
  assert.equal(tratado2, false);
  assert.equal(cab2['Access-Control-Allow-Origin'], undefined);
});
