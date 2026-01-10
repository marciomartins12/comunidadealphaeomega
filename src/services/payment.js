const { MercadoPagoConfig, Payment } = require('mercadopago');

const accessToken = process.env.MP_ACCESS_TOKEN;
let paymentClient;

if (accessToken) {
  const client = new MercadoPagoConfig({ accessToken });
  paymentClient = new Payment(client);
}

const validaCPF = (cpf) => {
  const c = (cpf || '').replace(/\D/g, '');
  if (!c || c.length !== 11 || /^([0-9])\1{10}$/.test(c)) return false;
  const calc = (base) => {
    let sum = 0; for (let i = 0; i < base; i++) sum += parseInt(c[i], 10) * (base + 1 - i);
    const rest = (sum * 10) % 11; return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(c[9], 10) && calc(10) === parseInt(c[10], 10);
};

exports.createPixPayment = async ({ amount, description, nome, cpf }) => {
  if (!paymentClient) {
    throw new Error('MP_ACCESS_TOKEN não configurado');
  }
  const amtNum = Number(amount);
  const transaction_amount = Number.isFinite(amtNum) ? Number(amtNum.toFixed(2)) : NaN;
  if (!Number.isFinite(transaction_amount) || transaction_amount <= 0) {
    throw new Error('Invalid transaction_amount');
  }
  const body = {
    transaction_amount,
    description,
    payment_method_id: 'pix',
    notification_url: process.env.MP_NOTIFICATION_URL || undefined,
    payer: {
      email: process.env.MP_PAYER_EMAIL_DEFAULT || 'inscricao@retiro.local',
      first_name: nome,
      ...(validaCPF(cpf) ? { identification: { type: 'CPF', number: String(cpf).replace(/\D/g, '') } } : {})
    }
  };

  const resp = await paymentClient.create({ body });
  return {
    payment_id: String(resp.id),
    qr_code: resp.point_of_interaction?.transaction_data?.qr_code,
    qr_base64: resp.point_of_interaction?.transaction_data?.qr_code_base64,
    ticket_url: resp.point_of_interaction?.transaction_data?.ticket_url || resp.point_of_interaction?.transaction_data?.external_resource_url
  };
};
exports.getPaymentStatus = async (id) => {
  if (!paymentClient) throw new Error('MP_ACCESS_TOKEN não configurado');
  const resp = await paymentClient.get({ id });
  const exp = resp.date_of_expiration || resp.point_of_interaction?.transaction_data?.date_of_expiration;
  return { status: resp.status, date_of_expiration: exp };
};
