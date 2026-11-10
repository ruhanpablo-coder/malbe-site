/* Função serverless (Vercel) que cria um link de pagamento na InfinitePay.
   O preço de cada vinho é lido de produtos.json no servidor: o navegador
   só manda id e quantidade, então ninguém consegue pagar menos editando a URL.
   Requer a variável de ambiente INFINITEPAY_API_KEY no painel da Vercel. */

const fs = require("fs");
const path = require("path");

const SITE = "https://www.malbevinhos.com.br";
const ORIGENS = new Set([SITE, "https://malbevinhos.com.br"]);

module.exports = async (req, res) => {
  const origem = req.headers.origin || "";
  if (ORIGENS.has(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

  const chave = process.env.INFINITEPAY_API_KEY;
  if (!chave) return res.status(500).json({ erro: "INFINITEPAY_API_KEY não configurada." });

  const pedido = (req.body && typeof req.body === "object") ? req.body : {};
  const itens = (pedido.itens && typeof pedido.itens === "object" && !Array.isArray(pedido.itens)) ? pedido.itens : {};
  const nome = typeof pedido.nome === "string" ? pedido.nome.trim().slice(0, 80) : "";

  let catalogo;
  try {
    catalogo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "produtos.json"), "utf8")).produtos || [];
  } catch (e) {
    return res.status(500).json({ erro: "Não foi possível ler o catálogo." });
  }

  const items = [];
  for (const [id, qtd] of Object.entries(itens)) {
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) return res.status(400).json({ erro: "Quantidade inválida." });
    const v = catalogo.find(p => p.id === id && p.ativo !== false && p.disponivel !== false);
    if (!v) return res.status(400).json({ erro: `Vinho indisponível: ${id}` });
    if (!(typeof v.preco === "number" && Number.isFinite(v.preco) && v.preco > 0)) {
      return res.status(400).json({ erro: `Preço sob consulta: peça pelo WhatsApp (${v.nome}).` });
    }
    items.push({ quantity: qtd, price: Math.round(v.preco * 100), description: String(v.nome).slice(0, 100) });
  }
  if (!items.length) return res.status(400).json({ erro: "Carrinho vazio." });
  if (items.length > 50) return res.status(400).json({ erro: "Carrinho grande demais." });

  const order_nsu = `malbe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const corpo = {
    order_nsu,
    items,
    redirect_url: `${SITE}/`,
    options: { payment_methods_enabled: ["credit_card", "pix"] },
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
    return res.status(502).json({ erro: "InfinitePay fora do ar. Tente de novo." });
  }
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
  return res.status(200).json({ url, order_nsu });
};
