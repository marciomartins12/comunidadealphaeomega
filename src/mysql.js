const mysql = require('mysql2/promise');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'retiro';

let pool;

async function ensureDatabase() {
  const conn = await mysql.createConnection({ host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD });
  try {
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } catch (e) {
      const code = e && e.code;
      if (code !== 'ER_DBACCESS_DENIED_ERROR' && code !== 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
        throw e;
      }
    }
  } finally {
    await conn.end();
  }
  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
}

async function ensureSchema() {
  const sql = `
    CREATE TABLE IF NOT EXISTS inscricoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      sexo VARCHAR(50) NOT NULL,
      nascimento DATE NOT NULL,
      whatsapp VARCHAR(50) NOT NULL,
      emergencia VARCHAR(255) NOT NULL,
      endereco VARCHAR(255) NOT NULL,
      frase TEXT NOT NULL,
      responsavel_nome VARCHAR(255) NULL,
      cpf VARCHAR(14) NOT NULL,
      doc_blob LONGBLOB NOT NULL,
      doc_mime VARCHAR(100) NOT NULL,
      foto_blob LONGBLOB NOT NULL,
      foto_mime VARCHAR(100) NOT NULL,
      foto_santo_blob LONGBLOB NOT NULL,
      foto_santo_mime VARCHAR(100) NOT NULL,
      termo_blob LONGBLOB NULL,
      termo_mime VARCHAR(100) NULL,
      justificativa_blob LONGBLOB NULL,
      justificativa_mime VARCHAR(100) NULL,
      justificativa_texto TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      mp_payment_id VARCHAR(64),
      mp_qr_code TEXT,
      mp_qr_base64 MEDIUMTEXT,
      mp_ticket_url TEXT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const conn = await pool.getConnection();
  try {
    await conn.query(sql);

    const ensureCol = async (col, alterSql) => {
      const [rows] = await conn.query('SHOW COLUMNS FROM inscricoes LIKE ?', [col]);
      if (!rows || rows.length === 0) {
        await conn.query(alterSql);
      }
    };

    const [idx] = await conn.query("SHOW INDEX FROM inscricoes WHERE Key_name='uniq_cpf'");
    if (!idx || idx.length === 0) {
      await conn.query('ALTER TABLE inscricoes ADD UNIQUE KEY uniq_cpf (cpf)');
    }

    await ensureCol('responsavel_nome', 'ALTER TABLE inscricoes ADD COLUMN responsavel_nome VARCHAR(255) NULL AFTER frase');
    await ensureCol('termo_blob', 'ALTER TABLE inscricoes ADD COLUMN termo_blob LONGBLOB NULL');
    await ensureCol('termo_mime', 'ALTER TABLE inscricoes ADD COLUMN termo_mime VARCHAR(100) NULL');
    await ensureCol('justificativa_blob', 'ALTER TABLE inscricoes ADD COLUMN justificativa_blob LONGBLOB NULL');
    await ensureCol('justificativa_mime', 'ALTER TABLE inscricoes ADD COLUMN justificativa_mime VARCHAR(100) NULL');
    await ensureCol('justificativa_texto', 'ALTER TABLE inscricoes ADD COLUMN justificativa_texto TEXT NULL');
    await ensureCol('mp_payment_id', 'ALTER TABLE inscricoes ADD COLUMN mp_payment_id VARCHAR(64)');
    await ensureCol('mp_qr_code', 'ALTER TABLE inscricoes ADD COLUMN mp_qr_code TEXT');
    await ensureCol('mp_qr_base64', 'ALTER TABLE inscricoes ADD COLUMN mp_qr_base64 MEDIUMTEXT');
    await ensureCol('mp_ticket_url', 'ALTER TABLE inscricoes ADD COLUMN mp_ticket_url TEXT');
    await ensureCol('mp_status', 'ALTER TABLE inscricoes ADD COLUMN mp_status VARCHAR(50)');
    await ensureCol('paid_at', 'ALTER TABLE inscricoes ADD COLUMN paid_at TIMESTAMP NULL');

    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      cpf VARCHAR(14) NOT NULL,
      cidade VARCHAR(100) NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_email (email),
      UNIQUE KEY uniq_cpf_users (cpf)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [hashCol] = await conn.query('SHOW COLUMNS FROM users LIKE "senha_hash"');
    if (!hashCol || hashCol.length === 0) {
      await conn.query('ALTER TABLE users ADD COLUMN senha_hash VARCHAR(255) NULL AFTER email');
    }
    const [cityCol] = await conn.query('SHOW COLUMNS FROM users LIKE "cidade"');
    if (!cityCol || cityCol.length === 0) {
      await conn.query("ALTER TABLE users ADD COLUMN cidade VARCHAR(100) NOT NULL DEFAULT '' AFTER cpf");
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS cart_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      size VARCHAR(10) NOT NULL,
      qty INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      image VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.execute(
      'UPDATE cart_items c JOIN (SELECT user_id, product_id, size, MIN(id) AS keep_id, SUM(qty) AS sum_qty, COUNT(*) cnt FROM cart_items GROUP BY user_id, product_id, size HAVING cnt > 1) d ON c.id = d.keep_id SET c.qty = d.sum_qty'
    );
    await conn.execute(
      'DELETE c FROM cart_items c JOIN (SELECT user_id, product_id, size, MIN(id) AS keep_id, COUNT(*) cnt FROM cart_items GROUP BY user_id, product_id, size HAVING cnt > 1) d ON c.user_id = d.user_id AND c.product_id = d.product_id AND c.size = d.size WHERE c.id <> d.keep_id'
    );
    const [cartIdx] = await conn.query('SHOW INDEX FROM cart_items WHERE Key_name = "uniq_cart_user_prod_size"');
    if (!cartIdx || cartIdx.length === 0) {
      await conn.query('ALTER TABLE cart_items ADD UNIQUE KEY uniq_cart_user_prod_size (user_id, product_id, size)');
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      mp_payment_id VARCHAR(64),
      mp_qr_code TEXT,
      mp_qr_base64 MEDIUMTEXT,
      mp_ticket_url TEXT,
      mp_status VARCHAR(50),
      paid_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [ordIdx] = await conn.query('SHOW INDEX FROM orders WHERE Key_name = "uniq_orders_payment_id"');
    if (!ordIdx || ordIdx.length === 0) {
      await conn.query('ALTER TABLE orders ADD UNIQUE KEY uniq_orders_payment_id (mp_payment_id)');
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      size VARCHAR(10) NOT NULL,
      qty INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      image VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query(`CREATE TABLE IF NOT EXISTS donations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      contato VARCHAR(50) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      mp_payment_id VARCHAR(64),
      mp_qr_code TEXT,
      mp_qr_base64 MEDIUMTEXT,
      mp_ticket_url TEXT,
      mp_status VARCHAR(50),
      paid_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await conn.query(`CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_admin_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const [adm] = await conn.execute('SELECT id FROM admins WHERE email = ? LIMIT 1', ['marcio@gmail.com']);
    if (!adm || adm.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await conn.execute('INSERT INTO admins (nome, email, senha_hash) VALUES (?,?,?)', ['Administrador', 'marcio@gmail.com', hash]);
    }
  } finally { conn.release(); }
}

ensureDatabase().then(ensureSchema).catch(console.error);

exports.saveInscricao = async (data) => {
  const sql = `INSERT INTO inscricoes (
    nome, sexo, nascimento, whatsapp, emergencia, endereco, frase, responsavel_nome, cpf,
    doc_blob, doc_mime, foto_blob, foto_mime, foto_santo_blob, foto_santo_mime,
    termo_blob, termo_mime, justificativa_blob, justificativa_mime, justificativa_texto,
    mp_payment_id, mp_qr_code, mp_qr_base64, mp_ticket_url, mp_status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const params = [
    data.nome,
    data.sexo,
    data.nascimento,
    data.whatsapp,
    data.emergencia,
    data.endereco,
    data.frase,
    data.responsavel_nome || null,
    data.cpf,
    data.doc_blob, data.doc_mime,
    data.foto_blob, data.foto_mime,
    data.foto_santo_blob, data.foto_santo_mime,
    data.termo_blob || null, data.termo_mime || null,
    data.justificativa_blob || null, data.justificativa_mime || null,
    data.justificativa_texto || null,
    data.mp_payment_id || null,
    data.mp_qr_code || null,
    data.mp_qr_base64 || null,
    data.mp_ticket_url || null,
    data.mp_status || null,
  ];

  const conn = await pool.getConnection();
  try {
    const [result] = await conn.execute(sql, params);
    return result.insertId;
  } finally {
    conn.release();
  }
};

exports.getInscricao = async (id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM inscricoes WHERE id = ?', [id]);
    return rows[0] || null;
  } finally {
    conn.release();
  }
};

exports.getByCpf = async (cpf) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM inscricoes WHERE cpf = ?', [cpf]);
    return rows[0] || null;
  } finally {
    conn.release();
  }
};

exports.updatePaymentStatus = async (id, status) => {
  const conn = await pool.getConnection();
  try {
    const paidAt = status === 'approved' ? new Date() : null;
    await conn.execute('UPDATE inscricoes SET mp_status = ?, paid_at = ? WHERE id = ?', [status, paidAt, id]);
  } finally {
    conn.release();
  }
};

exports.updatePaymentData = async (id, data) => {
  const conn = await pool.getConnection();
  try {
    const sql = 'UPDATE inscricoes SET mp_payment_id = ?, mp_qr_code = ?, mp_qr_base64 = ?, mp_ticket_url = ?, mp_status = ?, paid_at = NULL WHERE id = ?';
    await conn.execute(sql, [
      data.mp_payment_id,
      data.mp_qr_code,
      data.mp_qr_base64,
      data.mp_ticket_url,
      data.mp_status || 'pending',
      id
    ]);
  } finally {
    conn.release();
  }
};

exports.createUser = async ({ nome, email, senha_hash, cpf, cidade }) => {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.execute('INSERT INTO users (nome, email, senha_hash, cpf, cidade) VALUES (?,?,?,?,?)', [nome, email, senha_hash, cpf, cidade]);
    return r.insertId;
  } finally { conn.release(); }
};

exports.getUserByEmail = async (email) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.getUserById = async (id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.getUserByCpf = async (cpf) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM users WHERE cpf = ?', [cpf]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.updateUserPasswordByEmailCpf = async ({ email, cpf, senha_hash }) => {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.execute('UPDATE users SET senha_hash = ? WHERE email = ? AND cpf = ?', [senha_hash, email, cpf]);
    return r.affectedRows || 0;
  } finally { conn.release(); }
};

exports.addCartItem = async ({ user_id, product_id, name, size, qty, price }) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute(
      'INSERT INTO cart_items (user_id, product_id, name, size, qty, price) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty), name = VALUES(name), price = VALUES(price)',
      [user_id, product_id, name, size, qty, price]
    );
  } finally { conn.release(); }
};

exports.getCartItemsForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM cart_items WHERE user_id = ? ORDER BY id DESC', [user_id]);
    return rows;
  } finally { conn.release(); }
};

exports.clearCartForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try { await conn.execute('DELETE FROM cart_items WHERE user_id = ?', [user_id]); }
  finally { conn.release(); }
};

exports.updateCartItem = async ({ user_id, id, size, qty }) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute('UPDATE cart_items SET size = ?, qty = ? WHERE id = ? AND user_id = ?', [size, qty, id, user_id]);
  } finally { conn.release(); }
};

exports.deleteCartItem = async ({ user_id, id }) => {
  const conn = await pool.getConnection();
  try {
    await conn.execute('DELETE FROM cart_items WHERE id = ? AND user_id = ?', [id, user_id]);
  } finally { conn.release(); }
};

exports.createOrderWithItems = async ({ user_id, items, payment, total }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO orders (user_id, total, mp_payment_id, mp_qr_code, mp_qr_base64, mp_ticket_url, mp_status) VALUES (?,?,?,?,?,?,?)',
      [user_id, total, payment.payment_id || null, payment.qr_code || null, payment.qr_base64 || null, payment.ticket_url || null, 'pending']
    );
    const orderId = r.insertId;
    for (const it of items) {
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, name, size, qty, price) VALUES (?,?,?,?,?,?)',
        [orderId, it.product_id, it.name, it.size, it.qty, it.price]
      );
    }
    await conn.commit();
    return orderId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
};

exports.getOrder = async (id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM orders WHERE id = ?', [id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.updateOrderPaymentStatus = async (id, status) => {
  const conn = await pool.getConnection();
  try {
    const paidAt = status === 'approved' ? new Date() : null;
    await conn.execute('UPDATE orders SET mp_status = ?, paid_at = ? WHERE id = ?', [status, paidAt, id]);
  } finally { conn.release(); }
};

exports.updateOrderPaymentData = async (id, data) => {
  const conn = await pool.getConnection();
  try {
    const sql = 'UPDATE orders SET mp_payment_id = ?, mp_qr_code = ?, mp_qr_base64 = ?, mp_ticket_url = ?, mp_status = ?, paid_at = NULL WHERE id = ?';
    await conn.execute(sql, [
      data.mp_payment_id,
      data.mp_qr_code,
      data.mp_qr_base64,
      data.mp_ticket_url,
      data.mp_status || 'pending',
      id
    ]);
  } finally { conn.release(); }
};

exports.updateOrderWithItemsAndPayment = async ({ id, items, total, payment }) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
    for (const it of items) {
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, name, size, qty, price) VALUES (?,?,?,?,?,?)',
        [id, it.product_id, it.name, it.size, it.qty, it.price]
      );
    }
    await conn.execute(
      'UPDATE orders SET total = ?, mp_payment_id = ?, mp_qr_code = ?, mp_qr_base64 = ?, mp_ticket_url = ?, mp_status = ?, paid_at = NULL WHERE id = ?',
      [total, payment.payment_id || null, payment.qr_code || null, payment.qr_base64 || null, payment.ticket_url || null, 'pending', id]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
};

exports.getInscricaoByPaymentId = async (mp_payment_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM inscricoes WHERE mp_payment_id = ? LIMIT 1', [mp_payment_id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.getOrderByPaymentId = async (mp_payment_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM orders WHERE mp_payment_id = ? LIMIT 1', [mp_payment_id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.getPaidOrdersForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, total, mp_status, paid_at, created_at FROM orders WHERE user_id = ? AND mp_status = ? ORDER BY paid_at DESC', [user_id, 'approved']);
    return rows;
  } finally { conn.release(); }
};

exports.getOrderItems = async (order_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT product_id, name, size, qty, price FROM order_items WHERE order_id = ? ORDER BY id ASC', [order_id]);
    return rows;
  } finally { conn.release(); }
};

exports.getOrdersForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, total, mp_status, mp_payment_id, paid_at, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC', [user_id]);
    return rows;
  } finally { conn.release(); }
};

exports.getPendingOrderForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM orders WHERE user_id = ? AND (mp_status IS NULL OR mp_status IN ("pending","in_process")) ORDER BY id DESC LIMIT 1', [user_id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.cancelPendingOrderForUser = async (user_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id FROM orders WHERE user_id = ? AND (mp_status IS NULL OR mp_status IN ("pending","in_process")) ORDER BY id DESC LIMIT 1', [user_id]);
    const row = rows[0];
    if (!row) return false;
    await conn.execute('UPDATE orders SET mp_status = ?, paid_at = NULL WHERE id = ?', ['canceled', row.id]);
    return true;
  } finally { conn.release(); }
};

exports.ping = async () => {
  if (!pool) throw new Error('Pool não inicializado');
  const conn = await pool.getConnection();
  try { await conn.query('SELECT 1'); return true; }
  finally { conn.release(); }
};

exports.createDonation = async ({ nome, contato, amount, payment }) => {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.execute(
      'INSERT INTO donations (nome, contato, amount, mp_payment_id, mp_qr_code, mp_qr_base64, mp_ticket_url, mp_status) VALUES (?,?,?,?,?,?,?,?)',
      [nome, contato, amount, payment.payment_id || null, payment.qr_code || null, payment.qr_base64 || null, payment.ticket_url || null, 'pending']
    );
    return r.insertId;
  } finally { conn.release(); }
};

exports.getDonation = async (id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM donations WHERE id = ?', [id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.updateDonationPaymentStatus = async (id, status) => {
  const conn = await pool.getConnection();
  try {
    const paidAt = status === 'approved' ? new Date() : null;
    await conn.execute('UPDATE donations SET mp_status = ?, paid_at = ? WHERE id = ?', [status, paidAt, id]);
  } finally { conn.release(); }
};

exports.updateDonationPaymentData = async (id, data) => {
  const conn = await pool.getConnection();
  try {
    const sql = 'UPDATE donations SET mp_payment_id = ?, mp_qr_code = ?, mp_qr_base64 = ?, mp_ticket_url = ?, mp_status = ?, paid_at = NULL WHERE id = ?';
    await conn.execute(sql, [
      data.mp_payment_id,
      data.mp_qr_code,
      data.mp_qr_base64,
      data.mp_ticket_url,
      data.mp_status || 'pending',
      id
    ]);
  } finally { conn.release(); }
};

exports.getDonationByPaymentId = async (mp_payment_id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM donations WHERE mp_payment_id = ? LIMIT 1', [mp_payment_id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.createAdmin = async ({ nome, email, senha_hash }) => {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.execute('INSERT INTO admins (nome, email, senha_hash) VALUES (?,?,?)', [nome, email, senha_hash]);
    return r.insertId;
  } finally { conn.release(); }
};

exports.getAdminByEmail = async (email) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM admins WHERE email = ? LIMIT 1', [email]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.getAdminById = async (id) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT * FROM admins WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  } finally { conn.release(); }
};

exports.listInscricoes = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, nome, cpf, mp_status, paid_at, created_at FROM inscricoes ORDER BY created_at DESC');
    return rows;
  } finally { conn.release(); }
};

exports.listPaidInscricoes = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, nome, cpf, sexo, nascimento, whatsapp, endereco, mp_status, paid_at, created_at FROM inscricoes WHERE mp_status = ? ORDER BY nome ASC', ['approved']);
    return rows;
  } finally { conn.release(); }
};

exports.listOrders = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, user_id, total, mp_status, paid_at, created_at FROM orders ORDER BY created_at DESC');
    return rows;
  } finally { conn.release(); }
};

exports.listDonations = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, nome, contato, amount, mp_status, paid_at, created_at FROM donations ORDER BY created_at DESC');
    return rows;
  } finally { conn.release(); }
};

exports.listPaidDonations = async () => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute('SELECT id, nome, contato, amount, mp_status, paid_at, created_at FROM donations WHERE mp_status = ? ORDER BY paid_at DESC', ['approved']);
    return rows;
  } finally { conn.release(); }
};

exports.listPaidOrdersDetailed = async () => {
  const conn = await pool.getConnection();
  try {
    const [orders] = await conn.execute(
      'SELECT o.id, o.user_id, o.total, o.paid_at, u.nome, u.cidade, u.cpf FROM orders o JOIN users u ON o.user_id = u.id WHERE o.mp_status = ? ORDER BY o.paid_at DESC',
      ['approved']
    );
    const ids = orders.map(o => o.id);
    let itemsMap = {};
    if (ids.length) {
      const placeholders = ids.map(() => '?').join(',');
      const [items] = await conn.execute(
        `SELECT order_id, product_id, name, size, qty, price FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id ASC`,
        ids
      );
      for (const it of items) {
        if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
        itemsMap[it.order_id].push({ product_id: it.product_id, name: it.name, size: it.size, qty: it.qty, price: it.price });
      }
    }
    return orders.map(o => ({
      id: o.id,
      total: o.total,
      paid_at: o.paid_at,
      buyer: { nome: o.nome, cidade: o.cidade, cpf: o.cpf },
      items: itemsMap[o.id] || []
    }));
  } finally { conn.release(); }
};

exports.deleteUnpaidOrders = async () => {
  const conn = await pool.getConnection();
  try {
    const [r] = await conn.execute('DELETE FROM orders WHERE mp_status IS NULL OR mp_status NOT IN ("approved")');
    return r.affectedRows || 0;
  } finally { conn.release(); }
};
