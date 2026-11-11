# Integração site malbevinhos.com.br ↔ malbê gestão

Data: 2026-11-10
Status: aprovado em conversa (brainstorming)

## Objetivo

Fazer do malbê gestão a fonte única do catálogo do site. Ao liberar um lote
no gestão, os produtos sobem para o site já no padrão atual de anúncio
(foto, descrição, uva, preço). Vendas feitas pelo checkout do site voltam
para o gestão como pedidos e vendas, baixando estoque, com todos os passos
de integração registrados em log com o JSON completo de request e response.

## Contexto atual

- **Site** (repo `malbe-site`): estático na Vercel. Catálogo em
  `produtos.json` commitado no repo (campos: `id`, `nome`, `vinicola`,
  `uva`, `tipo`, `preco`, `caixa`, `foto`, `ativo`, `disponivel`,
  `descricao`). Fotos em `img/`. Checkout em `api/checkout.js`: valida
  carrinho contra `produtos.json` e cria link de pagamento na InfinitePay
  (`POST https://api.checkout.infinitepay.io/links`, header `X-Api-Key`).
  Hoje o pedido não é registrado em lugar nenhum.
- **Gestão** (repo `malbe-gestao`, branch `feat/fase-1`): Supabase com
  tabelas `produtos`, `lotes` (status `montagem`/`a_venda`/`encerrado`),
  `itens_lote`, `pedidos`, `vendas`, `estornos` etc. Front em JS puro,
  deploy na Vercel (push vira Preview; produção exige `vercel promote`).
- **Lacuna**: `produtos` do gestão não tem foto, descrição, uva nem preço
  de venda — tudo que o anúncio do site precisa.

## Decisões de arquitetura

1. **Fonte única**: todos os dados de anúncio ficam no gestão.
2. **Preço**: sugerido por `custo + percentual` do item do lote, com ajuste
   manual na liberação. O valor publicado fica gravado.
3. **Venda do site**: checkout cria pedido `aguardando_pagamento` no
   gestão; webhook da InfinitePay confirma, o pedido vira venda e baixa
   estoque. Produto esgotado é republicado como indisponível.
4. **Publicação**: o gestão gera `produtos.json` + fotos e commita no repo
   `malbe-site` via API do GitHub. O site continua 100% estático.

## Fluxo geral

```
gestão (Supabase)                      site (estático, GitHub/Vercel)
─────────────────                      ──────────────────────────────
cadastro produto c/ anúncio
lote → liberação (a_venda)
  → revisão de preços/anúncios
  → PUBLICAR ──── GitHub API ───────→ commit produtos.json + img/ → deploy
                                        checkout InfinitePay
pedido "aguardando pagto" ←── api/checkout grava na Supabase
venda + baixa estoque     ←── webhook InfinitePay (paid) + payment_check
estoque zerou → republica (disponivel:false ou selo "Esgotado")
```

## 1. Gestão — cadastro de anúncio

Novos campos em `public.produtos` (migração Supabase):

- `uva text`
- `descricao_site text`
- `foto_site text` — caminho no Supabase Storage (bucket novo, ex.
  `anuncios`)
- `slug text unique` — vira o `id` do `produtos.json` (ex.
  `angelica-malbec`)
- `publicar_no_site boolean not null default false`
- `exibir_esgotado boolean not null default false` — esgotado fica no site
  com selo "Esgotado" em vez de sumir (decisão por produto)

A tela de produto ganha o bloco "Anúncio do site" com upload de foto e
preview do card igual ao do site.

## 2. Liberação do lote → publicação

Ao mudar o lote para `a_venda`, uma tela de revisão lista cada item:

- preço sugerido (`custo + percentual`), editável para arredondar/ajustar;
- estoque (caixas × garrafas por caixa), com campo de **estoque de
  segurança** (garrafas reservadas fora do site, para venda direta);
- status do anúncio: completo / falta foto / falta descrição.

Botão **Publicar no site** só habilita com todos os anúncios completos.

Nova tabela `publicacoes_site`: snapshot do que foi ao ar (produto, preço
publicado, estoque disponibilizado, quem publicou, quando, SHA do commit).

**Preço promocional**: campos de preço promocional com vigência (início e
fim). A publicação usa o preço vigente; a virada de vigência dispara
republicação automática.

## 3. Publicador (GitHub)

Função serverless no projeto `malbe-gestao` na Vercel:

- monta `produtos.json` no formato atual do site, preservando a ordem dos
  campos;
- baixa as fotos do Supabase Storage e as inclui em `img/`;
- commita tudo no repo `malbe-site` via API do GitHub — token fine-grained
  restrito a esse repo, em env var da Vercel (`GITHUB_TOKEN_SITE`);
- um commit por publicação, mensagem tipo
  `Publica lote L-2026-07 (5 vinhos)`;
- push no `main` dispara o deploy automático do site;
- republicação parcial (ex.: um vinho esgotou) altera só `disponivel`;
- **dry-run**: antes de commitar, mostra o diff do `produtos.json` para
  conferência.

Falha no GitHub → log + estado "pendente" na publicação; nada parcial
(o commit é atômico). Tela de integrações tem botão "reexecutar".

## 4. Checkout → pedido → venda

`api/checkout.js` do site passa a:

1. validar preço e disponibilidade **na Supabase** (não mais no
   `produtos.json`) — usa chave `service_role` ou função RPC dedicada,
   nunca exposta ao navegador;
2. criar `pedido` com status `aguardando_pagamento`, itens e `order_nsu`;
3. criar o link InfinitePay com:
   - `webhook: { url: "<site>/api/webhook-infinitepay", events: ["paid", "refunded", "canceled"] }`
   - `options.valid_until`: agora + 24h (sem isso o link nunca expira)
   - `options.single_payment: true`
4. gravar a URL do link no pedido.

Novo `api/webhook-infinitepay.js` no site:

- o webhook da InfinitePay **não tem assinatura**; a autenticidade é
  confirmada via `POST https://api.checkout.infinitepay.io/payment_check`
  com `handle` + `order_nsu` + `transaction_nsu` + `slug` (os dois últimos
  vêm do próprio webhook: `transaction_nsu` e `invoice_slug`). Só
  `paid: true` confirma;
- idempotente por `order_nsu` + `transaction_nsu` (a InfinitePay reenvia
  em resposta não-2xx); responder 2xx rápido (<1s recomendado);
- evento `paid`: pedido vira venda, baixa estoque; estoque zerou →
  dispara republicação (`disponivel:false` ou selo "Esgotado");
- eventos `refunded`/`canceled`: gera estorno/cancelamento no gestão;
- pedido não pago até o `valid_until` → expira (verificação on-read ou
  job).

**Notificação**: pagamento confirmado dispara aviso por WhatsApp/e-mail.

Atenção: a InfinitePay **não tem sandbox** — todo teste de pagamento é
real (mínimo R$ 1,00). O vinho de teste de R$ 5 serve para o teste ponta a
ponta; estornar depois.

## 5. Pedidos do site no gestão

Aba separando venda balcão × venda site, mostrando: itens, status do
pagamento, link do checkout, `order_nsu`, comprovante (`receipt_url`).

## 6. Logs de integração

Tabela `integracao_logs`:

- `direcao` (`publicacao` / `checkout` / `webhook` / `payment_check` /
  `notificacao`)
- `request jsonb` — JSON **completo** enviado/recebido
- `response jsonb` — JSON **completo** da resposta
- `status_http int`, `erro text`, `criado_em timestamptz`
- referências opcionais a pedido/publicação

Toda chamada loga, inclusive payload inválido no webhook. Tela
"Integrações" no gestão com os últimos eventos, filtros e botão de
reexecutar publicação.

## 7. Testes

- Suite Node existente do gestão (`npm test`): montagem do `produtos.json`,
  cálculo de preço (incl. promocional e vigência), transições de pedido,
  idempotência do webhook, payloads gravados da InfinitePay.
- Teste ponta a ponta manual com o vinho de R$ 5 (pagamento real).

## Fora de escopo

- Mudar o layout/UX do site.
- Outros meios de pagamento além da InfinitePay.
- Multi-loja ou multiusuário além do que o gestão já tem.
