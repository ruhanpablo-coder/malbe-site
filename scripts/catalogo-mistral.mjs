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

const enxuto = o => ({
  id: o.id,
  nome: o.title,
  vinicola: o.title_producers || "",
  tipo: o.title_product_type || o.product_type || "",
  uva: (o.all_grapes || []).map(g => g.title).join(", ") || o.grape || "",
  pais: o.title_country || "",
  regiao: [o.region, o.sub_region].filter(Boolean).join(", "),
  garrafa: o.bottle_size || "",
  descricao: o.description || "",
  harmonizacao: o.harmonization || "",
  pontos: o.avaliation_note || "",
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
    const novos = produtos.filter(p => !todos.has(p.id));
    novos.forEach(p => todos.set(p.id, enxuto(p)));
    console.log(`${url}: ${produtos.length} produtos, ${novos.length} novos`);
    if(!novos.length) break;
    await dormir(PAUSA_MS);
  }
}

if(todos.size < 20) throw new Error(`Só ${todos.size} produtos encontrados; o formato da Mistral pode ter mudado.`);
const lista = [...todos.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
await writeFile(new URL("../mistral.json", import.meta.url), JSON.stringify({ atualizado: new Date().toISOString(), produtos: lista }, null, 1) + "\n");
console.log(`mistral.json: ${lista.length} vinhos`);
