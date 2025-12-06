const { getAdminByEmail, createAdmin, listPaidInscricoes, listPaidOrdersDetailed, listDonations, listPaidDonations, listOrders, clearCartForUser, updateOrderPaymentStatus, getOrder } = require('../mysql');
const { getPaymentStatus } = require('../services/payment');
const bcrypt = require('bcryptjs');

exports.loginPage = (req, res) => {
  res.render('admin/login', { pageTitle: 'Entrar como administrador', pageClass: 'auth-page' });
};

exports.loginPost = async (req, res) => {
  try {
    const { email, senha } = req.body;
    const a = await getAdminByEmail(String(email).toLowerCase());
    if (!a) return res.status(401).render('admin/login', { pageTitle: 'Entrar como administrador', error: 'Email ou senha inválidos', pageClass: 'auth-page' });
    const ok = await bcrypt.compare(senha, a.senha_hash);
    if (!ok) return res.status(401).render('admin/login', { pageTitle: 'Entrar como administrador', error: 'Email ou senha inválidos', pageClass: 'auth-page' });
    req.session.admin = { id: a.id, nome: a.nome, email: a.email };
    res.redirect('/admin');
  } catch (e) {
    res.status(500).render('admin/login', { pageTitle: 'Entrar como administrador', error: 'Erro ao entrar', pageClass: 'auth-page' });
  }
};

exports.logout = (req, res) => {
  delete req.session.admin;
  res.redirect('/');
};

exports.requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
};

exports.dashboard = async (req, res) => {
  const [insc, orders, donations] = await Promise.all([listPaidInscricoes(), listPaidOrdersDetailed(), listPaidDonations()]);
  const fee = 0.0099;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const netTotal = orders.reduce((acc, o) => acc + Number(o.total || 0) * (1 - fee), 0);
  const inscAmount = Number(process.env.INSCRICAO_AMOUNT || 101);
  const netInsc = insc.length * inscAmount * (1 - fee);
  const netDon = donations.reduce((acc, d) => acc + Number(d.amount || 0) * (1 - fee), 0);
  res.render('admin/dashboard', {
    pageTitle: 'Dashboard do Administrador',
    inscCount: insc.length,
    ordersCount: orders.length,
    donationsCount: donations.length,
    ordersNetBRL: money.format(netTotal),
    inscNetBRL: money.format(netInsc),
    donationsNetBRL: money.format(netDon)
  });
};

exports.viewInscricoes = async (req, res) => {
  const rows = await listPaidInscricoes();
  const fmt = (d) => {
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const out = rows.map(r => {
    const dt = r.paid_at ? new Date(r.paid_at) : null;
    return { ...r, paid_at_br: dt ? fmt(dt) : '' };
  });
  res.render('admin/inscricoes', { pageTitle: 'Inscrições pagas', rows: out, count: out.length });
};

exports.viewPedidos = async (req, res) => {
  const rows = await listPaidOrdersDetailed();
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = (d) => {
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const out = rows.map(r => {
    const dt = r.paid_at ? new Date(r.paid_at) : null;
    return { ...r, paid_at_br: dt ? fmt(dt) : '' };
  });
  const fee = 0.0099;
  const netTotal = rows.reduce((acc, r) => acc + Number(r.total || 0) * (1 - fee), 0);
  const sizes = ['PP', 'P', 'M', 'G', 'GG', 'XG'];
  const productMap = {};
  for (const r of rows) {
    for (const it of r.items || []) {
      const pid = String(it.product_id || '');
      if (!pid) continue;
      if (!productMap[pid]) {
        const isRegular = pid.endsWith('_regular');
        const counts = {}; sizes.forEach(s => counts[s] = 0);
        productMap[pid] = { name: it.name, type: isRegular ? 'Regular' : 'Oversized', counts };
      }
      const sz = sizes.includes(String(it.size)) ? String(it.size) : null;
      if (sz) productMap[pid].counts[sz] += Number(it.qty || 0);
    }
  }
  const productsSummary = Object.values(productMap).map(p => ({
    ...p,
    sizes: sizes.filter(s => Number(p.counts[s] || 0) > 0).map(s => `${s}: ${p.counts[s]}`)
  }));
  res.render('admin/pedidos', { pageTitle: 'Pedidos pagos', rows: out, count: out.length, netTotalBRL: money.format(netTotal), productsSummary });
};

exports.viewDoacoes = async (req, res) => {
  const rows = await listDonations();
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmt = (d) => {
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const out = rows.map(r => {
    const paid = r.paid_at ? new Date(r.paid_at) : null;
    const created = r.created_at ? new Date(r.created_at) : null;
    return {
      ...r,
      amount_br: money.format(Number(r.amount || 0)),
      paid_at_br: paid ? fmt(paid) : '',
      created_at_br: created ? fmt(created) : ''
    };
  });
  res.render('admin/doacoes', { pageTitle: 'Doações', rows: out, count: out.length });
};

exports.adminCreatePage = (req, res) => {
  res.render('admin/admin_new', { pageTitle: 'Criar novo administrador' });
};

exports.adminCreatePost = async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).render('admin/admin_new', { pageTitle: 'Criar novo administrador', error: 'Preencha todos os campos' });
    const hash = await bcrypt.hash(senha, 10);
    await createAdmin({ nome, email: String(email).toLowerCase(), senha_hash: hash });
    res.redirect('/admin');
  } catch (e) {
    const msg = (e && e.code === 'ER_DUP_ENTRY') ? 'Email já cadastrado' : 'Erro ao criar administrador';
    res.status(400).render('admin/admin_new', { pageTitle: 'Criar novo administrador', error: msg });
  }
};

exports.refreshOrdersStatus = async (req, res) => {
  try {
    const orders = await listOrders();
    let checked = 0, updated = 0, approved = 0;
    for (const o of orders) {
      if (!o.mp_payment_id) continue;
      if ((o.mp_status || 'pending') === 'approved') continue;
      try {
        const info = await getPaymentStatus(o.mp_payment_id);
        const status = info.status || (o.mp_status || 'pending');
        checked++;
        if (status !== (o.mp_status || 'pending')) {
          updated++;
          await updateOrderPaymentStatus(o.id, status);
          if (status === 'approved') { approved++; await clearCartForUser(o.user_id); }
        }
      } catch {}
    }
    res.json({ ok: true, checked, updated, approved });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.approveOrderManual = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id || isNaN(id)) return res.status(400).json({ ok: false, error: 'invalid_order_id' });
    const order = await getOrder(id);
    if (!order) return res.status(404).json({ ok: false, error: 'order_not_found' });
    await updateOrderPaymentStatus(id, 'approved');
    await clearCartForUser(order.user_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
