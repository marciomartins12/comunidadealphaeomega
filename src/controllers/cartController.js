const { addCartItem, getCartItemsForUser, updateCartItem, deleteCartItem, createOrderWithItems, getOrder, updateOrderPaymentStatus, updateOrderPaymentData, getPaidOrdersForUser, getOrderItems, clearCartForUser, getOrdersForUser, getPendingOrderForUser, updateOrderWithItemsAndPayment, cancelPendingOrderForUser } = require('../mysql');
const { createPixPayment, getPaymentStatus } = require('../services/payment');

const products = {
  quadrinho_pb_branca: {
    id: 'quadrinho_pb_branca',
    name: 'Quadrinho P&B Santos',
    price: 68.0,
    image: '/public/img/loja/MODELOQUADRINHOSANTOSP&BBRANCAOVERSIZED.png'
  },
  quadrinho_pb_branca_regular: {
    id: 'quadrinho_pb_branca_regular',
    name: 'Quadrinho P&B Santos (regular)',
    price: 52.0,
    image: '/public/img/loja/MODELOQUADRINHOSANTOSP&B-BRANCA.png'
  },
  quadrinho_color_preta: {
    id: 'quadrinho_color_preta',
    name: 'Quadrinho Color Santos',
    price: 68.0,
    image: '/public/img/loja/MODELOQUADRINHOSANTOSCOLOR-PRETA OVERSIZED.png'
  },
  quadrinho_color_preta_regular: {
    id: 'quadrinho_color_preta_regular',
    name: 'Quadrinho Color Santos (preta regular)',
    price: 52.0,
    image: '/public/img/loja/MODELOQUADRINHOSANTOSCOLORPRETA.png'
  }
  ,
  cordao_alfa_omega: {
    id: 'cordao_alfa_omega',
    name: 'Cordão Alfa&Ômega',
    price: 12.0,
    image: '/public/img/loja/cordao.jpeg'
  }
};

// Adiciona item ao carrinho
exports.add = async (req, res) => {
  try {
    const u = req.session.user;
    if (!u) return res.status(401).json({ ok: false, error: 'login_required', loginUrl: '/login?next=/carrinho' });
    const { product_id, size, qty } = req.body;
    const p = products[product_id];
    if (!p) return res.status(400).json({ ok: false, error: 'invalid_product' });
    const q = Math.max(1, Math.min(parseInt(qty || '1', 10), 99));
    const s = String(size || '').toUpperCase();
    if (!['PP', 'P', 'M', 'G', 'GG', 'XG', 'U'].includes(s)) return res.status(400).json({ ok: false, error: 'invalid_size' });
    await addCartItem({ user_id: u.id, product_id: p.id, name: p.name, size: s, qty: q, price: p.price });
    res.json({ ok: true, redirect: '/carrinho' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.code || e.message || 'internal_error' });
  }
};

// Exibe o carrinho de compras
exports.view = async (req, res) => {
  const u = req.session.user;
  if (!u) return res.redirect('/login?next=/carrinho');
  const items = await getCartItemsForUser(u.id);
  const pendingOrder = await getPendingOrderForUser(u.id);
  const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const mapped = items.map(it => ({
    ...it,
    image: products[it.product_id]?.image,
    hasSize: it.product_id !== 'cordao_alfa_omega',
    selPP: it.size === 'PP',
    selP: it.size === 'P',
    selM: it.size === 'M',
    selG: it.size === 'G',
    selGG: it.size === 'GG',
    selXG: it.size === 'XG',
    size: it.size,
    priceBRL: fmt.format(Number(products[it.product_id]?.price ?? it.price)),
    lineBRL: fmt.format(Number(products[it.product_id]?.price ?? it.price) * Number(it.qty))
  }));
  const total = items.reduce((acc, it) => acc + Number(products[it.product_id]?.price ?? it.price) * Number(it.qty), 0);
  const valor = fmt.format(total);
  res.render('carrinho', { pageTitle: 'Carrinho', items: mapped, totalBRL: valor, pageClass: 'cart-page', pendingOrderId: pendingOrder?.id || null, pendingOrderTotalBRL: pendingOrder ? fmt.format(Number(pendingOrder.total || 0)) : null });
};

// Atualiza item do carrinho
exports.updateItem = async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'login_required' });
  const { id, size, qty } = req.body;
  const s = String(size || '').toUpperCase();
  if (!['PP', 'P', 'M', 'G', 'GG', 'XG', 'U'].includes(s)) return res.status(400).json({ ok: false, error: 'invalid_size' });
  const q = Math.max(1, Math.min(parseInt(qty || '1', 10), 99));
  await updateCartItem({ user_id: u.id, id, size: s, qty: q });
  res.json({ ok: true });
};

// Remove item do carrinho
exports.deleteItem = async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'login_required' });
  const { id } = req.body;
  await deleteCartItem({ user_id: u.id, id });
  res.json({ ok: true });
};

// Inicia o checkout (pagamento)
exports.checkout = async (req, res) => {
  try {
    const u = req.session.user;
    if (!u) return res.redirect('/login?next=/carrinho');
    const existing = await getPendingOrderForUser(u.id);
    const items = await getCartItemsForUser(u.id);
    if (!items || items.length === 0) return res.redirect('/carrinho');
    const totalRaw = items.reduce((acc, it) => {
      const unit = products[it.product_id]?.price;
      const base = unit != null ? Number(unit) : Number(it.price);
      const qty = Number(it.qty);
      const line = (Number.isFinite(base) ? base : 0) * (Number.isFinite(qty) ? qty : 0);
      return acc + line;
    }, 0);
    const total = Number(totalRaw.toFixed(2));
    if (!Number.isFinite(total) || total <= 0) return res.status(400).send('Total inválido para pagamento');
    const pay = await createPixPayment({ amount: total, description: 'Compra Loja RC', nome: u.nome, cpf: u.cpf });
    if (existing) {
      await updateOrderWithItemsAndPayment({ id: existing.id, items: items.map(it => ({ product_id: it.product_id, name: it.name, size: it.size, qty: it.qty, price: (products[it.product_id]?.price ?? it.price) })), total, payment: {
        payment_id: pay.payment_id,
        qr_code: pay.qr_code,
        qr_base64: pay.qr_base64,
        ticket_url: pay.ticket_url
      } });
      return res.redirect(`/loja/pagamento/${existing.id}`);
    }
    const orderId = await createOrderWithItems({ user_id: u.id, items: items.map(it => ({ product_id: it.product_id, name: it.name, size: it.size, qty: it.qty, price: (products[it.product_id]?.price ?? it.price) })), payment: {
      payment_id: pay.payment_id,
      qr_code: pay.qr_code,
      qr_base64: pay.qr_base64,
      ticket_url: pay.ticket_url
    }, total });
    res.redirect(`/loja/pagamento/${orderId}`);
  } catch (e) {
    res.status(500).send('Erro ao iniciar pagamento: ' + e.message);
  }
};

// Exibe página de pagamento do pedido da loja
exports.pagamentoLoja = async (req, res) => {
  const { id } = req.params;
  const order = await getOrder(id);
  if (!order) return res.status(404).send('Pedido não encontrado');
  const valorBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(order.total));
  res.render('pagamento_loja', {
    pageTitle: 'Pagamento Loja',
    qr_code_base64: order.mp_qr_base64,
    qr_code: order.mp_qr_code,
    ticket_url: order.mp_ticket_url,
    status: order.mp_status || 'pending',
    valor: valorBRL,
    orderId: id
  });
};

// Verifica status do pagamento do pedido da loja
exports.pagamentoLojaStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await getOrder(id);
    if (!order) return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    let status = order.mp_status || 'pending';
    let recreated = false;
    if (order.mp_payment_id) {
      try {
        const info = await getPaymentStatus(order.mp_payment_id);
        status = info.status || status;
        const expStr = info.date_of_expiration;
        let expired = false;
        if (status === 'expired') expired = true;
        else if (expStr) {
          const expDate = new Date(expStr);
          if (!isNaN(expDate) && Date.now() > expDate.getTime()) expired = true;
        }
        if (expired && status !== 'approved') {
          const newPay = await createPixPayment({ amount: Number(order.total), description: 'Compra Loja RC', nome: req.session.user?.nome || '', cpf: req.session.user?.cpf || '' });
          await updateOrderPaymentData(id, {
            mp_payment_id: newPay.payment_id,
            mp_qr_code: newPay.qr_code,
            mp_qr_base64: newPay.qr_base64,
            mp_ticket_url: newPay.ticket_url,
            mp_status: 'pending'
          });
          status = 'pending';
          recreated = true;
        }
      } catch {}
    }
    if (status === 'approved' && order.mp_status !== 'approved') {
      await clearCartForUser(order.user_id);
    }
    await updateOrderPaymentStatus(id, status);
    res.json({ ok: true, status, paid: status === 'approved', recreated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.historico = async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'login_required' });
  const fmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const list = await getOrdersForUser(u.id);
  const out = [];
  for (const o of list) {
    let status = o.mp_status || 'pending';
    if (o.mp_payment_id && status !== 'approved') {
      try {
        const info = await getPaymentStatus(o.mp_payment_id);
        status = info.status || status;
        await updateOrderPaymentStatus(o.id, status);
      } catch {}
    }
    if (status === 'approved') {
      const items = await getOrderItems(o.id);
      out.push({
        id: o.id,
        total: money.format(Number(o.total)),
        paid_at: o.paid_at ? fmt.format(new Date(o.paid_at)) : null,
        items: items.map(it => ({ product_id: it.product_id, name: it.name, size: it.size, qty: it.qty, price: money.format(Number(it.price)), image: products[it.product_id]?.image || '' }))
      });
    }
  }
  res.json({ ok: true, orders: out });
};

// Conta itens no carrinho
exports.count = async (req, res) => {
  try {
    const u = req.session.user;
    if (!u) return res.json({ ok: true, count: 0 });
    const items = await getCartItemsForUser(u.id);
    const count = (items || []).reduce((acc, it) => acc + Number(it.qty || 0), 0);
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
exports.cancelPending = async (req, res) => {
  const u = req.session.user;
  if (!u) return res.status(401).json({ ok: false, error: 'login_required' });
  const canceled = await cancelPendingOrderForUser(u.id);
  res.json({ ok: true, canceled });
};
