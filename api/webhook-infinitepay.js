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
    if (evento === "refunded" || evento === "canceled") {
      const estorno = await rpc("estornar_pedido_site", { p_order_nsu: order_nsu, p_motivo: evento }, env);
      if (!estorno.ok) {
        await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: estorno.dados, statusHttp: estorno.status, erro: "estorno falhou" }, env);
        return res.status(500).json({ erro: "Falha ao estornar." });
      }
      return res.status(200).json({ ok: true });
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
    const pago = dadosCheck && dadosCheck.success === true && dadosCheck.paid === true;
    await logIntegracao({
      direcao: "payment_check",
      request: { handle: env.INFINITEPAY_HANDLE ? "(configurado)" : null, order_nsu, transaction_nsu, slug: invoice_slug },
      response: dadosCheck,
      statusHttp: check.status,
      erro: pago ? "" : "payment_check não confirmou o pagamento",
    }, env);
    // Não confirmado: 200 mesmo assim, senão a InfinitePay reenvia um aviso que nunca vai confirmar.
    if (!pago) return res.status(200).json({ ok: false });

    const confirmacao = await rpc("confirmar_pedido_site", {
      p_order_nsu: order_nsu,
      p_transaction_nsu: transaction_nsu,
      p_invoice_slug: invoice_slug,
      p_receipt_url: payload.receipt_url || null,
      p_paid_amount: Number.isFinite(payload.paid_amount) ? payload.paid_amount : null,
    }, env);
    if (!confirmacao.ok) {
      await logIntegracao({ direcao: "webhook", request: { order_nsu, evento }, response: confirmacao.dados, statusHttp: confirmacao.status, erro: "confirmação falhou" }, env);
      return res.status(500).json({ erro: "Falha ao confirmar o pedido." });
    }

    // Esgotou no site → republica o catálogo (disponivel: false / some).
    if (confirmacao.dados && confirmacao.dados.esgotou && env.GESTAO_URL && env.INTEGRACAO_SECRET) {
      try {
        await fetch(`${env.GESTAO_URL}/api/publicar-site`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-integracao-secret": env.INTEGRACAO_SECRET },
          body: JSON.stringify({}),
        });
      } catch (e) { /* a republicação pode ser refeita pela tela Integrações */ }
    }

    // Aviso de venda para o gestão (e-mail); falha não derruba o webhook.
    if (env.GESTAO_URL && env.INTEGRACAO_SECRET) {
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
