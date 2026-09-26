// Kanbanex M1 — servidor: REST (auth/boards/cards) + relay WebSocket de tempo real.
// Reuso real: padrão do relay do chat_criptografado (ws sobre HTTP único) + SQLite zero-dep.
import express from 'express';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db } from './src/db.js';
import { registrar, login, exigirToken } from './src/auth.js';
import { criarQuadro, listarQuadros, obterQuadro, criarCartao, testarVitoriaNome } from './src/api.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 3210;
const app = express();
app.use(express.json());

// ---------- auth ----------
app.post('/api/register', registrar);
app.post('/api/login', login);

// ---------- REST: quadros e cartões ----------
app.get('/api/boards', exigirToken, listarQuadros);
app.post('/api/boards', exigirToken, criarQuadro);
app.get('/api/boards/:id', exigirToken, obterQuadro);
app.post('/api/boards/:id/cards', exigirToken, criarCartao);

// ---------- estático ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  try {
    let arquivo = normalize(join(ROOT, 'public', req.path));
    if (!arquivo.startsWith(ROOT)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  } catch {
    const indice = await readFile(join(ROOT, 'public/index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indice);
  }
});

// ---------- servidor + relay ws (padrão validado no chat_criptografado) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const salas = new Map(); // boardId -> Set<socket>

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'join') {
      socket.boardId = msg.boardId;
      if (!salas.has(msg.boardId)) salas.set(msg.boardId, new Set());
      salas.get(msg.boardId).add(socket);
      socket.send(JSON.stringify({ type: 'joined', boardId: msg.boardId, online: salas.get(msg.boardId).size }));
      broadcast(msg.boardId, { type: 'presence', online: salas.get(msg.boardId).size }, socket);
      return;
    }
    // eventos de domínio: card-move, card-create — valida + persiste + repassa
    if (msg.type === 'card-move') {
      const ok = moverCartao(socket.boardId, msg);
      if (!ok) return socket.send(JSON.stringify({ type: 'error', message: 'movimento inválido' }));
      broadcast(socket.boardId, { type: 'card-move', boardId: socket.boardId, cardId: msg.cardId, coluna: msg.coluna, posicao: msg.posicao, por: msg.por });
    }
    if (msg.type === 'card-create') {
      const cartao = inserirCartao(socket.boardId, msg);
      if (cartao) broadcast(socket.boardId, { type: 'card-create', boardId: socket.boardId, cartao });
    }
  });
  socket.on('close', () => {
    const sala = salas.get(socket.boardId);
    if (sala) {
      sala.delete(socket);
      broadcast(socket.boardId, { type: 'presence', online: sala.size });
    }
  });
});

function broadcast(boardId, evento, exceto = null) {
  const sala = salas.get(boardId);
  if (!sala) return;
  for (const par of sala) {
    if (par !== exceto && par.readyState === 1) par.send(JSON.stringify(evento));
  }
}

// persistência do movimento (transação simples: ordena posições na coluna destino)
function moverCartao(boardId, { cardId, coluna, posicao }) {
  if (!boardId || !cardId) return false;
  const existe = db.prepare('SELECT id FROM cartoes WHERE id = ? AND quadro_id = ?').get(cardId, boardId);
  if (!existe) return false;
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE cartoes SET posicao = posicao + 1 WHERE quadro_id = ? AND coluna = ? AND posicao >= ?').run(boardId, coluna, posicao);
    db.prepare('UPDATE cartoes SET coluna = ?, posicao = ? WHERE id = ?').run(coluna, posicao, cardId);
    db.exec('COMMIT');
    return true;
  } catch {
    db.exec('ROLLBACK');
    return false;
  }
}

function inserirCartao(boardId, { titulo, coluna }) {
  if (!titulo || typeof titulo !== 'string' || titulo.length > 120) return null;
  if (!['fazer', 'fazendo', 'pronto'].includes(coluna)) return null;
  const max = db.prepare('SELECT COALESCE(MAX(posicao), -1) AS m FROM cartoes WHERE quadro_id = ? AND coluna = ?').get(boardId, coluna).m;
  const id = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO cartoes (id, quadro_id, titulo, coluna, posicao) VALUES (?, ?, ?, ?, ?)').run(id, boardId, titulo, coluna, max + 1);
  return { id, quadro_id: boardId, titulo, coluna, posicao: max + 1 };
}

export { server, app, wss }; // testes importam daqui

if (!process.env.KANBANEX_NO_LISTEN) {
  server.listen(PORT, () => console.log(`Kanbanex em http://localhost:${PORT} (REST + ws no mesmo servidor)`));
}
