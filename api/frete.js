/* Função serverless (Vercel) que cota o frete no Melhor Envio (só Correios por
   enquanto — ver TRANSPORTADORAS_PERMITIDAS em _lib.js). O navegador manda o
   CEP de destino e os itens (id + quantidade); o peso, as medidas e o valor
   segurado são calculados aqui a partir de produtos.json, então o cliente não
   consegue forjar um pacote mais leve. Requer no painel da Vercel:
   - MELHOR_ENVIO_TOKEN: token gerado em melhorenvio.com.br (Integrações > Tokens)
   - FRETE_CEP_ORIGEM: CEP de onde as garrafas saem, só dígitos
   - MELHOR_ENVIO_EMAIL (opcional): e-mail de contato técnico exigido no User-Agent */

const fs = require("fs");
const path = require("path");
const { aplicarCors, cotarFrete } = require("./_lib.js");

module.exports = async (req, res) => {
  if (aplicarCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

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

  const pacote = [];
  for (const [id, qtd] of Object.entries(itens)) {
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 999) return res.status(400).json({ erro: "Quantidade inválida." });
    const v = catalogo.find(p => p.id === id && p.ativo !== false && p.disponivel !== false);
    if (!v) return res.status(400).json({ erro: `Vinho indisponível: ${id}` });
    pacote.push({ quantidade: qtd, valorSeguro: typeof v.preco === "number" ? v.preco : 0 });
  }
  if (!pacote.length) return res.status(400).json({ erro: "Carrinho vazio." });

  const cotacao = await cotarFrete(cep, pacote, process.env);
  if (!cotacao.ok) return res.status(502).json({ erro: cotacao.erro });
  if (!cotacao.opcoes.length) {
    return res.status(200).json({ opcoes: [], aviso: "Nenhuma transportadora atende esse CEP. Combine a entrega pelo WhatsApp." });
  }
  return res.status(200).json({ opcoes: cotacao.opcoes });
};
