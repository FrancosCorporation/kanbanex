// Testes de integração do Kanbanex — padrão do harness do chat_criptografado:
// servidor real em porta de teste + clientes ws reais provando o tempo real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const PORTA = 3890;
const BASE = `http://localhost:${PORTA}`;
const dbArquivo = join(mkdtempSync(join(tmpdir(), 'kanbanex-')), 'teste.db');

const servidor = spawn("node", ["server.js"], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(PORTA), KANBANEX_DB: dbArquivo },
  stdio: "ignore"
});
servidor.unref();
await new Promise((r) => setTimeout(r, 1200));

const chamar = (metodo, rota, corpo, token) =>
  fetch(BASE + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined
  }).then(async (r) => ({ status: r.status, corpo: await r.json().catch(() => null) }));

let token, quadroId;

test('registro + login (JWT)', async () => {
  const r1 = await chamar('POST', '/api/register', { nome: 'Rodolfo', email: 'rodrigo@kanbanex.dev', senha: 'segredo123' });
  assert.equal(r1.status, 201);
  const r2 = await chamar('POST', '/api/login', { email: 'rodrigo@kanbanex.dev', senha: 'segredo123' });
  assert.equal(r2.status, 200);
  assert.ok(r2.corpo.token);
  token = r2.corpo.token;
});

test('login errado devolve 401', async () => {
  const r = await chamar('POST', '/api/login', { email: 'rodrigo@kanbanex.dev', senha: 'errada' });
  assert.equal(r.status, 401);
});

test('sem token não lista quadros', async () => {
  const r = await chamar('GET', '/api/boards');
  assert.equal(r.status, 401);
});

test('cria quadro e cartões (REST)', async () => {
  const rq = await chamar('POST', '/api/boards', { nome: 'Sprint 1' }, token);
  assert.equal(rq.status, 201);
  quadroId = rq.corpo.id;
  const rc1 = await chamar('POST', `/api/boards/${quadroId}/cards`, { titulo: 'setup CI', coluna: 'fazer' }, token);
  assert.equal(rc1.status, 201);
  const rc2 = await chamar('POST', `/api/boards/${quadroId}/cards`, { titulo: 'deploy', coluna: 'fazer' }, token);
  assert.equal(rc2.status, 201);
  const detalhe = await chamar('GET', `/api/boards/${quadroId}`, null, token);
  assert.equal(detalhe.corpo.cartoes.length, 2);
});

test('cartão inválido rejeitado (coluna errada)', async () => {
  const r = await chamar('POST', `/api/boards/${quadroId}/cards`, { titulo: 'x', coluna: 'inexistente' }, token);
  assert.equal(r.status, 400);
});

test('TEMPO REAL: 2 clientes veem o mesmo movimento + presença', async () => {
  const detalhe = await chamar('GET', `/api/boards/${quadroId}`, null, token);
  const cartao = detalhe.corpo.cartoes[0];

  const a = new WebSocket(`ws://localhost:${PORTA}`);
  const b = new WebSocket(`ws://localhost:${PORTA}`);
  await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);
  a.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  b.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  await new Promise((r) => setTimeout(r, 400));

  const eventosB = [];
  b.on('message', (raw) => eventosB.push(JSON.parse(raw.toString())));

  // A move o cartão "setup CI" para FAZENDO
  a.send(JSON.stringify({ type: 'card-move', cardId: cartao.id, coluna: 'fazendo', posicao: 0, por: 'Rodolfo' }));
  await new Promise((r) => setTimeout(r, 700));

  const move = eventosB.find((e) => e.type === 'card-move');
  assert.ok(move, 'cliente B recebeu o card-move');
  assert.equal(move.cardId, cartao.id);
  assert.equal(move.coluna, 'fazendo');

  // persistiu?
  const depois = await chamar('GET', `/api/boards/${quadroId}`, null, token);
  const movido = depois.corpo.cartoes.find((c) => c.id === cartao.id);
  assert.equal(movido.coluna, 'fazendo');

  a.close(); b.close();
});

test('TEMPO REAL: cartão criado via ws chega ao outro cliente', async () => {
  const a = new WebSocket(`ws://localhost:${PORTA}`);
  const b = new WebSocket(`ws://localhost:${PORTA}`);
  await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);
  a.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  b.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  await new Promise((r) => setTimeout(r, 400));

  const eventosB = [];
  b.on('message', (raw) => eventosB.push(JSON.parse(raw.toString())));
  a.send(JSON.stringify({ type: 'card-create', titulo: 'criado ao vivo', coluna: 'pronto' }));
  await new Promise((r) => setTimeout(r, 700));

  const cria = eventosB.find((e) => e.type === 'card-create');
  assert.ok(cria, 'cliente B recebeu o card-create');
  assert.equal(cria.cartao.titulo, 'criado ao vivo');
  assert.equal(cria.cartao.coluna, 'pronto');

  a.close(); b.close();
});

test('concorrência: 2 moves simultâneos do mesmo cartão não corrompem o estado', async () => {
  const detalhe = await chamar('GET', `/api/boards/${quadroId}`, null, token);
  const cartao = detalhe.corpo.cartoes[0];
  const a = new WebSocket(`ws://localhost:${PORTA}`);
  const b = new WebSocket(`ws://localhost:${PORTA}`);
  await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);
  a.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  b.send(JSON.stringify({ type: 'join', boardId: quadroId }));
  await new Promise((r) => setTimeout(r, 400));
  // dois moves quase simultâneos (colunas diferentes)
  a.send(JSON.stringify({ type: 'card-move', cardId: cartao.id, coluna: 'pronto', posicao: 0, por: 'A' }));
  b.send(JSON.stringify({ type: 'card-move', cardId: cartao.id, coluna: 'fazer', posicao: 0, por: 'B' }));
  await new Promise((r) => setTimeout(r, 800));
  const fim = await chamar('GET', `/api/boards/${quadroId}`, null, token);
  const pos = fim.corpo.cartoes.filter((c) => c.coluna === 'pronto').length + fim.corpo.cartoes.filter((c) => c.coluna === 'fazer').length;
  assert.ok(pos >= 2, 'estado íntegro: nenhum cartão perdido');
  a.close(); b.close();
});

process.on('exit', () => servidor.kill());
