const express = require('express');
const router = express.Router();
const pages = require('../controllers/pagesController');
const auth = require('../controllers/authController');
const cart = require('../controllers/cartController');
const admin = require('../controllers/adminController');
const db = require('../mysql');

router.get('/', pages.home);
router.get('/sobre', pages.sobre);
router.get('/coordenacao', pages.coordenacao);
router.get('/doacao', pages.doacaoPage);
router.post('/doacao', pages.doacaoPost);
router.get('/doacao/pagamento/:id', pages.doacaoPagamento);
router.get('/doacao/status/:id', pages.doacaoPagamentoStatus);
router.get('/inscricao', pages.inscricao);
router.post('/inscricao', (req, res, next) => {
  const up = req.app.locals.upload;
  up.fields([
    { name: 'doc', maxCount: 1 },
    { name: 'foto', maxCount: 1 },
    { name: 'fotoSanto', maxCount: 1 }
  ])(req, res, (err) => err ? next(err) : pages.inscricaoPost(req, res, next));
});
router.get('/inscricao/status', pages.inscricaoStatus);
router.get('/loja', pages.loja);
router.get('/login', auth.loginPage);
router.post('/login', auth.loginPost);
router.post('/register', auth.registerPost);
router.post('/password/reset', auth.resetPasswordPost);
router.get('/logout', auth.logout);
router.post('/cart/add', cart.add);
router.get('/carrinho', cart.view);
router.post('/cart/item/update', cart.updateItem);
router.post('/cart/item/delete', cart.deleteItem);
router.post('/carrinho/checkout', cart.checkout);
router.post('/carrinho/cancel', cart.cancelPending);
router.get('/loja/pagamento/:id', cart.pagamentoLoja);
router.get('/loja/pagamento/status/:id', cart.pagamentoLojaStatus);
router.get('/carrinho/historico', cart.historico);
router.get('/cart/count', cart.count);
router.get('/status/db', async (req, res) => {
  try { await db.ping(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.get('/revista/:slug', pages.revista);
router.get('/galeria', pages.galeria);
router.get('/documentario', pages.documentario);
router.get('/agenda', pages.agenda);
router.get('/pagamento/:id', pages.pagamento);
router.get('/pagamento/status/:id', pages.pagamentoStatus);
router.get('/webhook/mercadopago', express.json({ type: 'application/json' }), pages.mercadoPagoWebhook);
router.post('/webhook/mercadopago', pages.mercadoPagoWebhook);

// Admin
router.get('/admin/login', admin.loginPage);
router.post('/admin/login', admin.loginPost);
router.get('/admin/logout', admin.logout);
router.get('/admin', admin.requireAdmin, admin.dashboard);
router.get('/admin/inscricoes', admin.requireAdmin, admin.viewInscricoes);
router.get('/admin/pedidos', admin.requireAdmin, admin.viewPedidos);
router.get('/admin/doacoes', admin.requireAdmin, admin.viewDoacoes);
router.get('/admin/admins/new', admin.requireAdmin, admin.adminCreatePage);
router.post('/admin/admins/new', admin.requireAdmin, admin.adminCreatePost);
router.get('/admin/pedidos/refresh', admin.requireAdmin, admin.refreshOrdersStatus);
router.get('/admin/pedidos/approve/:id', admin.requireAdmin, admin.approveOrderManual);
router.post('/admin/pedidos/purge-unpaid', admin.requireAdmin, admin.purgeUnpaidOrders);
router.get('/admin/pedidos/purge-unpaid', admin.requireAdmin, admin.purgeUnpaidOrders);

module.exports = router;
