// JWT + bcrypt — mesmas escolhas validadas na api_mongodb_query_money (13 testes lá).
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

const SEGREDO = process.env.JWT_SECRET || 'kanbanex-dev-secret-troque-em-producao';

export function registrar(req, res) {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha || senha.length < 6) {
    return res.status(400).json({ erro: { codigo: 'dados_invalidos', mensagem: 'nome, email e senha (>=6) obrigatórios' } });
  }
  if (db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ erro: { codigo: 'email_repetido', mensagem: 'E-mail já cadastrado' } });
  }
  const id = randomUUID();
  db.prepare('INSERT INTO usuarios (id, nome, email, senha_hash) VALUES (?, ?, ?, ?)')
    .run(id, nome, email, bcrypt.hashSync(senha, 10));
  res.status(201).json({ id, nome, email });
}

export function login(req, res) {
  const { email, senha } = req.body;
  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario || !bcrypt.compareSync(senha, usuario.senha_hash)) {
    return res.status(401).json({ erro: { codigo: 'credenciais', mensagem: 'Credenciais inválidas' } });
  }
  const token = jwt.sign({ sub: usuario.id, nome: usuario.nome }, SEGREDO, { expiresIn: '24h' });
  res.json({ token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email } });
}

export function exigirToken(req, res, next) {
  const cabecalho = req.headers.authorization;
  if (!cabecalho?.startsWith('Bearer ')) {
    return res.status(401).json({ erro: { codigo: 'sem_token', mensagem: 'Token ausente' } });
  }
  try {
    req.usuario = jwt.verify(cabecalho.slice(7), SEGREDO);
    next();
  } catch {
    return res.status(401).json({ erro: { codigo: 'token_invalido', mensagem: 'Token inválido/expirado' } });
  }
}
