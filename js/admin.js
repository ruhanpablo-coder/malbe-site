const REPO = "ruhanpablo-coder/malbe-site";
const ARQUIVO = "produtos.json";
const API = `https://api.github.com/repos/${REPO}/contents/${ARQUIVO}`;
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const brl = v => v.toLocaleString("pt-BR", {style:"currency", currency:"BRL"});
const semAcento = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/* a chave fica só nesta aba (sessionStorage); com "lembrar", fica neste aparelho (localStorage) */
const CHAVE = "malbe-admin-token";
function lerChave(){ try{ return sessionStorage.getItem(CHAVE) || localStorage.getItem(CHAVE); }catch(e){ return null; } }
function guardarChave(t, lembrar){
  try{
    sessionStorage.removeItem(CHAVE); localStorage.removeItem(CHAVE);
    if(t) (lembrar ? localStorage : sessionStorage).setItem(CHAVE, t);
  }catch(e){}
}
document.addEventListener("load", e => {
  const img = e.target;
  if(img.tagName === "IMG" && img.closest("td .mini") && img.naturalWidth / img.naturalHeight > .8) img.classList.add("quadrada");
}, true);

let token = lerChave();
let produtos = [], original = "", sha = null, catalogo = [];
let editando = null;   /* id do vinho em edição, ou null para um novo */

/* ---------- GitHub ---------- */
const cabecalhos = () => ({ Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
const paraBase64 = txt => { const b = new TextEncoder().encode(txt); let s = ""; b.forEach(x => s += String.fromCharCode(x)); return btoa(s); };
const deBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0)));

async function carregar(){
  const r = await fetch(API + "?ref=main&t=" + Date.now(), { headers: cabecalhos(), cache: "no-store" });
  if(r.status === 401) throw new Error("chave");
  if(r.status === 404) throw new Error("acesso");
  if(!r.ok) throw new Error("GitHub respondeu " + r.status);
  const d = await r.json();
  sha = d.sha;
  produtos = JSON.parse(deBase64(d.content)).produtos || [];
  original = JSON.stringify(produtos);
}

async function publicar(){
  const corpo = JSON.stringify({ produtos }, null, 1) + "\n";
  const r = await fetch(API, {
    method: "PUT", headers: cabecalhos(),
    body: JSON.stringify({ message: "Atualiza vinhos pelo painel", content: paraBase64(corpo), sha, branch: "main" })
  });
  if(r.status === 409 || r.status === 422) throw new Error("conflito");
  if(r.status === 403 || r.status === 404) throw new Error("permissao");
  if(!r.ok) throw new Error("GitHub respondeu " + r.status);
  const d = await r.json();
  sha = d.content.sha;
  original = JSON.stringify(produtos);
}

/* ---------- entrada ---------- */
async function iniciar(){
  if(!token){ $("#entrada").hidden = false; $("#painel").hidden = true; $("#sair").hidden = true; return; }
  try{
    await carregar();
    $("#entrada").hidden = true; $("#painel").hidden = false; $("#sair").hidden = false;
    desenharLista(); carregarCatalogo();
  }catch(e){
    const msg = e.message === "chave" ? "A chave não foi aceita pelo GitHub. Confira se copiou inteira ou gere outra."
      : e.message === "acesso" ? "A chave não tem acesso ao repositório malbe-site. Gere outra marcando esse repositório."
      : "Não foi possível falar com o GitHub agora (" + e.message + "). Tente de novo em instantes.";
    token = null; guardarChave(null);
    $("#entrada").hidden = false; $("#painel").hidden = true;
    $("#msg-entrada").innerHTML = `<div class="aviso erro">${esc(msg)}</div>`;
  }
}
$("#entrar").addEventListener("click", () => {
  const t = $("#token").value.trim();
  if(!t){ $("#msg-entrada").innerHTML = `<div class="aviso erro">Cole a chave do GitHub no campo acima.</div>`; return; }
  token = t; guardarChave(t, $("#lembrar").checked); $("#token").value = ""; iniciar();
});
$("#token").addEventListener("keydown", e => { if(e.key === "Enter") $("#entrar").click(); });
$("#sair").addEventListener("click", () => {
  if(alterado() && !confirm("Há alterações não publicadas. Sair mesmo assim?")) return;
  token = null; guardarChave(null); location.reload();
});

/* ---------- catálogo da Mistral ---------- */
async function carregarCatalogo(){
  try{
    const r = await fetch("mistral.json?v=" + Date.now());
    const d = await r.json();
    catalogo = d.produtos || [];
    const quando = new Date(d.atualizado).toLocaleDateString("pt-BR");
    $("#info-catalogo").textContent = `${catalogo.length} vinhos argentinos da Mistral, atualizados em ${quando}. Digite pelo menos 3 letras.`;
  }catch(e){
    $("#info-catalogo").textContent = "O catálogo da Mistral não carregou. Você ainda pode cadastrar sem a Mistral.";
  }
}
function buscar(){
  const termos = semAcento($("#q").value).split(/\s+/).filter(Boolean);
  if(termos.join("").length < 3){ $("#resultados").innerHTML = ""; return; }
  const achados = catalogo.filter(p => { const t = semAcento(`${p.nome} ${p.vinicola} ${p.uva} ${p.tipo}`); return termos.every(x => t.includes(x)); }).slice(0, 12);
  $("#resultados").innerHTML = achados.length ? achados.map(p => `
    <button class="res" data-id="${esc(p.id)}">
      <div class="mini"><img src="${esc(p.foto)}" alt="" loading="lazy"></div>
      <div><b>${esc(p.nome)}</b><small>${esc(p.tipo)} · ${esc(p.uva)}</small><br>
      <span class="pm">${Number.isFinite(p.preco_mistral) ? "Mistral: " + brl(p.preco_mistral) : ""}</span></div>
    </button>`).join("")
    : `<p class="ref">Nada encontrado na Mistral. Tente outro pedaço do nome ou use "Cadastrar sem a Mistral".</p>`;
}
$("#q").addEventListener("input", buscar);
$("#resultados").addEventListener("click", e => {
  const b = e.target.closest(".res"); if(!b) return;
  const p = catalogo.find(x => String(x.id) === b.dataset.id); if(!p) return;
  abrirEditor(null, {
    nome: p.nome.replace(/\s*\([^)]*\)\s*$/, "").trim(),
    vinicola: p.vinicola, uva: p.uva, tipo: p.tipo, preco: null, caixa: 6,
    foto: p.foto, ativo: true, mistral_id: p.id,
  }, p.preco_mistral);
});
$("#manual").addEventListener("click", () => abrirEditor(null, { nome: $("#q").value.trim(), vinicola: "", uva: "", tipo: "Tinto", preco: null, caixa: 6, foto: "", ativo: true }));

/* ---------- editor ---------- */
function abrirEditor(id, v, precoMistral){
  editando = id;
  $("#editor").hidden = false;
  $("#editor-titulo").textContent = id ? "Editar vinho" : "Novo vinho";
  $("#f-nome").value = v.nome || ""; $("#f-vinicola").value = v.vinicola || ""; $("#f-uva").value = v.uva || "";
  if(![...$("#f-tipo").options].some(o => o.value === v.tipo)) $("#f-tipo").add(new Option(v.tipo, v.tipo));
  $("#f-tipo").value = v.tipo || "Tinto";
  $("#f-preco").value = Number.isFinite(v.preco) ? v.preco.toFixed(2).replace(".", ",") : "";
  $("#f-caixa").value = String(v.caixa || 6);
  $("#f-foto").value = v.foto || "";
  $("#f-desc").value = v.descricao || ""; contarDesc();
  $("#f-ativo").checked = v.ativo !== false;
  $("#f-disponivel").checked = v.disponivel !== false;
  $("#f-ref").textContent = precoMistral ? `Na Mistral: ${brl(precoMistral)}` : "";
  $("#editor").dataset.mistral = v.mistral_id || "";
  preview();
  $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#f-preco").focus({ preventScroll: true });
}
function preview(){
  const img = $("#f-preview"); img.classList.remove("quadrada");
  img.onload = function(){ if(this.naturalWidth/this.naturalHeight > .8) this.classList.add("quadrada"); };
  img.src = $("#f-foto").value || "img/selo.png";
}
$("#f-foto").addEventListener("change", preview);
function contarDesc(){ $("#f-desc-cont").textContent = `${$("#f-desc").value.length} de 280 caracteres`; }
$("#f-desc").addEventListener("input", contarDesc);
$("#f-cancelar").addEventListener("click", () => { $("#editor").hidden = true; editando = null; });

/* aceita "89,90", "89.90" e "1.299,90"; vazio vira null (sob consulta); inválido vira NaN */
function lerPreco(txt){
  let t = String(txt).trim().replace(/[R$\s]/g, "");
  if(t === "") return null;
  if(t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const v = Number(t);
  return v > 0 ? Math.round(v * 100) / 100 : NaN;
}
const slug = s => semAcento(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "vinho";
$("#f-salvar").addEventListener("click", () => {
  const nome = $("#f-nome").value.trim();
  if(!nome){ alert("Escreva o nome do vinho."); $("#f-nome").focus(); return; }
  const preco = lerPreco($("#f-preco").value);
  if(Number.isNaN(preco)){ alert("O preço precisa ser maior que zero, ou ficar vazio para sob consulta."); return; }
  const dados = {
    nome, vinicola: $("#f-vinicola").value.trim(), uva: $("#f-uva").value.trim(), tipo: $("#f-tipo").value,
    preco, caixa: parseInt($("#f-caixa").value, 10), foto: $("#f-foto").value.trim(), descricao: $("#f-desc").value.trim(), ativo: $("#f-ativo").checked, disponivel: $("#f-disponivel").checked,
  };
  const mistral = $("#editor").dataset.mistral; if(mistral) dados.mistral_id = Number(mistral);
  if(editando){
    Object.assign(produtos.find(p => p.id === editando), dados);
  }else{
    let id = slug(nome), n = 2;
    while(produtos.some(p => p.id === id)) id = slug(nome) + "-" + n++;
    produtos.push({ id, ...dados });
  }
  $("#editor").hidden = true; editando = null; $("#q").value = ""; buscar();
  desenharLista();
});

/* ---------- lista ---------- */
const alterado = () => JSON.stringify(produtos) !== original;
function desenharLista(){
  const ativos = produtos.filter(p => p.ativo !== false).length;
  const disp = produtos.filter(p => p.ativo !== false && p.disponivel !== false).length;
  $("#resumo").textContent = `${produtos.length} vinhos cadastrados, ${ativos} aparecendo no site, ${disp} disponíveis para compra. "No site" desligado esconde o vinho; "Disponível" desligado mostra esmaecido.`;
  $("#lista").innerHTML = produtos.map(p => `
    <tr class="${p.ativo === false ? "inativo" : ""}" data-id="${esc(p.id)}">
      <td><div class="mini"><img src="${esc(p.foto || "img/selo.png")}" alt=""></div></td>
      <td class="nome"><b>${esc(p.nome)}</b><small>${esc(p.vinicola)}</small></td>
      <td class="col-tipo">${esc(p.tipo)}</td>
      <td><input type="text" inputmode="decimal" value="${Number.isFinite(p.preco) ? p.preco.toFixed(2).replace(".", ",") : ""}" placeholder="Consulta" data-campo="preco" aria-label="Preço de ${esc(p.nome)}"></td>
      <td class="ativo"><label class="chave"><input type="checkbox" data-campo="ativo" ${p.ativo === false ? "" : "checked"} aria-label="Mostrar ${esc(p.nome)} no site"><span></span></label></td>
      <td class="ativo"><label class="chave"><input type="checkbox" data-campo="disponivel" ${p.disponivel === false ? "" : "checked"} aria-label="${esc(p.nome)} disponível para compra"><span></span></label></td>
      <td class="acao"><button class="link" data-acao="editar">Editar</button></td>
    </tr>`).join("");
  $("#barra").classList.toggle("vis", alterado());
}
$("#lista").addEventListener("change", e => {
  const tr = e.target.closest("tr"); const p = produtos.find(x => x.id === tr.dataset.id);
  if(e.target.dataset.campo === "preco"){
    const v = lerPreco(e.target.value);
    if(Number.isNaN(v)){ alert("Preço inválido. Use por exemplo 89,90, ou deixe vazio para sob consulta."); }
    else p.preco = v;
  }
  if(e.target.dataset.campo === "ativo"){ p.ativo = e.target.checked; }
  if(e.target.dataset.campo === "disponivel"){ p.disponivel = e.target.checked; }
  desenharLista();
});
$("#lista").addEventListener("click", e => {
  if(e.target.dataset.acao !== "editar") return;
  const p = produtos.find(x => x.id === e.target.closest("tr").dataset.id);
  abrirEditor(p.id, p);
});

/* ---------- publicar ---------- */
$("#descartar").addEventListener("click", () => { produtos = JSON.parse(original); desenharLista(); });
$("#publicar").addEventListener("click", async () => {
  const b = $("#publicar"); b.disabled = true; b.textContent = "Publicando…";
  try{
    await publicar();
    desenharLista();
    $("#barra").classList.add("vis");
    $("#barra-txt").textContent = "Publicado. O site mostra as mudanças em cerca de 1 minuto.";
    setTimeout(() => { $("#barra").classList.remove("vis"); $("#barra-txt").textContent = "Há alterações que ainda não estão no site."; }, 6000);
  }catch(e){
    const msg = e.message === "conflito" ? "A lista mudou no GitHub enquanto você editava. Recarregue a página e refaça as mudanças."
      : e.message === "permissao" ? "A chave não tem permissão para gravar. Gere outra com Contents: Read and write."
      : "Não foi possível publicar (" + e.message + "). Tente de novo.";
    alert(msg);
  }finally{ b.disabled = false; b.textContent = "Publicar no site"; }
});
addEventListener("beforeunload", e => { if(alterado()){ e.preventDefault(); e.returnValue = ""; } });

iniciar();
