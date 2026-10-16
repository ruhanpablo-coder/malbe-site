// Baixa para img/ as fotos que o painel salvou como endereço externo (ex.: Mistral)
// e troca o endereço em produtos.json pelo arquivo local, para o site não depender de outro servidor.
// Uso: node scripts/baixar-fotos.mjs
import { readFile, writeFile } from "node:fs/promises";

const arquivo = new URL("../produtos.json", import.meta.url);
const dados = JSON.parse(await readFile(arquivo, "utf8"));
let mudou = 0;

const MAX_BYTES = 5 * 1024 * 1024;
const TIPOS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

for(const p of dados.produtos){
  if(!/^https?:\/\//.test(p.foto || "")) continue;
  try{
    // só https, e o id vira nome de arquivo: aceita apenas letras minúsculas, números e hífen
    if(!p.foto.startsWith("https://")) throw new Error("endereço sem https");
    if(!/^[a-z0-9-]{1,80}$/.test(p.id || "")) throw new Error("id inválido para nome de arquivo");
    const r = await fetch(p.foto, { redirect: "follow" });
    if(!r.ok) throw new Error(r.status);
    const tipo = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const ext = TIPOS[tipo];
    if(!ext) throw new Error(`não é imagem png/jpg/webp (${tipo || "sem tipo"})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    if(bytes.length > MAX_BYTES) throw new Error(`imagem maior que 5 MB (${bytes.length} bytes)`);
    const assinatura = bytes.subarray(0, 12).toString("hex");
    const confere = ext === "png" ? assinatura.startsWith("89504e47") : ext === "jpg" ? assinatura.startsWith("ffd8ff") : assinatura.startsWith("52494646") && assinatura.slice(16, 24) === "57454250";
    if(!confere) throw new Error("conteúdo não confere com o tipo de imagem");
    const nome = `img/p-${p.id}.${ext}`;
    await writeFile(new URL(`../${nome}`, import.meta.url), bytes);
    console.log(`${p.nome}: ${p.foto} -> ${nome}`);
    p.foto = nome;
    mudou++;
  }catch(e){
    console.log(`${p.nome}: não baixou (${e.message}), mantém o endereço externo`);
  }
}

if(mudou) await writeFile(arquivo, JSON.stringify(dados, null, 1) + "\n");
console.log(`${mudou} foto(s) baixada(s)`);
