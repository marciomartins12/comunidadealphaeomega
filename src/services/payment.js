const { MercadoPagoConfig, Payment } = require('mercadopago');

const accessToken = process.env.MP_ACCESS_TOKEN;
let paymentClient;

if (accessToken) {
  const client = new MercadoPagoConfig({ accessToken });
  paymentClient = new Payment(client);
}

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
      ...(String(cpf || '').replace(/\D/g, '').length === 11 ? { identification: { type: 'CPF', number: String(cpf || '').replace(/\D/g, '') } } : {})
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
