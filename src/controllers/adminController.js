const { getAdminByEmail, createAdmin, listPaidInscricoes, listOrders, listDonations } = require('../mysql');
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
  const [insc, orders, donations] = await Promise.all([listPaidInscricoes(), listOrders(), listDonations()]);
  res.render('admin/dashboard', {
    pageTitle: 'Dashboard do Administrador',
    inscCount: insc.length,
    ordersCount: orders.length,
    donationsCount: donations.length
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
  const rows = await listOrders();
  res.render('admin/pedidos', { pageTitle: 'Gerenciar pedidos', rows });
};

exports.viewDoacoes = async (req, res) => {
  const rows = await listDonations();
  res.render('admin/doacoes', { pageTitle: 'Gerenciar doações', rows });
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
