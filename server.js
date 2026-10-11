// Kanbanex M1 — REST protegido + relay WebSocket autenticado e limitado.
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db } from './src/db.js';
import { exigirToken, registrar, login, verificarToken } from './src/auth.js';
import { criarQuadro, listarQuadros, obterQuadro, criarCartao } from './src/api.js';
import { m3 } from './src/m3-runtime.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3210);
const LIMITE_CONEXOES = 100;
const LIMITE_IP = 10;
const TEMPO_AUTENTICACAO_MS = 10_000;
const TEMPO_INATIVIDADE_MS = 5 * 60 * 1000;
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(express.json({ limit: '32kb' }));

function criarLimitador(limite, janelaMs, maxChaves = 20_000) {
  const janelas = new Map();
  let operacoes = 0;
  return (chave) => {
    const agora = Date.now();
    let janela = janelas.get(chave);
    if (!janela || janela.ate <= agora) {
      janela = { usos: 0, ate: agora + janelaMs };
      janelas.set(chave, janela);
    }
    const permitido = janela.usos < limite;
    if (permitido) janela.usos += 1;
    if (++operacoes % 256 === 0 || janelas.size > maxChaves) {
      for (const [k, v] of janelas) if (v.ate <= agora) janelas.delete(k);
      while (janelas.size > maxChaves) janelas.delete(janelas.keys().next().value);
    }
    return { permitido, aguardeMs: Math.max(1, janela.ate - agora) };
  };
}

const limiteAuthIp = criarLimitador(20, 5 * 60 * 1000);
const limiteAuthEmail = criarLimitador(5, 5 * 60 * 1000);

function limiteAutenticacao(req, res, next) {
  // Express confia apenas no socket por padrão; X-Forwarded-For não é aceito sem topologia configurada.
  const ip = req.ip || req.socket.remoteAddress || 'desconhecido';
  const emailBruto = req.body?.email;
  const email = typeof emailBruto === 'string' && emailBruto.length <= 254 ? emailBruto.trim().toLowerCase() : '';
  const resultados = [limiteAuthIp(ip)];
  if (email) resultados.push(limiteAuthEmail(email));
  const bloqueados = resultados.filter((r) => !r.permitido);
  if (!bloqueados.length) return next();
  const aguarde = Math.max(1, Math.ceil(Math.max(...bloqueados.map((r) => r.aguardeMs)) / 1000));
  res.setHeader('Retry-After', String(aguarde));
  return res.status(429).json({ erro: { codigo: 'limite', mensagem: 'Muitas tentativas. Aguarde antes de tentar novamente.' } });
}

// ---------- REST ----------
app.post('/api/register', limiteAutenticacao, registrar);
app.post('/api/login', limiteAutenticacao, login);
app.get('/api/boards', exigirToken, listarQuadros);
app.post('/api/boards', exigirToken, criarQuadro);
app.get('/api/boards/:id', exigirToken, obterQuadro);
app.post('/api/boards/:id/cards', exigirToken, criarCartao);
app.get('/api/boards/:id/historico', exigirToken, (req, res) => {
  const quadro = db.prepare('SELECT id FROM quadros WHERE id = ? AND dono_id = ?').get(req.params.id, req.usuario.sub);
  if (!quadro) return res.status(404).json({ erro: { codigo: '404', mensagem: 'Quadro não encontrado' } });
  const solicitado = Number.parseInt(req.query.limite, 10);
  const limite = Number.isFinite(solicitado) ? Math.max(1, Math.min(100, solicitado)) : 50;
  res.json(m3.historico(req.params.id, limite));
});

// ---------- estático ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
app.use(async (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  try {
    const pastaPublica = resolve(ROOT, 'public');
    const arquivo = resolve(pastaPublica, `.${req.path}`);
    if (arquivo !== pastaPublica && !arquivo.startsWith(`${pastaPublica}${sep}`)) throw new Error('fora');
    const dados = await readFile(arquivo);
    res.writeHead(200, { 'Content-Type': MIME[extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  } catch {
    try {
      const indice = await readFile(join(ROOT, 'public/index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indice);
    } catch { res.writeHead(500); res.end('erro'); }
  }
});
app.use('/api', (req, res) => res.status(404).json({ erro: { codigo: '404', mensagem: 'Rota não encontrada' } }));
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  const status = Number.isInteger(e.status) && e.status >= 400 && e.status < 500 ? e.status : 500;
  if (status === 500) console.error('[Kanbanex] Erro HTTP interno:', e);
  const mensagem = status === 413 ? 'Corpo da requisição excede 32 KiB' : status === 400 ? 'JSON inválido' : 'Erro interno do servidor';
  res.status(status).json({ erro: { codigo: status === 500 ? 'interno' : 'requisicao_invalida', mensagem } });
});

// ---------- relay WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
const salas = new Map(); // boardId -> Set<socket>
const conexoesAtivas = new Set();
const conexoesPorIp = new Map();

function recusarUpgrade(socket, status, motivo) {
  const resposta = `HTTP/1.1 ${status} ${motivo}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  socket.end(resposta);
}

server.on('upgrade', (req, socket, head) => {
  const ip = req.socket.remoteAddress || 'desconhecido';
  const atualIp = conexoesPorIp.get(ip) || 0;
  let origemValida = true;
  if (req.headers.origin) {
    try { origemValida = new URL(req.headers.origin).host === req.headers.host; }
    catch { origemValida = false; }
  }
  let caminho;
  try { caminho = new URL(req.url || '/', 'http://localhost').pathname; }
  catch { return recusarUpgrade(socket, 400, 'Bad Request'); }
  if (!origemValida) return recusarUpgrade(socket, 403, 'Forbidden');
  if (caminho !== '/' && caminho !== '/ws') return recusarUpgrade(socket, 404, 'Not Found');
  if (conexoesAtivas.size >= LIMITE_CONEXOES || atualIp >= LIMITE_IP) {
    return recusarUpgrade(socket, 429, 'Too Many Connections');
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.ip = ip;
    conexoesAtivas.add(ws);
    conexoesPorIp.set(ip, (conexoesPorIp.get(ip) || 0) + 1);
    wss.emit('connection', ws, req);
  });
});

function enviar(socket, evento) {
  if (socket.readyState === 1) socket.send(JSON.stringify(evento));
}

function broadcast(boardId, evento, exceto = null) {
  const sala = salas.get(boardId);
  if (!sala) return;
  for (const par of sala) if (par !== exceto) enviar(par, evento);
}

function sairDaSala(socket) {
  const boardId = socket.boardId;
  if (!boardId) return;
  const sala = salas.get(boardId);
  socket.boardId = null;
  if (!sala) return;
  sala.delete(socket);
  if (sala.size === 0) salas.delete(boardId);
  else broadcast(boardId, { type: 'presence', online: sala.size });
}

function renovarInatividade(socket) {
  clearTimeout(socket.inatividadeTimer);
  socket.inatividadeTimer = setTimeout(() => socket.close(1001, 'idle timeout'), TEMPO_INATIVIDADE_MS);
  socket.inatividadeTimer.unref?.();
}

function erroSocket(socket, mensagem) {
  enviar(socket, { type: 'error', message: mensagem });
}

wss.on('connection', (socket) => {
  socket.on('error', (e) => console.warn('[Kanbanex] WebSocket desconectado:', e.message));
  const timeoutAuth = setTimeout(() => socket.close(1008, 'authentication required'), TEMPO_AUTENTICACAO_MS);
  timeoutAuth.unref?.();
  renovarInatividade(socket);

  socket.on('message', (raw, isBinary) => {
    renovarInatividade(socket);
    if (isBinary) return socket.close(1003, 'JSON text frames required');
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return socket.close(1003, 'invalid JSON'); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return socket.close(1003, 'invalid message');

    if (!socket.userId) {
      if (msg.type !== 'join' || typeof msg.boardId !== 'string' || !msg.boardId || msg.boardId.length > 64 || typeof msg.token !== 'string') {
        return socket.close(1008, 'authenticated join required');
      }
      const usuario = verificarToken(msg.token);
      if (!usuario) {
        erroSocket(socket, 'autenticação necessária');
        return socket.close(1008, 'invalid token');
      }
      const quadro = db.prepare('SELECT id FROM quadros WHERE id = ? AND dono_id = ?').get(msg.boardId, usuario.sub);
      if (!quadro) {
        erroSocket(socket, 'quadro não encontrado');
        return socket.close(1008, 'board access denied');
      }
      clearTimeout(timeoutAuth);
      socket.userId = usuario.sub;
      socket.userName = typeof usuario.nome === 'string' ? usuario.nome.slice(0, 120) : 'Usuário';
      socket.boardId = msg.boardId;
      if (!salas.has(socket.boardId)) salas.set(socket.boardId, new Set());
      const sala = salas.get(socket.boardId);
      sala.add(socket);
      enviar(socket, { type: 'joined', boardId: socket.boardId, online: sala.size });
      broadcast(socket.boardId, { type: 'presence', online: sala.size }, socket);
      return;
    }

    if (msg.type === 'join') return erroSocket(socket, 'esta conexão já está vinculada a um quadro');
    const boardId = socket.boardId;
    if (!boardId || !socket.userId) return erroSocket(socket, 'entre em um quadro antes de enviar ações');

    if (msg.type === 'card-move') {
      if (typeof msg.cardId !== 'string' || msg.cardId.length > 64 || !['fazer', 'fazendo', 'pronto'].includes(msg.coluna) ||
          !Number.isSafeInteger(msg.posicao) || msg.posicao < 0 || msg.posicao > 10_000) {
        return erroSocket(socket, 'movimento inválido');
      }
      if (!moverCartao(boardId, { cardId: msg.cardId, coluna: msg.coluna, posicao: msg.posicao, userId: socket.userId })) {
        return erroSocket(socket, 'movimento inválido');
      }
      broadcast(boardId, {
        type: 'card-move', boardId, cardId: msg.cardId, coluna: msg.coluna,
        posicao: msg.posicao, por: socket.userId, nome: socket.userName
      });
      return;
    }

    if (msg.type === 'card-create') {
      const cartao = inserirCartao(boardId, { titulo: msg.titulo, coluna: msg.coluna, userId: socket.userId });
      if (!cartao) return erroSocket(socket, 'cartão inválido');
      broadcast(boardId, { type: 'card-create', boardId, cartao });
    }
  });

  socket.on('close', () => {
    clearTimeout(timeoutAuth);
    clearTimeout(socket.inatividadeTimer);
    sairDaSala(socket);
    conexoesAtivas.delete(socket);
    const quantidade = (conexoesPorIp.get(socket.ip) || 1) - 1;
    if (quantidade > 0) conexoesPorIp.set(socket.ip, quantidade);
    else conexoesPorIp.delete(socket.ip);
  });
});

function moverCartao(boardId, { cardId, coluna, posicao, userId }) {
  if (!boardId || !cardId || !['fazer', 'fazendo', 'pronto'].includes(coluna) || !Number.isSafeInteger(posicao) || posicao < 0) return false;
  let transacaoAberta = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transacaoAberta = true;
    const cartao = db.prepare('SELECT id, coluna FROM cartoes WHERE id = ? AND quadro_id = ?').get(cardId, boardId);
    if (!cartao) { db.exec('ROLLBACK'); transacaoAberta = false; return false; }
    db.prepare('UPDATE cartoes SET posicao = posicao + 1 WHERE quadro_id = ? AND coluna = ? AND posicao >= ?').run(boardId, coluna, posicao);
    db.prepare('UPDATE cartoes SET coluna = ?, posicao = ? WHERE id = ? AND quadro_id = ?').run(coluna, posicao, cardId, boardId);
    m3.auditar(boardId, 'card-move', userId, cardId, `${cartao.coluna}->${coluna}; posição=${posicao}`);
    db.exec('COMMIT');
    transacaoAberta = false;
    return true;
  } catch {
    if (transacaoAberta) {
      try { db.exec('ROLLBACK'); } catch { /* mantém o erro original como falha do movimento */ }
    }
    return false;
  }
}

function inserirCartao(boardId, { titulo, coluna, userId }) {
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.trim().length > 120 || !['fazer', 'fazendo', 'pronto'].includes(coluna)) return null;
  let transacaoAberta = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    transacaoAberta = true;
    const max = db.prepare('SELECT COALESCE(MAX(posicao), -1) AS m FROM cartoes WHERE quadro_id = ? AND coluna = ?').get(boardId, coluna).m;
    const id = `c_${randomUUID()}`;
    const nome = titulo.trim();
    db.prepare('INSERT INTO cartoes (id, quadro_id, titulo, coluna, posicao) VALUES (?, ?, ?, ?, ?)').run(id, boardId, nome, coluna, max + 1);
    m3.auditar(boardId, 'card-create', userId, id, `coluna=${coluna}`);
    db.exec('COMMIT');
    transacaoAberta = false;
    return { id, quadro_id: boardId, titulo: nome, coluna, posicao: max + 1 };
  } catch {
    if (transacaoAberta) {
      try { db.exec('ROLLBACK'); } catch { /* mantém a falha da criação */ }
    }
    return null;
  }
}

export { server, app, wss, salas };

if (!process.env.KANBANEX_NO_LISTEN) {
  server.listen(PORT, () => console.log(`Kanbanex em http://localhost:${PORT} (REST + ws no mesmo servidor)`));
}
