// Baixa para img/ as fotos que o painel salvou como endereço externo (ex.: Mistral)
// e troca o endereço em produtos.json pelo arquivo local, para o site não depender de outro servidor.
// Uso: node scripts/baixar-fotos.mjs
import { readFile, writeFile } from "node:fs/promises";

const arquivo = new URL("../produtos.json", import.meta.url);
const dados = JSON.parse(await readFile(arquivo, "utf8"));
let mudou = 0;

for(const p of dados.produtos){
  if(!/^https?:\/\//.test(p.foto || "")) continue;
  try{
    const r = await fetch(p.foto);
    if(!r.ok) throw new Error(r.status);
    const tipo = r.headers.get("content-type") || "";
    const ext = tipo.includes("webp") ? "webp" : tipo.includes("jpeg") ? "jpg" : "png";
    const nome = `img/p-${p.id}.${ext}`;
    await writeFile(new URL(`../${nome}`, import.meta.url), Buffer.from(await r.arrayBuffer()));
    console.log(`${p.nome}: ${p.foto} -> ${nome}`);
    p.foto = nome;
    mudou++;
  }catch(e){
    console.log(`${p.nome}: não baixou (${e.message}), mantém o endereço externo`);
  }
}

if(mudou) await writeFile(arquivo, JSON.stringify(dados, null, 1) + "\n");
console.log(`${mudou} foto(s) baixada(s)`);
