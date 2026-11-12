/* Webhook da InfinitePay. O aviso NÃO tem assinatura, então nada é confiável
   até o payment_check responder paid: true. Idempotente por order_nsu +
   transaction_nsu (a RPC do banco garante). Responde rápido: 2xx encerra o
   reenvio da InfinitePay; 5xx faz ela tentar de novo.
   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INFINITEPAY_HANDLE,
   GESTAO_URL, INTEGRACAO_SECRET (republicação quando esgota). */

const { rpc, logIntegracao } = require("./_lib.js");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });
  const env = process.env;
  const payload = (req.body && typeof req.body === "object") ? req.body : {};

  // Todo aviso fica registrado, inclusive payload inválido.
  await logIntegracao({ direcao: "webhook", request: payload, response: null, statusHttp: null }, env);

  const { order_nsu, transaction_nsu, invoice_slug } = payload;
  if (!order_nsu || !transaction_nsu || !invoice_slug) {
    return res.status(400).json({ erro: "Payload sem order_nsu, transaction_nsu ou invoice_slug." });
  }

  const evento = payload.event || "paid";

  try {
    if (evento !== "paid") {
      /* refunded/canceled NÃO agem sozinhos: o webhook não tem assinatura e o
         payment_check só prova pagamento — um estorno forjado devolveria
         estoque e apagaria receita. Fica no log; o estorno é lançado no gestão. */
      await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: null, statusHttp: null, erro: `evento ${evento} não é verificável: tratar no gestão` }, env);
      return res.status(200).json({ ok: false });
    }

    if (!env.INFINITEPAY_HANDLE) {
      await logIntegracao({ direcao: "payment_check", request: { order_nsu }, response: null, statusHttp: null, erro: "INFINITEPAY_HANDLE não configurada" }, env);
      return res.status(500).json({ erro: "INFINITEPAY_HANDLE não configurada." });
    }

    // Autenticidade: o payment_check é a única prova de pagamento.
    let check, dadosCheck;
    try {
      check = await fetch("https://api.checkout.infinitepay.io/payment_check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: env.INFINITEPAY_HANDLE, order_nsu, transaction_nsu, slug: invoice_slug }),
      });
      dadosCheck = await check.json();
    } catch (e) {
      await logIntegracao({ direcao: "payment_check", request: { order_nsu, transaction_nsu, slug: invoice_slug }, response: null, statusHttp: null, erro: String(e) }, env);
      return res.status(500).json({ erro: "payment_check indisponível." });
    }
    const pago = check.ok && dadosCheck && dadosCheck.success === true && dadosCheck.paid === true;
    await logIntegracao({
      direcao: "payment_check",
      request: { handle: env.INFINITEPAY_HANDLE ? "(configurado)" : null, order_nsu, transaction_nsu, slug: invoice_slug },
      response: dadosCheck,
      statusHttp: check.status,
      erro: pago ? "" : "payment_check não confirmou o pagamento",
    }, env);
    // Falha transitória (não-2xx) não é "não pago": 500 faz a InfinitePay reenviar.
    if (!check.ok) return res.status(500).json({ erro: "payment_check indisponível." });
    // Resposta 2xx sem paid:true é definitivo: 200, senão a InfinitePay reenvia um aviso que nunca vai confirmar.
    if (!pago) return res.status(200).json({ ok: false });

    const confirmacao = await rpc("confirmar_pedido_site", {
      p_order_nsu: order_nsu,
      p_transaction_nsu: transaction_nsu,
      p_invoice_slug: invoice_slug,
      p_receipt_url: payload.receipt_url || null,
      // Valor verificado pelo payment_check; o payload do webhook é forjável.
      p_paid_amount: Number.isFinite(dadosCheck.amount) ? dadosCheck.amount : null,
    }, env);
    if (!confirmacao.ok) {
      /* 400 é a RPC recusando de vez (pedido estornado, cancelado, pago com
         outra transação, valor menor que o total): reenviar nunca vai mudar
         o resultado, então 200 encerra o reenvio da InfinitePay. */
      if (confirmacao.status === 400) {
        await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: confirmacao.dados, statusHttp: confirmacao.status, erro: "confirmação recusada em definitivo" }, env);
        return res.status(200).json({ ok: false });
      }
      await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: confirmacao.dados, statusHttp: confirmacao.status, erro: "confirmação falhou" }, env);
      return res.status(500).json({ erro: "Falha ao confirmar o pedido." });
    }

    /* Esgotou? A republicação NÃO roda aqui: são várias chamadas ao GitHub e a
       InfinitePay espera 2xx em <1s. A cron do gestão republica quando o
       catálogo gerado difere do publicado; o checkout recusa venda sem estoque
       nesse meio-tempo. */

    // Aviso de venda para o gestão (e-mail); falha não derruba o webhook.
    // Reenvio do mesmo pagamento (repetido) não manda e-mail de novo.
    if (env.GESTAO_URL && env.INTEGRACAO_SECRET && !(confirmacao.dados && confirmacao.dados.repetido)) {
      try {
        await fetch(`${env.GESTAO_URL}/api/notificar`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-integracao-secret": env.INTEGRACAO_SECRET },
          body: JSON.stringify({ orderNsu: order_nsu }),
        });
      } catch (e) { /* notificação é melhor esforço */ }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: null, statusHttp: null, erro: String(e) }, env);
    return res.status(500).json({ erro: "Erro interno." });
  }
};
