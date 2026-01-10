const { getAdminByEmail, createAdmin, listPaidInscricoes, listPaidOrdersDetailed, listDonations, listPaidDonations, listOrders, clearCartForUser, updateOrderPaymentStatus, getOrder, deleteUnpaidOrders, getInscricao } = require('../mysql');
const { getPaymentStatus } = require('../services/payment');
const bcrypt = require('bcryptjs');

// Exibe a página de login do administrador
exports.loginPage = (req, res) => {
  res.render('admin/login', { pageTitle: 'Entrar como administrador', pageClass: 'auth-page' });
};

// Processa o login do administrador
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

// Faz logout do administrador
exports.logout = (req, res) => {
  delete req.session.admin;
  res.redirect('/');
};

// Middleware para verificar se o usuário é administrador
exports.requireAdmin = (req, res, next) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  next();
};

// Exibe o dashboard do administrador
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

// Lista as inscrições pagas
exports.viewInscricoes = async (req, res) => {
  const rows = await listPaidInscricoes();
  const fmt = (d) => {
    if (!d) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };
  const getAge = (d) => {
    if (!d) return '';
    const today = new Date();
    const birth = new Date(d);
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  };
  const out = rows.map(r => {
    const dt = r.paid_at ? new Date(r.paid_at) : null;
    const nasc = r.nascimento ? new Date(r.nascimento) : null;
    return {
      ...r,
      paid_at_br: dt ? fmt(dt) : '',
      nascimento_br: nasc ? fmt(nasc) : '',
      idade: nasc ? getAge(nasc) : '',
      whatsapp_link: r.whatsapp ? `https://wa.me/55${r.whatsapp.replace(/\D/g, '')}` : '#'
    };
  });
  res.render('admin/inscricoes', { pageTitle: 'Inscrições pagas', rows: out, count: out.length });
};

// Lista os pedidos pagos
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
  const sizes = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'U'];
  const productMap = {};
  for (const r of rows) {
    for (const it of r.items || []) {
      const pid = String(it.product_id || '');
      if (!pid) continue;
      if (!productMap[pid]) {
        const isRegular = pid.endsWith('_regular');
        const counts = {}; sizes.forEach(s => counts[s] = 0);
        const type = pid === 'cordao_alfa_omega' ? 'Acessório' : (isRegular ? 'Regular' : 'Oversized');
        productMap[pid] = { name: it.name, type, counts };
      }
      const sz = sizes.includes(String(it.size)) ? String(it.size) : null;
      if (sz) productMap[pid].counts[sz] += Number(it.qty || 0);
    }
  }
  const productsSummary = Object.values(productMap).map(p => ({
    ...p,
    sizes: sizes.filter(s => Number(p.counts[s] || 0) > 0).map(s => `${s}: ${p.counts[s]}`)
  }));
  const cordaoCounts = productMap['cordao_alfa_omega'] ? productMap['cordao_alfa_omega'].counts : null;
  const cordaoTotal = cordaoCounts ? Object.values(cordaoCounts).reduce((acc, n) => acc + Number(n || 0), 0) : 0;
  res.render('admin/pedidos', { pageTitle: 'Pedidos pagos', rows: out, count: out.length, netTotalBRL: money.format(netTotal), productsSummary, cordaoTotal });
};

// Lista as doações
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

// Exibe página para criar novo administrador
exports.adminCreatePage = (req, res) => {
  res.render('admin/admin_new', { pageTitle: 'Criar novo administrador' });
};

// Processa a criação de novo administrador
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

// Remove pedidos não pagos
exports.purgeUnpaidOrders = async (req, res) => {
  try {
    const deleted = await deleteUnpaidOrders();
    res.json({ ok: true, deleted });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

// Baixa arquivo da inscrição (doc, foto, santo)
exports.downloadInscricaoFile = async (req, res) => {
  try {
    const { id, tipo } = req.params;
    const insc = await getInscricao(id);
    if (!insc) return res.status(404).send('Inscrição não encontrada');

    let blob, mime, filename;
    if (tipo === 'doc') {
      blob = insc.doc_blob;
      mime = insc.doc_mime;
      filename = `doc_${insc.cpf}.${mime.split('/')[1]}`;
    } else if (tipo === 'foto') {
      blob = insc.foto_blob;
      mime = insc.foto_mime;
      filename = `foto_${insc.cpf}.${mime.split('/')[1]}`;
    } else if (tipo === 'santo') {
      blob = insc.foto_santo_blob;
      mime = insc.foto_santo_mime;
      filename = `santo_${insc.cpf}.${mime.split('/')[1]}`;
    } else {
      return res.status(400).send('Tipo de arquivo inválido');
    }

    if (!blob) return res.status(404).send('Arquivo não encontrado');

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(blob);
  } catch (e) {
    console.error(e);
    res.status(500).send('Erro ao baixar arquivo');
  }
};
