/* Função serverless (Vercel) do checkout. O pedido nasce no malbê gestão
   (RPC criar_pedido_site valida preço vigente e estoque NO BANCO — o navegador
   só manda slug e quantidade) e só então o link da InfinitePay é criado, com
   webhook de confirmação, validade de 24h e pagamento único. Com frete, o
   valor é recotado no Melhor Envio aqui e entra como item no link.
   Env: INFINITEPAY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
   MELHOR_ENVIO_TOKEN, FRETE_CEP_ORIGEM. */

const { rpc, logIntegracao, aplicarCors, SITE, baseFuncoes, cotarFrete } = require("./_lib.js");

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

  // Frete opcional: com ele vêm o CEP e o endereço de entrega. O valor é
  // recotado AQUI no Melhor Envio — o navegador só diz qual serviço quer.
  const freteServico = typeof pedido.frete === "string" ? pedido.frete.trim().slice(0, 60) : "";
  const cep = typeof pedido.cep === "string" ? pedido.cep.replace(/\D/g, "") : "";
  const end = (pedido.endereco && typeof pedido.endereco === "object") ? pedido.endereco : {};
  const campo = (x, max) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  const endereco = {
    rua: campo(end.rua, 120), numero: campo(end.numero, 20), complemento: campo(end.complemento, 80),
    bairro: campo(end.bairro, 80), cidade: campo(end.cidade, 80),
  };
  if (freteServico) {
    if (cep.length !== 8) return res.status(400).json({ erro: "CEP inválido." });
    if (!endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade) {
      return res.status(400).json({ erro: "Preencha o endereço de entrega completo." });
    }
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

  // 2) Frete recotado no servidor e gravado no pedido (custo_entrega + endereço).
  let freteCentavos = 0;
  if (freteServico) {
    const cotacao = await cotarFrete(cep, criado.dados.itens.map(i => ({
      quantidade: i.quantidade,
      valorSeguro: i.preco_centavos / 100,
    })), env);
    const opcao = cotacao.ok ? cotacao.opcoes.find(o => o.servico === freteServico) : null;
    if (!opcao) {
      await logIntegracao({ direcao: "checkout", request: { order_nsu, cep, freteServico }, response: cotacao, statusHttp: null, erro: "frete selecionado indisponível na recotação", pedidoId }, env);
      return res.status(400).json({ erro: "O frete escolhido não está mais disponível. Recalcule e tente de novo." });
    }
    freteCentavos = Math.round(opcao.valor * 100);
    const gravou = await fetch(`${env.SUPABASE_URL}/rest/v1/pedidos?id=eq.${pedidoId}`, {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        custo_entrega: freteCentavos,
        entrega_cep: cep,
        entrega_rua: endereco.rua,
        entrega_numero: endereco.numero,
        entrega_complemento: endereco.complemento,
        entrega_bairro: endereco.bairro,
        entrega_cidade: endereco.cidade,
      }),
    }).catch(() => null);
    // Sem o frete gravado a confirmação lançaria o pagamento menor que o cobrado.
    if (!gravou || !gravou.ok) {
      await logIntegracao({ direcao: "checkout", request: { order_nsu, freteCentavos }, response: null, statusHttp: gravou ? gravou.status : null, erro: "não gravou o frete no pedido", pedidoId }, env);
      return res.status(502).json({ erro: "Não deu para registrar o frete. Tente de novo." });
    }
  }

  // 3) Link da InfinitePay com os itens que o BANCO devolveu (+ frete).
  const corpo = {
    order_nsu,
    items: criado.dados.itens.map(i => ({
      quantity: i.quantidade,
      price: i.preco_centavos,
      description: String(i.descricao).slice(0, 100),
    })).concat(freteCentavos > 0 ? [{ quantity: 1, price: freteCentavos, description: `Frete — ${freteServico}`.slice(0, 100) }] : []),
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

  // 4) Guarda o link no pedido (falha aqui não impede a compra).
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
