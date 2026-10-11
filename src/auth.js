// JWT + bcrypt — mesmas escolhas validadas na api_mongodb_query_money (13 testes lá).
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const SEGREDO = process.env.JWT_SECRET ?? (
  process.env.NODE_ENV === 'test' ? 'kanbanex-test-only-secret-at-least-32-bytes' : undefined
);
if (!SEGREDO || Buffer.byteLength(SEGREDO, 'utf8') < 32) {
  throw new Error('JWT_SECRET ausente ou curto — defina um segredo com pelo menos 32 bytes.');
}

export function registrar(req, res) {
  const { nome, email, senha } = req.body || {};
  const emailCanonico = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (typeof nome !== 'string' || !nome.trim() || nome.trim().length > 120 ||
      !/^[^\s@]+@[^\s@]+$/.test(emailCanonico) || emailCanonico.length > 254 ||
      typeof senha !== 'string' || senha.length < 6 || senha.length > 128) {
    return res.status(400).json({ erro: { codigo: 'dados_invalidos', mensagem: 'nome, e-mail válido e senha (6–128 caracteres) obrigatórios' } });
  }
  if (db.prepare('SELECT id FROM usuarios WHERE lower(email) = ?').get(emailCanonico)) {
    return res.status(409).json({ erro: { codigo: 'email_repetido', mensagem: 'E-mail já cadastrado' } });
  }
  const id = randomUUID();
  try {
    db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash) VALUES (?, ?, ?, ?)')
      .run(id, nome.trim(), emailCanonico, bcrypt.hashSync(senha, 10));
  } catch (e) {
    if (String(e.message).includes('UNIQUE constraint failed: usuarios.email') || String(e.message).includes('ux_usuarios_email_canonico')) {
      return res.status(409).json({ erro: { codigo: 'email_repetido', mensagem: 'E-mail já cadastrado' } });
    }
    throw e;
  }
  res.status(201).json({ id, nome: nome.trim(), email: emailCanonico });
}

export function login(req, res) {
  const { email, senha } = req.body || {};
  const emailCanonico = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(emailCanonico);
  if (!usuario || typeof senha !== 'string' || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: { codigo: 'credenciais', mensagem: 'Credenciais inválidas' } });
  }
  const token = jwt.sign({ sub: usuario.id, nome: usuario.nome }, SEGREDO, { expiresIn: '24h' });
  res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
}

export function verificarToken(token) {
  try {
    const payload = jwt.verify(token, SEGREDO, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' && payload.sub ? payload : null;
  } catch { return null; }
}

export function exigirToken(req, res, next) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) {
    return res.status(401).json({ erro: { codigo: 'sem_token', mensagem: 'Token ausente' } });
  }
  const payload = verificarToken(cabecalho.slice(7));
  if (!payload) {
    return res.status(401).json({ erro: { codigo: 'token_invalido', mensagem: 'Token inválido/expirado' } });
  }
  req.usuario = payload;
  next();
}
