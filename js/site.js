/* ===== Configuração da loja: edite aqui ===== */
const LOJA = {
  whatsapp: "5518998154368",            // DDI + DDD + número, só dígitos
  instagram: "https://www.instagram.com/malbevinhos01/",
  cidade: "Entregas combinadas pelo WhatsApp",
  destaque: "",                         // id do vinho em destaque no topo; vazio = primeiro disponível
  aviso: "Lote novo chegando em novembro. Peça pelo WhatsApp e reserve suas garrafas.",
  vantagens: [
    ["Pedido pelo WhatsApp", "Monte o carrinho e envie a mensagem pronta.", "chat"],
    ["Caixa fechada", "Leve 4 ou 6 garrafas do mesmo vinho.", "caixa"],
    ["Estoque limitado", "", "garrafa"],
  ],
};

/* os vinhos ficam em produtos.json e são editados pelo painel (admin.html) */
let VINHOS = [];
/* ============================================ */

const fotoDe = v => v.foto || "img/marca/simbolo.png";
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl = v => v.toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const $ = s => document.querySelector(s);
const waLink = txt => `https://wa.me/${LOJA.whatsapp}${txt ? "?text="+encodeURIComponent(txt) : ""}`;
const guardar = (k,v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
const ler = (k,padrao) => { try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; }catch(e){ return padrao; } };

const ICONE_CARRINHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/><circle cx="9.5" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/></svg>';
const ICONES = {
  chat:'<path d="M4 5h16v11H9l-5 4z"/>',
  caixa:'<path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/>',
  garrafa:'<path d="M10 2h4v4l1.5 3v12a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V9L10 6z"/><path d="M8.5 13h7"/>',
};

let carrinho = ler("malbe-carrinho", {});
if(!carrinho || typeof carrinho !== "object" || Array.isArray(carrinho)) carrinho = {};
for(const k of Object.keys(carrinho)){ const q = carrinho[k]; if(!Number.isInteger(q) || q < 1 || q > 999) delete carrinho[k]; }
let filtro = "todos";

/* textos e links */
$("#aviso").innerHTML = `<span class="ponto" aria-hidden="true"></span>`;
$("#aviso").append(LOJA.aviso);
$("#rodape-cidade").textContent = LOJA.cidade;
$("#ano").textContent = new Date().getFullYear();
const ola = "Olá, Malbê! Vim pelo site e queria saber sobre os vinhos.";
["#wa-topo","#wa-rodape","#wa-redes","#wa-flutuante"].forEach(s => $(s).href = waLink(ola));
$("#ig-rodape").href = $("#ig-redes").href = LOJA.instagram;
$("#vantagens").innerHTML = LOJA.vantagens.map(([t,d,i]) =>
  `<div class="vantagem"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">${ICONES[i]}</svg><div><strong>${t}</strong>${d ? `<span>${d}</span>` : ""}</div></div>`).join("");

/* filtros */
let tipos = ["todos"];
const nomeFiltro = t => t === "todos" ? "Todos" : t + "s";
/* cada categoria mostra a foto de um vinho daquele tipo, como os círculos do Vivino */
const fotoTipo = t => (VINHOS.find(v => v.tipo === t && v.foto && v.disponivel !== false) || VINHOS.find(v => v.tipo === t && v.foto) || {}).foto;
/* "Todos" junta uma garrafa de cada tipo (até três) */
function desenharFiltros(){
  $("#filtros").innerHTML = tipos.map(t => {
    const fotos = (t === "todos" ? tipos.slice(1, 4).map(fotoTipo) : [fotoTipo(t)]).filter(Boolean);
    const img = fotos.length ? fotos.map(f => `<img src="${esc(f)}" alt="" loading="lazy" decoding="async">`).join("") : `<img class="selo" src="img/marca/simbolo.png" alt="">`;
    return `<button class="filtro" data-t="${esc(t)}" aria-pressed="${t===filtro}"><span class="circulo${fotos.length > 1 ? " trio" : ""}">${img}</span>${esc(nomeFiltro(t))}</button>`;
  }).join("");
}

/* vinho em destaque no topo: o da configuração ou o primeiro disponível com foto */
function desenharDestaque(){
  const tem = v => v.disponivel !== false;
  const v = VINHOS.find(x => x.id === LOJA.destaque && tem(x)) || VINHOS.find(x => tem(x) && x.foto) || VINHOS.find(tem);
  if(!v){ $("#destaque").hidden = true; return; }
  const qtd = carrinho[v.id] || 0;
  $("#destaque").hidden = false;
  $("#destaque").innerHTML = `<div class="foto"><img src="${esc(fotoDe(v))}" alt="Garrafa de ${esc(v.nome)}" decoding="async"></div>
    <div>
      <span class="etiqueta">Destaque</span>
      <span class="vinicola">${esc(v.vinicola)}</span>
      <h2>${esc(v.nome)}</h2>
      <span class="uva">${esc(v.uva)}</span>
      ${v.descricao ? `<p class="desc">${esc(v.descricao)}</p>` : ""}
      <div class="preco">${v.preco ? brl(v.preco) : "Preço sob consulta"}</div>
      <div class="preco-caixa">${v.preco ? `Caixa com ${v.caixa}: ${brl(v.preco*v.caixa)}` : `Caixa com ${v.caixa} garrafas`}</div>
      <button class="add ${qtd?"no-carrinho":""}" data-id="${esc(v.id)}">${ICONE_CARRINHO}${qtd ? `No carrinho (${qtd})` : "Adicionar"}</button>
    </div>`;
}
$("#destaque").addEventListener("click", e => { const b = e.target.closest(".add"); if(b){ mudar(b.dataset.id, 1); abrir(); } });
$("#filtros").addEventListener("click", e => { const b = e.target.closest("button"); if(b){ filtro = b.dataset.t; desenharFiltros(); desenharGrade(); $("#vinhos").scrollIntoView({block:"start"}); } });

/* vitrine */
const semAcento = s => s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
function desenharGrade(){
  const q = semAcento($("#busca").value.trim());
  const lista = VINHOS.filter(v => (filtro==="todos" || v.tipo===filtro) && (!q || semAcento(`${v.nome} ${v.vinicola} ${v.uva} ${v.tipo}`).includes(q)));
  $("#grade").innerHTML = lista.length ? lista.map(v => {
    const qtd = carrinho[v.id] || 0;
    const tem = v.disponivel !== false;
    return `<article class="produto${tem ? "" : " indisponivel"}">
      <div class="foto"><span class="selo-tipo">${tem ? esc(v.tipo) : "Indisponível"}</span><img src="${esc(fotoDe(v))}" alt="${v.foto ? "Garrafa de "+esc(v.nome) : "Foto em breve"}" loading="lazy" decoding="async" class="${v.foto?"":"sem-foto"}"></div>
      <div class="info">
        <span class="vinicola">${esc(v.vinicola)}</span>
        <h3>${esc(v.nome)}</h3>
        <span class="uva">${esc(v.uva)}</span>
        ${v.descricao ? `<p class="desc" title="Toque para ler tudo">${esc(v.descricao)}</p>` : ""}
        <div class="precos">
          <div class="preco">${v.preco ? brl(v.preco) : "Preço sob consulta"}</div>
          <div class="preco-caixa">${v.preco ? `Caixa com ${v.caixa||6}: ${brl(v.preco*(v.caixa||6))}` : `Caixa com ${v.caixa||6} garrafas`}</div>
        </div>
        ${tem ? `<button class="add ${qtd?"no-carrinho":""}" data-id="${esc(v.id)}">${ICONE_CARRINHO}${qtd ? `No carrinho (${qtd})` : "Adicionar"}</button>` : `<button class="add" disabled>Indisponível</button>`}
      </div>
    </article>`;
  }).join("") : `<div class="vazio">Nenhum vinho encontrado para essa busca. Tente o nome da uva ou da vinícola.</div>`;
}
$("#busca").addEventListener("input", () => { desenharGrade(); if($("#busca").value) $("#vinhos").scrollIntoView({block:"start"}); });
$("#grade").addEventListener("click", e => { const d = e.target.closest(".desc"); if(d){ d.classList.toggle("aberta"); return; } });
$("#grade").addEventListener("click", e => { const b = e.target.closest(".add"); if(b){ mudar(b.dataset.id, 1); abrir(); } });

/* carrinho */
/* total só aparece se todos os vinhos do pedido tiverem preço */
const comprar = id => VINHOS.some(v => v.id===id && v.disponivel !== false);
function totalPedido(ids){
  const vs = ids.map(id => VINHOS.find(v => v.id===id)).filter(Boolean);
  if(vs.some(v => !v.preco)) return null;
  return vs.reduce((s,v) => s + v.preco*carrinho[v.id], 0);
}
function mudar(id, d){
  if(!comprar(id) && d > 0) return;
  carrinho[id] = Math.max(0, (carrinho[id]||0) + d);
  if(!carrinho[id]) delete carrinho[id];
  guardar("malbe-carrinho", carrinho);
  desenharCarrinho(); desenharGrade(); desenharDestaque();
}
function desenharCarrinho(){
  const ids = Object.keys(carrinho).filter(comprar);
  const total = totalPedido(ids);
  const garrafas = ids.reduce((s,id) => s + carrinho[id], 0);
  $("#contador").textContent = garrafas;
  $("#total").textContent = total === null ? "Sob consulta" : brl(total);
  $("#enviar").disabled = !ids.length;
  $("#itens").innerHTML = ids.length ? ids.map(id => {
    const v = VINHOS.find(x => x.id===id);
    return `<div class="item"><img src="${esc(fotoDe(v))}" alt=""><div><strong>${esc(v.nome)}</strong><small>${v.preco ? brl(v.preco)+" a garrafa" : "Preço sob consulta"}</small></div>
      <div class="qtd"><button data-id="${esc(id)}" data-d="-1" aria-label="Tirar uma garrafa de ${esc(v.nome)}">−</button><span>${carrinho[id]}</span><button data-id="${esc(id)}" data-d="1" aria-label="Adicionar uma garrafa de ${esc(v.nome)}">+</button></div></div>`;
  }).join("") : `<p class="carrinho-vazio">Seu carrinho está vazio. Escolha um vinho na vitrine para começar.</p>`;
}
$("#itens").addEventListener("click", e => { const b = e.target.closest("button[data-d]"); if(b) mudar(b.dataset.id, +b.dataset.d); });

function abrir(){ $("#carrinho").classList.add("aberto"); $("#fundo").classList.add("aberto"); $("#carrinho").setAttribute("aria-hidden","false"); $("#fechar-carrinho").focus(); }
function fechar(){ $("#carrinho").classList.remove("aberto"); $("#fundo").classList.remove("aberto"); $("#carrinho").setAttribute("aria-hidden","true"); }
$("#abrir-carrinho").addEventListener("click", abrir);
$("#fechar-carrinho").addEventListener("click", fechar);
$("#fundo").addEventListener("click", fechar);
document.addEventListener("keydown", e => { if(e.key==="Escape") fechar(); });

$("#nome").value = ler("malbe-nome", "");
$("#enviar").addEventListener("click", () => {
  const nome = $("#nome").value.trim();
  guardar("malbe-nome", nome);
  const ids = Object.keys(carrinho).filter(comprar);
  const linhas = ids.map(id => {
    const v = VINHOS.find(x=>x.id===id), q = carrinho[id];
    return `▫️ ${q}x ${v.nome}${v.preco ? `\n      ${brl(v.preco)} cada · subtotal ${brl(v.preco*q)}` : `\n      preço sob consulta`}`;
  });
  const total = totalPedido(ids);
  const garrafas = ids.reduce((s,id) => s + carrinho[id], 0);
  const msg = [
    `🍷 *Novo pedido · Malbê Vinhos*`,
    ``,
    `Olá, Malbê! 👋${nome ? ` Sou *${nome}*.` : ""}`,
    `Quero fazer este pedido:`,
    ``,
    `🛒 *Itens*`,
    ...linhas,
    ``,
    `📦 ${garrafas} ${garrafas === 1 ? "garrafa" : "garrafas"}`,
    total === null ? `💰 *Total:* a confirmar (há item sob consulta)` : `💰 *Total: ${brl(total)}*`,
    ``,
    `✅ Podem confirmar o estoque, a forma de pagamento e a entrega?`,
  ].join("\n");
  window.open(waLink(msg), "_blank", "noopener");
});

/* aviso de idade */
if(!ler("malbe-maior", false)){ $("#idade").hidden = false; $("#sou-maior").focus(); }
$("#sou-maior").addEventListener("click", () => { guardar("malbe-maior", true); $("#idade").hidden = true; });

/* fotos quadradas (da Mistral) ganham zoom para a garrafa ocupar o card */
document.addEventListener("load", e => {
  const img = e.target;
  if(img.tagName === "IMG" && img.closest(".produto .foto, .filtro .circulo, .destaque .foto") && img.naturalWidth / img.naturalHeight > .8) img.classList.add("quadrada");
}, true);

/* garante tipos certos: texto vira texto, preço e caixa viram número (ou somem) */
function limpar(v){
  const txt = x => typeof x === "string" ? x : "";
  const preco = typeof v.preco === "number" && Number.isFinite(v.preco) && v.preco > 0 ? v.preco : null;
  const caixa = Number.isInteger(v.caixa) && v.caixa > 0 && v.caixa <= 24 ? v.caixa : 6;
  const foto = /^(img\/[\w.-]+|https:\/\/cdn\.mistral\.com\.br\/[\w./-]+)$/.test(txt(v.foto)) ? v.foto : "";
  return { id: txt(v.id), nome: txt(v.nome), vinicola: txt(v.vinicola), uva: txt(v.uva), tipo: txt(v.tipo) || "Vinho",
           descricao: txt(v.descricao), preco, caixa, foto, disponivel: v.disponivel !== false };
}

/* carrega os vinhos ativos de produtos.json; no-cache revalida (304) em vez de baixar de novo toda vez */
fetch("produtos.json", {cache: "no-cache"})
  .then(r => { if(!r.ok) throw new Error(r.status); return r.json(); })
  .then(d => {
    VINHOS = (Array.isArray(d.produtos) ? d.produtos : []).filter(v => v && v.ativo !== false).map(limpar).filter(v => v.id && v.nome);
    VINHOS.sort((a, b) => (b.disponivel !== false) - (a.disponivel !== false));
    tipos = ["todos", ...new Set(VINHOS.map(v => v.tipo))];
    desenharFiltros(); desenharGrade(); desenharCarrinho(); desenharDestaque();
  })
  .catch(() => { $("#grade").innerHTML = `<div class="vazio">Não foi possível carregar os vinhos agora. Recarregue a página ou fale com a gente pelo WhatsApp.</div>`; });
desenharCarrinho();
