/* Função serverless (Vercel) do checkout. O pedido nasce no malbê gestão
   (RPC criar_pedido_site valida preço vigente e estoque NO BANCO — o navegador
   só manda slug e quantidade) e só então o link da InfinitePay é criado, com
   webhook de confirmação, validade de 24h e pagamento único.
   Env: INFINITEPAY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. */

const { rpc, logIntegracao, aplicarCors, SITE, baseFuncoes } = require("./_lib.js");

module.exports = async (req, res) => {
  if (aplicarCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

  const env = process.env;
  const chave = env.INFINITEPAY_API_KEY;
  if (!chave) return res.status(500).json({ erro: "INFINITEPAY_API_KEY não configurada." });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ erro: "Integração com o gestão não configurada." });
  }

  const pedido = (req.body && typeof req.body === "object") ? req.body : {};
  const itens = (pedido.itens && typeof pedido.itens === "object" && !Array.isArray(pedido.itens)) ? pedido.itens : {};
  const nome = typeof pedido.nome === "string" ? pedido.nome.trim().slice(0, 80) : "";
  // Contato obrigatório: sem nome e WhatsApp não há como combinar a entrega.
  const telefone = (typeof pedido.telefone === "string" ? pedido.telefone : "").replace(/\D/g, "").slice(0, 13);
  if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
  if (telefone.length < 10 || telefone.length > 13) {
    return res.status(400).json({ erro: "Informe um WhatsApp válido, com DDD." });
  }

  const lista = [];
  for (const [slug, qtd] of Object.entries(itens)) {
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) return res.status(400).json({ erro: "Quantidade inválida." });
    lista.push({ slug, quantidade: qtd });
  }
  if (!lista.length) return res.status(400).json({ erro: "Carrinho vazio." });
  if (lista.length > 50) return res.status(400).json({ erro: "Carrinho grande demais." });

  const order_nsu = `malbe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // 1) Pedido no gestão: preço e estoque validados no banco.
  const criado = await rpc("criar_pedido_site", { p_order_nsu: order_nsu, p_cliente_nome: nome, p_itens: lista, p_cliente_telefone: telefone }, env);
  if (!criado.ok) {
    const mensagem = (criado.dados && criado.dados.message) || "Não foi possível registrar o pedido.";
    await logIntegracao({ direcao: "checkout", request: { order_nsu, itens: lista }, response: criado.dados, statusHttp: criado.status, erro: mensagem }, env);
    return res.status(400).json({ erro: mensagem.replace(/^.*?: /, (m) => m).trim() });
  }
  const pedidoId = criado.dados.pedido_id;

  // 2) Link da InfinitePay com os itens que o BANCO devolveu.
  const corpo = {
    order_nsu,
    items: criado.dados.itens.map(i => ({
      quantity: i.quantidade,
      price: i.preco_centavos,
      description: String(i.descricao).slice(0, 100),
    })),
    redirect_url: `${SITE}/`,
    webhook: { url: `${baseFuncoes(env)}/api/webhook-infinitepay`, events: ["paid", "refunded", "canceled"] },
    options: {
      payment_methods_enabled: ["credit_card", "pix"],
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      single_payment: true,
    },
  };
  if (nome) corpo.customer = { name: nome };

  let resposta, dados;
  try {
    resposta = await fetch("https://api.checkout.infinitepay.io/links", {
      method: "POST",
      headers: { "X-Api-Key": chave, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    dados = await resposta.json();
  } catch (e) {
    await logIntegracao({ direcao: "checkout", request: corpo, response: null, statusHttp: null, erro: String(e), pedidoId }, env);
    return res.status(502).json({ erro: "InfinitePay fora do ar. Tente de novo." });
  }
  await logIntegracao({ direcao: "checkout", request: corpo, response: dados, statusHttp: resposta.status, erro: resposta.ok ? "" : "InfinitePay recusou", pedidoId }, env);
  if (!resposta.ok) {
    console.error("InfinitePay recusou:", resposta.status, JSON.stringify(dados));
    return res.status(502).json({ erro: "A InfinitePay recusou o pedido. Tente de novo ou peça pelo WhatsApp." });
  }

  const url = [dados.url, dados.link, dados.checkout_url, dados.payment_url]
    .find(u => typeof u === "string" && u.startsWith("https://"));
  if (!url) {
    console.error("Resposta sem URL:", JSON.stringify(dados));
    return res.status(502).json({ erro: "Resposta inesperada da InfinitePay." });
  }

  // 3) Guarda o link no pedido (falha aqui não impede a compra).
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ checkout_url: url }),
    });
  } catch (e) { /* o log do checkout já tem a URL */ }

  return res.status(200).json({ url, order_nsu });
};
