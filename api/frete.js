/* Função serverless (Vercel) que cota o frete no Melhor Envio (Correios, Jadlog etc.).
   O navegador manda o CEP de destino e os itens (id + quantidade); o peso, as medidas
   e o valor segurado são calculados aqui a partir de produtos.json, então o cliente
   não consegue forjar um pacote mais leve. Requer no painel da Vercel:
   - MELHOR_ENVIO_TOKEN: token gerado em melhorenvio.com.br (Integrações > Tokens)
   - FRETE_CEP_ORIGEM: CEP de onde as garrafas saem, só dígitos
   - MELHOR_ENVIO_EMAIL (opcional): e-mail de contato técnico exigido no User-Agent */

const fs = require("fs");
const path = require("path");

const SITE = "https://www.malbevinhos.com.br";
const ORIGENS = new Set([SITE, "https://malbevinhos.com.br"]);

/* garrafa de 750 ml embalada para transporte */
const GARRAFA = { peso: 1.5, largura: 12, altura: 40, comprimento: 12 };

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

  const token = process.env.MELHOR_ENVIO_TOKEN;
  const cepOrigem = (process.env.FRETE_CEP_ORIGEM || "").replace(/\D/g, "");
  if (!token || cepOrigem.length !== 8) {
    return res.status(500).json({ erro: "Frete não configurado (MELHOR_ENVIO_TOKEN / FRETE_CEP_ORIGEM)." });
  }

  const pedido = (req.body && typeof req.body === "object") ? req.body : {};
  const cep = typeof pedido.cep === "string" ? pedido.cep.replace(/\D/g, "") : "";
  if (cep.length !== 8) return res.status(400).json({ erro: "CEP inválido." });
  const itens = (pedido.itens && typeof pedido.itens === "object" && !Array.isArray(pedido.itens)) ? pedido.itens : {};

  let catalogo;
  try {
    catalogo = JSON.parse(fs.readFileSync(path.join(process.cwd(), "produtos.json"), "utf8")).produtos || [];
  } catch (e) {
    return res.status(500).json({ erro: "Não foi possível ler o catálogo." });
  }

  const products = [];
  for (const [id, qtd] of Object.entries(itens)) {
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) return res.status(400).json({ erro: "Quantidade inválida." });
    const v = catalogo.find(p => p.id === id && p.ativo !== false && p.disponivel !== false);
    if (!v) return res.status(400).json({ erro: `Vinho indisponível: ${id}` });
    products.push({
      id,
      quantity: qtd,
      weight: GARRAFA.peso,
      width: GARRAFA.largura,
      height: GARRAFA.altura,
      length: GARRAFA.comprimento,
      insurance_value: typeof v.preco === "number" && v.preco > 0 ? v.preco : 0,
    });
  }
  if (!products.length) return res.status(400).json({ erro: "Carrinho vazio." });

  let resposta, dados;
  try {
    resposta = await fetch("https://melhorenvio.com.br/api/v2/me/shipment/calculate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": `Malbê Vinhos (${process.env.MELHOR_ENVIO_EMAIL || SITE})`,
      },
      body: JSON.stringify({
        from: { postal_code: cepOrigem },
        to: { postal_code: cep },
        products,
      }),
    });
    dados = await resposta.json();
  } catch (e) {
    return res.status(502).json({ erro: "Cotação indisponível agora. Tente de novo." });
  }
  if (!resposta.ok || !Array.isArray(dados)) {
    console.error("Melhor Envio recusou:", resposta.status, JSON.stringify(dados));
    return res.status(502).json({ erro: "Não deu para cotar o frete. Combine a entrega pelo WhatsApp." });
  }

  const opcoes = dados
    .filter(s => !s.error && s.price)
    .map(s => ({
      servico: `${s.company && s.company.name ? s.company.name + " " : ""}${s.name}`.trim(),
      valor: Number(s.price),
      prazo_dias: Number(s.delivery_time) || null,
    }))
    .filter(o => Number.isFinite(o.valor) && o.valor > 0)
    .sort((a, b) => a.valor - b.valor);

  if (!opcoes.length) return res.status(200).json({ opcoes: [], aviso: "Nenhuma transportadora atende esse CEP. Combine a entrega pelo WhatsApp." });
  return res.status(200).json({ opcoes });
};
