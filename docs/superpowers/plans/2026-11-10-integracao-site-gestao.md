# Integração site ↔ malbê gestão — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O gestão publica o catálogo do site a partir da liberação de lotes, e as vendas do checkout do site voltam como pedidos/vendas com baixa de estoque e logs completos.

**Architecture:** Duas fases independentes. Fase 1 (repo `malbe-gestao`): campos de anúncio, tela de liberação com preços, publicador serverless que commita `produtos.json` + fotos no repo `malbe-site` via API do GitHub. Fase 2 (repos `malbe-site` + `malbe-gestao`): checkout grava pedido na Supabase, webhook InfinitePay confirma via `payment_check`, converte em venda por RPC atômica e baixa estoque. Cada fase entrega software funcional sozinha.

**Tech Stack:** JS puro (ESM no gestão, CJS nas funções Vercel do site), Supabase (Postgres + Storage), Vercel serverless, GitHub Git Data API, InfinitePay Checkout API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-10-integracao-site-gestao-design.md`

## Global Constraints

- Dinheiro no gestão: **bigint em centavos**. No `produtos.json` do site: número em reais (ex. `204.9`). Conversão só na montagem do JSON.
- Ordem dos campos no `produtos.json` (igual ao atual): `id`, `nome`, `vinicola`, `uva`, `tipo`, `preco`, `caixa`, `foto`, `ativo`, `disponivel`, `descricao`.
- Nomes de código, tabelas, colunas e mensagens em **português**, seguindo o padrão dos dois repos.
- Logs de integração gravam o **JSON completo** de request e response (`jsonb`), em toda chamada, inclusive payload inválido.
- InfinitePay **não tem sandbox**: qualquer link criado é real (mínimo R$ 1,00). Testes automatizados nunca chamam a API real — sempre `fetch` mockado.
- Webhook InfinitePay **não tem assinatura**: confirmação só via `POST https://api.checkout.infinitepay.io/payment_check` com `paid: true`.
- Deploy gestão: push em `feat/fase-1` gera Preview; produção exige `npx vercel promote <url> --yes`. Deploy site: push no `main` publica direto.
- `npm test` (suite `node --test`, ~770 testes) verde antes de cada push no gestão. `git pull --rebase` antes de push (outras sessões usam a branch).
- Env vars novas — gestão/Vercel: `GITHUB_TOKEN_SITE`, `INTEGRACAO_SECRET`. Site/Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INFINITEPAY_HANDLE`, `INTEGRACAO_SECRET`, `RESEND_API_KEY`, `NOTIFICACAO_EMAIL` (além da existente `INFINITEPAY_API_KEY`).

## Review Focus

1. **Webhook `paid` reenviado** (InfinitePay repete em não-2xx): segunda entrega com mesmo `order_nsu`+`transaction_nsu` não pode duplicar venda nem baixa → teste de idempotência na Task 10.
2. **`payment_check` responde 200 com `paid:false` ou `success:false`**: pedido não confirma, nada baixa, log registra → teste na Task 10.
3. **Checkout com estoque insuficiente no momento da compra** (site estático atrasado): recusa com mensagem clara, sem criar link → teste na Task 9.
4. **Promoção expirada entre publicação e checkout**: o checkout cobra o preço vigente na Supabase, não o do site → teste na Task 9.
5. **Publicação com anúncio incompleto ou slug duplicado**: bloqueia antes de qualquer chamada ao GitHub → teste na Task 2.

---

# FASE 1 — Publicação do catálogo (repo `malbe-gestao`)

Todas as tasks da Fase 1 rodam em `~/malbe-gestao`, branch `feat/fase-1`.

### Task 1: Migração Supabase — anúncio, publicações e logs

**Files:**
- Create: `supabase/migrations/20261110000011_integracao_site.sql`
- Test: `tests/integracao-schema.test.js` (valida o SQL por leitura, no padrão de `tests/vercelignore.test.js` — a suite não sobe Postgres)

**Interfaces:**
- Produces: colunas novas em `public.produtos`: `uva text not null default ''`, `descricao_site text not null default ''`, `foto_site text not null default ''` (caminho no Storage), `slug text` (+ índice único parcial `where slug <> ''`), `publicar_no_site boolean not null default false`, `exibir_esgotado boolean not null default false`, `preco_site bigint`, `preco_promocional bigint`, `promocao_inicio date`, `promocao_fim date`, `estoque_seguranca int not null default 0`.
- Produces: `public.publicacoes_site` (`id uuid pk`, `criado_em`, `criado_por`, `lote_id uuid references lotes`, `commit_sha text`, `status text check in ('pendente','publicado','erro')`, `snapshot jsonb` — o produtos.json publicado inteiro).
- Produces: `public.integracao_logs` (`id uuid pk`, `criado_em`, `direcao text check in ('publicacao','checkout','webhook','payment_check','notificacao')`, `request jsonb`, `response jsonb`, `status_http int`, `erro text not null default ''`, `pedido_id uuid references pedidos on delete set null`, `publicacao_id uuid references publicacoes_site on delete set null`).
- Produces: bucket Storage `anuncios` (criado via `insert into storage.buckets`), RLS espelhando as tabelas existentes (ver `20261017000002_usuarios_rls.sql` e `20261017000005_privilegios.sql`).

- [ ] **Step 1: Escrever teste** `tests/integracao-schema.test.js`: lê o arquivo de migração e afirma presença das colunas/tabelas acima (`assert.match(sql, /add column .*slug text/)` etc.), incluindo os três checks de `direcao`, `status` e o índice único de slug.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/integracao-schema.test.js` → FAIL (arquivo não existe).
- [ ] **Step 3: Escrever a migração** com tudo que o bloco Interfaces lista, seguindo o estilo das migrações existentes (timestamps/criado_por padrão).
- [ ] **Step 4: Rodar testes** — `node --test tests/integracao-schema.test.js` e depois `npm test` → PASS.
- [ ] **Step 5: Aplicar no Supabase** — `npx supabase db push` (ou o fluxo que `supabase/manual` documentar) e conferir sem erro.
- [ ] **Step 6: Commit** — `feat: adiciona schema de integração com o site`.

### Task 2: `src/calc-site.js` — preço, estoque e montagem do produtos.json

**Files:**
- Create: `src/calc-site.js`
- Test: `tests/calc-site.test.js` (fixtures em `tests/fixtures.js`)

**Interfaces:**
- Consumes: helpers de custo de lote já existentes em `src/calc.js` (converter `custo_unitario` ARS→BRL pela `cotacao_ars_brl` do lote — reutilizar, ver `tests/calc-lote.test.js`; não redefinir).
- Produces (funções puras, ESM):
  - `precoSugerido(itemLote, lote) -> bigint centavos` — custo BRL × (1 + `percentual`/100), `percentual` do item ou `percentual_padrao` do lote, arredondado.
  - `precoVigente(produto, hoje) -> bigint centavos` — `preco_promocional` se `hoje` ∈ [`promocao_inicio`, `promocao_fim`], senão `preco_site`.
  - `estoqueSite(produto, itensLote, vendaItens, baixas) -> int` — garrafas dos `itens_lote` de lotes `a_venda` (`caixas × garrafas_por_caixa`) − vendidas − baixadas − `estoque_seguranca`; mínimo 0.
  - `statusAnuncio(produto) -> 'completo' | 'falta_foto' | 'falta_descricao' | 'falta_slug' | 'falta_preco'` (primeiro problema encontrado nessa ordem).
  - `montarProdutosJson(produtos, contexto, hoje) -> string` — JSON formatado com 1 espaço de indentação (padrão do arquivo atual), campos na ordem da Global Constraint, `preco` em reais, `foto: "img/<slug>.<ext>"`, `caixa` = `garrafas_por_caixa`, `disponivel` = estoque > 0, produto esgotado com `exibir_esgotado:false` sai do JSON, com `true` fica com `disponivel:false`. Lança erro com mensagem em português se algum produto marcado `publicar_no_site` tiver `statusAnuncio ≠ 'completo'` ou slug repetido.

- [ ] **Step 1: Escrever testes** cobrindo: preço sugerido com percentual do item e com fallback do lote; moeda ARS; promoção dentro/fora da vigência e sem datas; estoque descontando vendas, baixas e segurança, nunca negativo; cada status de anúncio; JSON com ordem exata de campos (`assert.deepEqual(Object.keys(parsed.produtos[0]), [...])`), esgotado oculto vs selo, erro em anúncio incompleto e em slug duplicado.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/calc-site.test.js` → FAIL.
- [ ] **Step 3: Implementar `src/calc-site.js`**.
- [ ] **Step 4: Rodar** `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat: cálculo de preço, estoque e produtos.json do site`.

### Task 3: Cadastro de produto — bloco "Anúncio do site"

**Files:**
- Modify: `src/ui/cadastros.js` (ou o módulo que renderiza a ficha do produto — seguir o padrão existente)
- Modify: `src/acoes.js` (persistência dos campos novos)
- Test: `tests/anuncio-tela.test.js` (padrão dos testes de tela existentes, ex. `tests/telas.test.js`)

**Interfaces:**
- Consumes: `statusAnuncio` da Task 2.
- Produces: formulário com `uva`, `descricao_site`, `slug` (auto-sugerido do nome: minúsculas, sem acento, hífens), upload de `foto_site` para o bucket `anuncios` (via `src/banco/armazenamento-supabase.js`, seguir padrão), toggles `publicar_no_site` e `exibir_esgotado`, campos de promoção, e preview do card no padrão visual do site (nome, vinícola, uva, preço, descrição, foto).

- [ ] **Step 1: Escrever teste de render**: ficha de produto com os campos novos presentes, slug sugerido corretamente (`"D.V. Catena Malbec-Malbec"` → `"dv-catena-malbec-malbec"`), badge com `statusAnuncio`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar UI + persistência.**
- [ ] **Step 4: `npm test` → PASS.**
- [ ] **Step 5: Commit** — `feat: bloco de anúncio do site no cadastro de produto`.

### Task 4: Liberação do lote — revisão e publicação

**Files:**
- Modify: `src/ui/lote.js`
- Modify: `src/acoes.js`
- Test: `tests/liberacao-site.test.js`

**Interfaces:**
- Consumes: `precoSugerido`, `estoqueSite`, `statusAnuncio` (Task 2).
- Produces: ao mudar lote para `a_venda`, tela de revisão com uma linha por item: preço sugerido editável (grava em `produtos.preco_site`), `estoque_seguranca` editável, estoque resultante, status do anúncio. Botão **Publicar no site** desabilitado enquanto houver anúncio incompleto entre os `publicar_no_site`. Clique chama `publicarSite({ loteId, dryRun })` (Task 5).

- [ ] **Step 1: Teste de render**: linhas com preço sugerido, botão desabilitado com anúncio incompleto, habilitado quando tudo completo; edição de preço persiste em centavos.
- [ ] **Step 2: Falhar. Step 3: Implementar. Step 4: `npm test` PASS.**
- [ ] **Step 5: Commit** — `feat: revisão de preços e publicação na liberação do lote`.

### Task 5: Publicador — commit no GitHub

**Files:**
- Create: `src/site-publicador.js` (lógica pura/injetável)
- Create: `api/publicar-site.js` (função Vercel, fina)
- Test: `tests/site-publicador.test.js`

**Interfaces:**
- Consumes: `montarProdutosJson` (Task 2); Supabase via cliente injetado; `fetch` injetado para GitHub.
- Produces:
  - `publicar({ supabase, fetchGitHub, loteId, dryRun, origem }) -> { dryRun: diff | null, commitSha, publicacaoId }`:
    1. carrega produtos `publicar_no_site` + contexto, monta o JSON (erro aborta antes de qualquer chamada GitHub — valida tudo primeiro);
    2. `dryRun: true` → retorna diff textual contra o `produtos.json` atual do repo (GET contents) e **não commita**;
    3. senão: baixa fotos novas do bucket `anuncios`, cria blobs + tree + commit + update ref `heads/main` no repo `ruhanpablo-coder/malbe-site` via Git Data API (um único commit, mensagem `Publica lote <codigo> (<n> vinhos)`; republicação sem lote: `Atualiza catálogo do site`);
    4. grava `publicacoes_site` (snapshot + `commit_sha`, status `publicado`; em falha GitHub: status `erro`) e `integracao_logs` (direcao `publicacao`, request/response completos de cada chamada GitHub).
  - `api/publicar-site.js`: POST, exige header `x-integracao-secret` igual a `INTEGRACAO_SECRET` **ou** sessão Supabase válida (chamada da UI); body `{ loteId?, dryRun? }`; responde o retorno de `publicar`.
- Produces p/ Fase 2: republicação automática = `POST /api/publicar-site` com o secret.

- [ ] **Step 1: Testes com `fetch` e supabase fake**: dry-run retorna diff e zero escrita; anúncio incompleto aborta sem chamar GitHub; sucesso → sequência blob/tree/commit/ref com os paths certos (`produtos.json`, `img/<slug>.<ext>`) e log com request/response completos; falha GitHub (422) → `publicacoes_site.status = 'erro'`, log com o body do erro, exceção com mensagem em português.
- [ ] **Step 2: Falhar. Step 3: Implementar. Step 4: `npm test` PASS.**
- [ ] **Step 5: Configurar na Vercel do gestão** `GITHUB_TOKEN_SITE` (fine-grained, só `ruhanpablo-coder/malbe-site`, permissão Contents RW) e `INTEGRACAO_SECRET` (`openssl rand -hex 32`).
- [ ] **Step 6: Commit** — `feat: publicador do catálogo no repo do site`.

### Task 6: Tela "Integrações"

**Files:**
- Create: `src/ui/integracoes.js`
- Modify: `src/ui/rotas.js`, `src/ui/menu.js` (registrar a tela, seguir padrão)
- Test: `tests/integracoes-tela.test.js`

**Interfaces:**
- Consumes: `integracao_logs`, `publicacoes_site`; `publicar` (Task 5) para reexecutar.
- Produces: lista dos últimos eventos (direção, status HTTP, erro, data) com filtro por direção, detalhe expandindo o JSON completo de request e response, e botão "Reexecutar publicação" nas publicações com status `erro`.

- [ ] **Step 1: Teste de render** (lista, filtro, JSON no detalhe, botão só em `erro`). **Step 2: Falhar. Step 3: Implementar. Step 4: `npm test` PASS.**
- [ ] **Step 5: Commit, push (`git pull --rebase` antes), promote** — subir Fase 1 para produção: `npx vercel ls malbe-gestao` → `npx vercel promote <url> --yes`.
- [ ] **Step 6: Validação manual da Fase 1**: cadastrar anúncio num produto real, liberar lote de teste, dry-run, publicar, conferir commit no GitHub e site atualizado.

---

# FASE 2 — Vendas do site (repos `malbe-site` + `malbe-gestao`)

### Task 7: Migração — pedidos do site e RPC de confirmação

**Files:**
- Create: `supabase/migrations/20261110000012_pedidos_site.sql` (repo `malbe-gestao`)
- Test: `tests/pedidos-site-schema.test.js` (mesmo padrão da Task 1)

**Interfaces:**
- Produces: colunas em `public.pedidos`: `origem text not null default 'gestao' check (origem in ('gestao','site'))`, `order_nsu text` (+ índice único parcial `where order_nsu is not null`), `pagamento_status text check (pagamento_status in ('aguardando_pagamento','pago','expirado','cancelado','estornado'))`, `checkout_url text`, `transaction_nsu text`, `invoice_slug text`, `receipt_url text`, `expira_em timestamptz`, `cliente_nome text not null default ''`.
- Produces: função `public.confirmar_pedido_site(p_order_nsu text, p_transaction_nsu text, p_invoice_slug text, p_receipt_url text, p_paid_amount bigint) returns uuid` — security definer, atômica e **idempotente**: pedido já `pago` com mesmo `transaction_nsu` retorna a venda existente sem duplicar; senão cria `vendas` + `venda_itens` (copiando `pedido_itens`), liga `pedidos.venda_id`, marca `pagamento_status = 'pago'`. Retorna `vendas.id`.
- Produces: função `public.criar_pedido_site(p_order_nsu text, p_cliente_nome text, p_itens jsonb) returns jsonb` — security definer: valida cada item (`slug`, `quantidade`) contra produto `publicar_no_site` ativo, calcula preço vigente **no banco** (mesma regra da Task 2), confere estoque disponível (garrafas a_venda − vendidas − baixadas − segurança ≥ quantidade), aloca `itens_lote` FIFO por `data_liberacao` do lote, cria `pedidos` (origem `site`, `pagamento_status 'aguardando_pagamento'`, `expira_em now() + interval '24 hours'`) + `pedido_itens`. Erro de estoque/preço → exceção com mensagem em português (vira 400 no checkout). Retorna `{ pedido_id, total_centavos, itens: [{descricao, quantidade, preco_centavos}] }`.
- Produces: função `public.estornar_pedido_site(p_order_nsu text, p_motivo text) returns void` — marca `cancelado`/`estornado` e, se já virou venda, cria `estornos` + `estorno_itens` no padrão existente.

- [ ] **Step 1: Teste de presença no SQL** (colunas, índice único, as três funções, `security definer`). **Step 2: Falhar. Step 3: Escrever migração. Step 4: `npm test` PASS.**
- [ ] **Step 5: `npx supabase db push`.**
- [ ] **Step 6: Commit** — `feat: pedidos do site e RPCs de checkout`.

### Task 8: Site — helper Supabase e suite de testes

**Files (repo `malbe-site`):**
- Create: `package.json` (`{ "private": true, "scripts": { "test": "node --test" } }`)
- Create: `api/_lib.js`
- Test: `tests/lib.test.js`

**Interfaces:**
- Produces (CJS, sem dependências — só `fetch` global):
  - `rpc(nome, args, env) -> Promise<{ ok, status, dados }>` — `POST ${env.SUPABASE_URL}/rest/v1/rpc/${nome}` com headers `apikey`/`Authorization: Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`.
  - `logIntegracao({ direcao, request, response, statusHttp, erro, pedidoId }, env)` — insert em `integracao_logs` via PostgREST; nunca lança (falha de log não derruba o fluxo).
  - `aplicarCors(req, res)` — extraído do `api/checkout.js` atual, mesmo comportamento.

- [ ] **Step 1: Testes com `fetch` stubado** (`t.mock.method(globalThis, 'fetch', ...)`): URL/headers corretos no `rpc`; `logIntegracao` engole erro de rede. **Step 2: Falhar. Step 3: Implementar. Step 4: `node --test` PASS.**
- [ ] **Step 5: Commit** — `feat: helpers de integração com a Supabase`.

### Task 9: Site — checkout grava pedido e cria link completo

**Files (repo `malbe-site`):**
- Modify: `api/checkout.js`
- Test: `tests/checkout.test.js`

**Interfaces:**
- Consumes: `rpc`, `logIntegracao`, `aplicarCors` (Task 8); `criar_pedido_site` (Task 7).
- Produces: handler que (1) valida formato do body como hoje; (2) gera `order_nsu` como hoje; (3) chama `criar_pedido_site` — erro da RPC vira 400 com a mensagem em português da exceção (estoque insuficiente, produto indisponível); (4) monta o corpo InfinitePay com os itens **retornados pela RPC** (preço do banco, nunca do navegador nem do produtos.json), mais `webhook: { url: "https://www.malbevinhos.com.br/api/webhook-infinitepay", events: ["paid","refunded","canceled"] }`, `options.valid_until` = agora+24h ISO 8601, `options.single_payment: true`; (5) grava `checkout_url` no pedido; (6) loga request/response completos da InfinitePay (direcao `checkout`). Leitura de `produtos.json` sai do handler.

- [ ] **Step 1: Testes com `fetch` stubado**: estoque insuficiente → 400 sem chamar InfinitePay; preço cobrado = preço da RPC (promoção expirada no banco → cobra preço cheio mesmo que o site mostre promo); corpo InfinitePay contém `webhook.events`, `valid_until` futuro e `single_payment`; log gravado com os dois JSONs completos; InfinitePay 422 → 502 e log com body do erro.
- [ ] **Step 2: Falhar. Step 3: Implementar. Step 4: `node --test` PASS.**
- [ ] **Step 5: Configurar env na Vercel do site**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INFINITEPAY_HANDLE`, `INTEGRACAO_SECRET`.
- [ ] **Step 6: Commit** — `feat: checkout registra pedido no gestão antes do link`.

### Task 10: Site — webhook InfinitePay

**Files (repo `malbe-site`):**
- Create: `api/webhook-infinitepay.js`
- Test: `tests/webhook.test.js`

**Interfaces:**
- Consumes: `rpc`, `logIntegracao` (Task 8); `confirmar_pedido_site`, `estornar_pedido_site` (Task 7).
- Produces: handler POST que:
  1. loga o payload recebido **sempre**, inclusive inválido (direcao `webhook`);
  2. payload sem `order_nsu`/`transaction_nsu`/`invoice_slug` → 400;
  3. confirma autenticidade: `POST https://api.checkout.infinitepay.io/payment_check` com `{ handle: env.INFINITEPAY_HANDLE, order_nsu, transaction_nsu, slug: invoice_slug }`, logado (direcao `payment_check`); qualquer resposta sem `paid: true` → responde 200 (para a InfinitePay não reenviar) sem confirmar nada, log com `erro`;
  4. evento `paid` + `paid: true` → `confirmar_pedido_site(...)` (idempotente no banco) e dispara `POST ${GESTAO_URL}/api/publicar-site` com `x-integracao-secret` quando algum item esgotou (a RPC de confirmação retorna também `esgotou boolean` — ajustar retorno para `jsonb` na Task 7 se necessário);
  5. eventos `refunded`/`canceled` → `estornar_pedido_site(order_nsu, evento)`;
  6. responde 200 em menos de 1s nos casos tratados; erro interno → 500 (InfinitePay reenvia).

- [ ] **Step 1: Testes com `fetch` stubado**: `paid` válido → confirma e responde 200; **reenvio do mesmo webhook → segunda chamada não cria segunda venda (RPC idempotente é chamada, resposta 200)**; `payment_check` com `paid:false` → 200 sem confirmação, log com erro; payload sem campos → 400 e log; `refunded` → estorno; falha Supabase → 500.
- [ ] **Step 2: Falhar. Step 3: Implementar. Step 4: `node --test` PASS. Step 5: Commit** — `feat: webhook de pagamento da InfinitePay`.

### Task 11: Expiração e republicação automática (cron)

**Files (repo `malbe-gestao`):**
- Create: `api/cron-site.js`
- Modify: `vercel.json` (bloco `crons`: `{ "path": "/api/cron-site", "schedule": "0 9 * * *" }` — 06:00 BRT)
- Test: `tests/cron-site.test.js`

**Interfaces:**
- Consumes: `publicar` (Task 5).
- Produces: handler que (1) marca `pagamento_status = 'expirado'` nos pedidos site `aguardando_pagamento` com `expira_em < now()`; (2) republica o catálogo quando alguma promoção começou ou terminou desde a última publicação (comparar datas de vigência com `publicacoes_site.criado_em` mais recente); exige header `Authorization: Bearer ${CRON_SECRET}` (padrão Vercel Cron).

- [ ] **Step 1: Testes** (expira só os vencidos; republica só com virada de promoção; 401 sem secret). **Step 2: Falhar. Step 3: Implementar. Step 4: `npm test` PASS. Step 5: Commit** — `feat: cron de expiração e promoções`.

### Task 12: Gestão — aba "Pedidos do site" + notificação

**Files (repo `malbe-gestao`):**
- Create: `src/ui/pedidos-site.js`
- Modify: `src/ui/rotas.js`, `src/ui/menu.js`
- Modify: `api/cron-site.js` ou novo `src/notificacao.js` — envio de e-mail
- Test: `tests/pedidos-site-tela.test.js`, `tests/notificacao.test.js`

**Interfaces:**
- Consumes: `pedidos` com `origem = 'site'`.
- Produces: tela listando pedidos do site separados do balcão: itens, `pagamento_status`, `order_nsu`, link `checkout_url`, `receipt_url` quando pago. Notificação: `notificarPagamento(pedido, env)` — e-mail via Resend (`POST https://api.resend.com/emails`, `Authorization: Bearer ${RESEND_API_KEY}`, para `NOTIFICACAO_EMAIL`) com itens e total; chamada pelo webhook (Task 10) via endpoint `POST /api/notificar` no gestão protegido pelo `INTEGRACAO_SECRET`; toda chamada logada (direcao `notificacao`). WhatsApp fica para depois (fora deste plano).

- [ ] **Step 1: Testes** (render da tela com status; e-mail com destinatário/total certos, log gravado, falha de envio não lança). **Step 2: Falhar. Step 3: Implementar. Step 4: `npm test` PASS. Step 5: Commit** — `feat: pedidos do site e notificação de pagamento`.

### Task 13: Ponta a ponta real e subida a produção

**Files:** nenhum (validação).

- [ ] **Step 1: Subir tudo**: gestão → push + `npx vercel promote`; site → push no `main`.
- [ ] **Step 2: Publicar lote real** pelo gestão; conferir commit, deploy e site.
- [ ] **Step 3: Compra real com o vinho de teste de R$ 5** (pagamento real — PIX): conferir pedido `aguardando_pagamento` → webhook → venda criada, estoque baixado, e-mail recebido, logs com JSONs completos nas direções `checkout`, `webhook`, `payment_check`, `notificacao`.
- [ ] **Step 4: Estornar o pagamento de teste** na InfinitePay e conferir o evento `refunded` gerando estorno no gestão.
- [ ] **Step 5: Remover o vinho de teste de R$ 5** do catálogo (despublicar no gestão e republicar).
