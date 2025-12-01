exports.home = (req, res) => {
  res.render('index', {
    pageTitle: 'Retiro Alfa & Ômega',
    year: new Date().getFullYear()
  });
};

exports.sobre = (req, res) => {
  res.send('Página Sobre o Retiro em construção.');
};

exports.inscricao = (req, res) => {
  res.render('inscricao', {
    pageTitle: 'Inscrição'
  });
};

const { saveInscricao, getInscricao, getByCpf, updatePaymentStatus, updatePaymentData, getInscricaoByPaymentId, getOrderByPaymentId, updateOrderPaymentStatus, clearCartForUser } = require('../mysql');
const { createPixPayment, getPaymentStatus } = require('../services/payment');
const AMOUNT = Number(process.env.INSCRICAO_AMOUNT || 0.20);

const validaCPF = (cpf) => {
  const c = (cpf || '').replace(/\D/g, '');
  if (!c || c.length !== 11 || /^([0-9])\1{10}$/.test(c)) return false;
  const calc = (base) => {
    let sum = 0; for (let i = 0; i < base; i++) sum += parseInt(c[i], 10) * (base + 1 - i);
    const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(c[9], 10) && calc(10) === parseInt(c[10], 10);
};

exports.inscricaoPost = async (req, res) => {
  try {
    const b = req.body;
    const f = req.files || {};

    if (!validaCPF(b.cpf)) {
      return res.status(400).send('CPF inválido');
    }

    const cpfPlain = (b.cpf || '').replace(/\D/g, '');
    const existing = await getByCpf(cpfPlain);
    if (existing) {
      return res.status(409).send('CPF já cadastrado. Verifique o andamento da inscrição.');
    }

    const docF = f.doc?.[0];
    const fotoF = f.foto?.[0];
    const fotoSantoF = f.fotoSanto?.[0];
    const termoF = f.termo?.[0];
    const justificativaF = f.justificativa?.[0];

    const allowed = (m) => m && (m.startsWith('image/') || m === 'application/pdf');
    const must = (file, name) => {
      if (!file) throw new Error(`${name} é obrigatório`);
      if (!allowed(file.mimetype)) throw new Error(`${name} deve ser imagem ou PDF`);
    };
    must(docF, 'Documento de identificação');
    must(fotoF, 'Foto pessoal');
    must(fotoSantoF, 'Foto com santo de devoção');
    if (termoF && !allowed(termoF.mimetype)) throw new Error('Termo de responsabilidade deve ser imagem ou PDF');
    if (justificativaF && !allowed(justificativaF.mimetype)) throw new Error('Justificativa deve ser imagem ou PDF');

    const ageFrom = (d) => {
      try { const dt = new Date(d); if (isNaN(dt)) return null; const today = new Date(); let age = today.getFullYear() - dt.getFullYear(); const m = today.getMonth() - dt.getMonth(); if (m < 0 || (m === 0 && today.getDate() < dt.getDate())) age--; return age; } catch { return null; }
    };
    const age = ageFrom(b.nascimento);
    if (age !== null && age <= 17) {
      must(termoF, 'Termo de responsabilidade');
    }

    const payment = await createPixPayment({
      amount: AMOUNT,
      description: 'Inscrição Retiro Alfa&Ômega',
      nome: b.nome,
      cpf: b.cpf
    });

    const id = await saveInscricao({
      nome: b.nome,
      sexo: b.sexo,
      nascimento: b.nascimento,
      whatsapp: b.whatsapp,
      emergencia: b.emergencia,
      endereco: b.endereco,
      frase: b.frase,
      cpf: cpfPlain,
      doc_blob: docF?.buffer, doc_mime: docF?.mimetype || 'application/octet-stream',
      foto_blob: fotoF?.buffer, foto_mime: fotoF?.mimetype || 'application/octet-stream',
      foto_santo_blob: fotoSantoF?.buffer, foto_santo_mime: fotoSantoF?.mimetype || 'application/octet-stream',
      termo_blob: termoF?.buffer, termo_mime: termoF?.mimetype || null,
      justificativa_blob: justificativaF?.buffer, justificativa_mime: justificativaF?.mimetype || null,
      mp_payment_id: payment.payment_id,
      mp_qr_code: payment.qr_code,
      mp_qr_base64: payment.qr_base64,
      mp_ticket_url: payment.ticket_url,
      mp_status: 'pending'
    });

    res.redirect(`/pagamento/${id}`);
  } catch (err) {
    res.status(500).send('Erro ao processar inscrição: ' + err.message);
  }
};

exports.pagamento = async (req, res) => {
  const { id } = req.params;
  const data = await getInscricao(id);
  if (!data) return res.status(404).send('Inscrição não encontrada');
  const valorBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(AMOUNT);
  res.render('pagamento', {
    pageTitle: 'Pagamento',
    qr_code_base64: data.mp_qr_base64,
    qr_code: data.mp_qr_code,
    ticket_url: data.mp_ticket_url,
    status: data.mp_status || 'pending',
    valor: valorBRL,
    inscricaoId: id
  });
};

exports.pagamentoStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getInscricao(id);
    if (!data) return res.status(404).json({ ok: false, error: 'Inscrição não encontrada' });
    let status = data.mp_status || 'pending';
    let recreated = false;
    if (data.mp_payment_id) {
      try {
        const info = await getPaymentStatus(data.mp_payment_id);
        status = info.status || status;
        const expStr = info.date_of_expiration;
        let expired = false;
        if (status === 'expired') expired = true;
        else if (expStr) {
          const expDate = new Date(expStr);
          if (!isNaN(expDate) && Date.now() > expDate.getTime()) expired = true;
        }
        if (expired && status !== 'approved') {
          const newPay = await createPixPayment({ amount: AMOUNT, description: 'Inscrição Retiro Alfa&Ômega', nome: data.nome, cpf: data.cpf });
          await updatePaymentData(id, {
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
    await updatePaymentStatus(id, status);
    res.json({ ok: true, status, paid: status === 'approved', recreated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

exports.mercadoPagoWebhook = async (req, res) => {
  try {
    const body = req.body || {};
    const paymentId = body?.data?.id || body?.id || req.query?.id;
    if (!paymentId) return res.status(200).json({ ok: true });
    const { getPaymentStatus } = require('../services/payment');
    const info = await getPaymentStatus(paymentId);
    const status = info.status || 'pending';
    const inscr = await getInscricaoByPaymentId(String(paymentId));
    if (inscr) {
      await updatePaymentStatus(inscr.id, status);
      return res.status(200).json({ ok: true });
    }
    const order = await getOrderByPaymentId(String(paymentId));
    if (order) {
      const wasApproved = order.mp_status === 'approved';
      await updateOrderPaymentStatus(order.id, status);
      if (status === 'approved' && !wasApproved) {
        await clearCartForUser(order.user_id);
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: true });
  }
};

exports.loja = (req, res) => {
  res.render('loja', {
    pageTitle: 'Loja'
  });
};

exports.revista = (req, res) => {
  const { slug } = req.params;
  res.send(`A revista "${slug}" estará disponível em fevereiro.`);
};

exports.galeria = (req, res) => {
  res.send('Galeria em construção.');
};

exports.documentario = (req, res) => {
  res.send('Documentário RC em construção.');
};

exports.agenda = (req, res) => {
  res.send('Agenda RC em construção.');
};
exports.inscricaoStatus = async (req, res) => {
  try {
    const cpf = (req.query.cpf || '').replace(/\D/g, '');
    if (!cpf || cpf.length !== 11) return res.json({ ok: true, exists: false });
    const inscr = await getByCpf(cpf);
    if (!inscr) return res.json({ ok: true, exists: false });
    const status = inscr.mp_status || 'pending';
    const paid = (status === 'approved') || !!inscr.paid_at;
    return res.json({ ok: true, exists: true, paid, status, inscricaoId: inscr.id, paymentUrl: `/pagamento/${inscr.id}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
