// Monta mistral.json: uma cópia enxuta do catálogo público da Mistral,
// usada pelo painel (admin.html) para preencher vinhos pelo nome.
// Lê só páginas de listagem permitidas pelo robots.txt deles, com pausa entre pedidos.
// Uso: node scripts/catalogo-mistral.mjs
import { writeFile } from "node:fs/promises";

const LISTAGENS = [
  "https://www.mistral.com.br/pais/argentina",
];
const PAUSA_MS = 1500;
const MAX_PAGINAS = 20;

const dormir = ms => new Promise(r => setTimeout(r, ms));

/* lê um objeto JSON começando em `inicio`, respeitando chaves dentro de textos */
function lerObjeto(texto, inicio){
  let nivel = 0, emTexto = false, escape = false;
  for(let i = inicio; i < texto.length; i++){
    const c = texto[i];
    if(emTexto){
      if(escape) escape = false;
      else if(c === "\\") escape = true;
      else if(c === '"') emTexto = false;
      continue;
    }
    if(c === '"') emTexto = true;
    else if(c === "{") nivel++;
    else if(c === "}" && --nivel === 0) return texto.slice(inicio, i + 1);
  }
  return null;
}

function extrairProdutos(html){
  const achados = [];
  const marca = /\{"id":\d+,"slug":"/g;
  let m;
  while((m = marca.exec(html))){
    const bruto = lerObjeto(html, m.index);
    if(!bruto) continue;
    try{
      const o = JSON.parse(bruto);
      if(o.objectID && o.title && o.image_link) achados.push(o);
      marca.lastIndex = m.index + bruto.length;
    }catch{ /* trecho que não é produto */ }
  }
  return achados;
}

/* texto limpo e com tamanho máximo; o catálogo vem de outro site, então nada é confiável */
const texto = (x, max) => typeof x === "string" ? x.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const valido = p => Number.isInteger(p.id) && p.nome
  && /^https:\/\/cdn\.mistral\.com\.br\/[\w./-]+$/.test(p.foto)
  && /^https:\/\/www\.mistral\.com\.br\/[\w./-]+$/.test(p.link)
  && (p.preco_mistral === null || (Number.isFinite(p.preco_mistral) && p.preco_mistral > 0 && p.preco_mistral < 100000));

const enxuto = o => ({
  id: Number(o.id),
  nome: texto(o.title, 160),
  vinicola: texto(o.title_producers, 120),
  tipo: texto(o.title_product_type || o.product_type, 40),
  uva: texto((Array.isArray(o.all_grapes) ? o.all_grapes : []).map(g => g && g.title).filter(Boolean).join(", ") || o.grape, 120),
  pais: texto(o.title_country, 60),
  regiao: texto([o.region, o.sub_region].filter(Boolean).join(", "), 120),
  garrafa: texto(o.bottle_size, 20),
  descricao: texto(o.description, 1200),
  harmonizacao: texto(o.harmonization, 400),
  pontos: texto(o.avaliation_note, 40),
  preco_mistral: typeof o.sale_price === "number" ? o.sale_price : null,
  foto: o.image_link,
  link: o.link,
});

async function baixar(url){
  const r = await fetch(url, { headers: { "user-agent": "MalbeCatalogo/1.0 (+https://ruhanpablo-coder.github.io/malbe-site/)" } });
  if(!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.text();
}

const todos = new Map();
for(const base of LISTAGENS){
  for(let pagina = 1; pagina <= MAX_PAGINAS; pagina++){
    const url = pagina === 1 ? base : `${base}?page=${pagina}`;
    const html = await baixar(url);
    const produtos = extrairProdutos(html);
    const novos = produtos.filter(p => !todos.has(Number(p.id)));
    novos.map(enxuto).filter(valido).forEach(p => todos.set(p.id, p));
    console.log(`${url}: ${produtos.length} produtos, ${novos.length} novos`);
    if(!novos.length) break;
    await dormir(PAUSA_MS);
  }
}

if(todos.size < 20) throw new Error(`Só ${todos.size} produtos encontrados; o formato da Mistral pode ter mudado.`);
const lista = [...todos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
await writeFile(new URL("../mistral.json", import.meta.url), JSON.stringify({ atualizado: new Date().toISOString(), produtos: lista }, null, 1) + "\n");
console.log(`mistral.json: ${lista.length} vinhos`);
