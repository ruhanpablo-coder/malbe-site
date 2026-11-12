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

module.exports = { rpc, logIntegracao, aplicarCors, SITE, baseFuncoes };
