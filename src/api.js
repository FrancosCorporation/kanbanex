// REST de quadros/cartões — regras de negócio do M1.
import { randomUUID } from 'node:crypto';
import { db } from './db.js';

export function listarQuadros(req, res) {
  const quadros = db.prepare('SELECT id, nome FROM quadros WHERE dono_id = ?').all(req.usuario.sub);
  res.json(quadros);
}

export function criarQuadro(req, res) {
  const { nome } = req.body;
  if (!nome || nome.length > 60) {
    return res.status(400).json({ erro: { codigo: 'nome', mensagem: 'nome obrigatório (<=60)' } });
  }
  const id = randomUUID().slice(0, 12);
  db.prepare('INSERT INTO quadros (id, dono_id, nome) VALUES (?, ?, ?)').run(id, req.usuario.sub, nome);
  res.status(201).json({ id, nome });
}

export function obterQuadro(req, res) {
  const quadro = db.prepare('SELECT * FROM quadros WHERE id = ?').get(req.params.id);
  if (!quadro) return res.status(404).json({ erro: { codigo: '404', mensagem: 'Quadro não encontrado' } });
  const cartoes = db.prepare('SELECT id, titulo, coluna, posicao FROM cartoes WHERE quadro_id = ? ORDER BY posicao').all(req.params.id);
  res.json({ id: quadro.id, nome: quadro.nome, cartoes });
}

export function criarCartao(req, res) {
  const { titulo, coluna } = req.body;
  const quadro = db.prepare('SELECT id FROM quadros WHERE id = ?').get(req.params.id);
  if (!quadro) return res.status(404).json({ erro: { codigo: '404', mensagem: 'Quadro não encontrado' } });
  if (!titulo || titulo.length > 120 || !['fazer', 'fazendo', 'pronto'].includes(coluna)) {
    return res.status(400).json({ erro: { codigo: 'cartao', mensagem: 'titulo (<=120) e coluna (fazer/fazendo/pronto) obrigatórios' } });
  }
  const max = db.prepare('SELECT COALESCE(MAX(posicao), -1) AS m FROM cartoes WHERE quadro_id = ? AND coluna = ?').get(req.params.id, coluna).m;
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO cartoes (id, quadro_id, titulo, coluna, posicao) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, titulo, coluna, max + 1);
  res.status(201).json({ id, titulo, coluna, posicao: max + 1 });
}

// helper de teste
export function testarVitoriaNome() { return 'kanbanex'; }
