/* Helpers compartilhados pelas funções Vercel do site: RPC na Supabase com a
   service role, log de integração com o JSON completo (nunca lança) e CORS. */

const SITE = "https://www.malbevinhos.com.br";
const ORIGENS = new Set([SITE, "https://malbevinhos.com.br"]);

/* Base onde ESTAS funções rodam. O domínio malbevinhos.com.br é GitHub Pages
   (um POST lá responde 405): o webhook precisa apontar para a Vercel. */
function baseFuncoes(env) {
  return env.FUNCOES_URL || "https://malbe-site.vercel.app";
}

function cabecalhos(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
}

/* Chama uma função do banco (PostgREST). Devolve { ok, status, dados }. */
async function rpc(nome, args, env) {
  const resposta = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: cabecalhos(env),
    body: JSON.stringify(args || {}),
  });
  let dados = null;
  try { dados = await resposta.json(); } catch (e) { /* respostas sem corpo */ }
  return { ok: resposta.ok, status: resposta.status, dados };
}

/* Grava em integracao_logs; falha de log nunca derruba o fluxo. */
async function logIntegracao({ direcao, request, response, statusHttp, erro, pedidoId }, env) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/integracao_logs`, {
      method: "POST",
      headers: cabecalhos(env),
      body: JSON.stringify({
        direcao,
        request: request ?? null,
        response: response ?? null,
        status_http: statusHttp ?? null,
        erro: erro || "",
        pedido_id: pedidoId || null,
      }),
    });
  } catch (e) { /* sem rede, sem log */ }
}

/* CORS do site; devolve true quando a requisição era OPTIONS e já foi respondida. */
function aplicarCors(req, res) {
  const origem = (req.headers && req.headers.origin) || "";
  if (ORIGENS.has(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

/* ===== Frete (Melhor Envio) ===== */

/* garrafa de 750 ml embalada para transporte */
const GARRAFA = { peso: 1.5, largura: 12, altura: 40, comprimento: 12 };

/* só Correios por enquanto: aceitam bebida alcoólica em vidro bem embalada e
   têm agência na cidade; demais transportadoras ficam fora até liberação */
const TRANSPORTADORAS_PERMITIDAS = /^correios/i;

/* Cota o frete no Melhor Envio. itens = [{ quantidade, valorSeguro }] (uma
   entrada por vinho; valorSeguro em reais). Devolve { ok, opcoes } com
   [{ servico, valor, prazo_dias }] ordenado por preço, ou { ok: false, erro }.
   Env: MELHOR_ENVIO_TOKEN, FRETE_CEP_ORIGEM, MELHOR_ENVIO_EMAIL (opcional). */
async function cotarFrete(cepDestino, itens, env) {
  const token = env.MELHOR_ENVIO_TOKEN;
  const cepOrigem = (env.FRETE_CEP_ORIGEM || "").replace(/\D/g, "");
  if (!token || cepOrigem.length !== 8) {
    return { ok: false, erro: "Frete não configurado (MELHOR_ENVIO_TOKEN / FRETE_CEP_ORIGEM)." };
  }

  const products = itens.map((i, n) => ({
    id: String(n),
    quantity: i.quantidade,
    weight: GARRAFA.peso,
    width: GARRAFA.largura,
    height: GARRAFA.altura,
    length: GARRAFA.comprimento,
    insurance_value: Number.isFinite(i.valorSeguro) && i.valorSeguro > 0 ? i.valorSeguro : 0,
  }));

  let resposta, dados;
  try {
    resposta = await fetch("https://melhorenvio.com.br/api/v2/me/shipment/calculate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": `Malbê Vinhos (${env.MELHOR_ENVIO_EMAIL || SITE})`,
      },
      body: JSON.stringify({
        from: { postal_code: cepOrigem },
        to: { postal_code: cepDestino },
        products,
      }),
    });
    dados = await resposta.json();
  } catch (e) {
    return { ok: false, erro: "Cotação indisponível agora. Tente de novo." };
  }
  if (!resposta.ok || !Array.isArray(dados)) {
    console.error("Melhor Envio recusou:", resposta.status, JSON.stringify(dados));
    return { ok: false, erro: "Não deu para cotar o frete. Combine a entrega pelo WhatsApp." };
  }

  const opcoes = dados
    .filter(s => !s.error && s.price)
    .filter(s => TRANSPORTADORAS_PERMITIDAS.test((s.company && s.company.name) || ""))
    .map(s => ({
      servico: `${s.company && s.company.name ? s.company.name + " " : ""}${s.name}`.trim(),
      valor: Number(s.price),
      prazo_dias: Number(s.delivery_time) || null,
    }))
    .filter(o => Number.isFinite(o.valor) && o.valor > 0)
    .sort((a, b) => a.valor - b.valor);

  return { ok: true, opcoes };
}

module.exports = { rpc, logIntegracao, aplicarCors, SITE, baseFuncoes, cotarFrete };
