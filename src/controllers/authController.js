const { createUser, getUserByEmail, getUserByCpf, updateUserPasswordByEmailCpf } = require('../mysql');
const bcrypt = require('bcryptjs');

exports.loginPage = (req, res) => {
  const next = req.query.next || '/carrinho';
  res.render('login', { pageTitle: 'Entrar', next, pageClass: 'auth-page' });
};

exports.loginPost = async (req, res) => {
  try {
    const { email, senha, next } = req.body;
    const u = await getUserByEmail(email);
    if (!u) return res.status(401).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Email ou senha inválidos', pageClass: 'auth-page' });
    const ok = await bcrypt.compare(senha, u.senha_hash);
    if (!ok) return res.status(401).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Email ou senha inválidos', pageClass: 'auth-page' });
    req.session.user = { id: u.id, nome: u.nome, email: u.email, cpf: u.cpf, cidade: u.cidade };
    res.redirect(next || '/carrinho');
  } catch (e) {
    res.status(500).render('login', { pageTitle: 'Entrar', next: req.body.next || '/carrinho', error: 'Erro ao entrar', pageClass: 'auth-page' });
  }
};

exports.registerPost = async (req, res) => {
  try {
    const { nome, email, senha, cpf, cidade, next } = req.body;
    if (!nome || !email || !senha || !cpf || !cidade) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Preencha todos os campos', pageClass: 'auth-page' });
    const emailNorm = String(email).toLowerCase();
    const cpfNorm = String(cpf).replace(/\D/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Email inválido', pageClass: 'auth-page' });
    if (String(senha).length < 6) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'A senha deve ter pelo menos 6 caracteres', pageClass: 'auth-page' });
    if (cpfNorm.length !== 11) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'CPF inválido', pageClass: 'auth-page' });
    const existsEmail = await getUserByEmail(emailNorm);
    if (existsEmail) return res.status(409).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Email já cadastrado' });
    const existsCpf = await getUserByCpf(cpfNorm);
    if (existsCpf) return res.status(409).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'CPF já cadastrado' });
    const hash = await bcrypt.hash(senha, 10);
    const id = await createUser({ nome, email: emailNorm, senha_hash: hash, cpf: cpfNorm, cidade: String(cidade).trim() });
    req.session.user = { id, nome, email: String(email).toLowerCase(), cpf: cpf.replace(/\D/g, ''), cidade: String(cidade).trim() };
    res.redirect(next || '/carrinho');
  } catch (e) {
    const msg = (e && e.code === 'ER_DUP_ENTRY') ? 'Email ou CPF já cadastrado' : (e && e.message ? 'Erro: ' + e.message : 'Não foi possível criar a conta');
    res.status(400).render('login', { pageTitle: 'Entrar', next: req.body.next || '/carrinho', error: msg, pageClass: 'auth-page' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

exports.resetPasswordPost = async (req, res) => {
  try {
    const { email, cpf, senha, next } = req.body;
    const emailNorm = String(email || '').toLowerCase();
    const cpfNorm = String(cpf || '').replace(/\D/g, '');
    if (!emailNorm || !cpfNorm || !senha) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Preencha email, CPF e nova senha', pageClass: 'auth-page' });
    if (cpfNorm.length !== 11) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'CPF inválido', pageClass: 'auth-page' });
    const u = await getUserByEmail(emailNorm);
    if (!u || String(u.cpf).replace(/\D/g, '') !== cpfNorm) return res.status(404).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Email ou CPF não encontrados', pageClass: 'auth-page' });
    if (String(senha).length < 6) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'A nova senha deve ter pelo menos 6 caracteres', pageClass: 'auth-page' });
    const hash = await bcrypt.hash(senha, 10);
    const updated = await updateUserPasswordByEmailCpf({ email: emailNorm, cpf: cpfNorm, senha_hash: hash });
    if (!updated) return res.status(400).render('login', { pageTitle: 'Entrar', next: next || '/carrinho', error: 'Não foi possível atualizar a senha', pageClass: 'auth-page' });
    res.render('login', { pageTitle: 'Entrar', next: next || '/carrinho', success: 'Senha atualizada com sucesso. Faça login.', pageClass: 'auth-page' });
  } catch (e) {
    res.status(500).render('login', { pageTitle: 'Entrar', next: req.body.next || '/carrinho', error: 'Erro ao recuperar senha', pageClass: 'auth-page' });
  }
};
