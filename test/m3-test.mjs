// Testes M3 do kanbanex — convites (criar/usar/expirar) + auditoria (histórico + atividade por usuário).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarM3 } from '../src/m3.js';

const nova = () => criarM3(join(mkdtempSync(join(tmpdir(), 'kb3-')), 't.db'));

test('convite: criar com link e expiração de 7 dias', () => {
  const m = nova();
  const c = m.criarConvite('board-1', 'Rodolfo');
  assert.equal(c.token.length, 16);
  assert.equal(c.link, `/entrar/${c.token}`);
  assert.ok(c.expiraEm);
});

test('convite: usar incrementa usos e devolve o quadro', () => {
  const m = nova();
  const c = m.criarConvite('board-1', 'Rodolfo');
  const u1 = m.usarConvite(c.token);
  assert.equal(u1.ok, true);
  assert.equal(u1.quadroId, 'board-1');
  m.usarConvite(c.token);
  const lista = m.listarConvites('board-1');
  assert.equal(lista[0].usos, 2);
});

test('convite: token inexistente e EXPIRADO rejeitados', () => {
  const m = nova();
  assert.equal(m.usarConvite('nao-existe').motivo, 'inexistente');
  const c = m.criarConvite('board-1', 'R', 7);
  // força expiração no banco
  m.db.prepare('UPDATE convites SET expira_em = ? WHERE token = ?').run(new Date(Date.now() - 86400000).toISOString(), c.token);
  assert.equal(m.usarConvite(c.token).motivo, 'expirado');
});

test('auditoria: registra ações com usuário e detalhe', () => {
  const m = nova();
  m.auditar('board-1', 'card-move', 'Rodolfo', 'c_123', 'fazer->fazendo');
  m.auditar('board-1', 'card-create', 'Ana', 'c_456', 'novo card');
  m.auditar('board-1', 'card-move', 'Rodolfo', 'c_789', 'fazendo->pronto');
  const hist = m.historico('board-1');
  assert.equal(hist.length, 3);
  assert.equal(hist[0].acao, 'card-move', 'mais recente primeiro');
  assert.equal(hist[1].acao, 'card-create');
});

test('auditoria: atividade por usuário (quem mais mexeu)', () => {
  const m = nova();
  m.auditar('board-1', 'card-move', 'Rodolfo', 'c1');
  m.auditar('board-1', 'card-move', 'Rodolfo', 'c2');
  m.auditar('board-1', 'card-move', 'Ana', 'c3');
  const at = m.atividadePorUsuario('board-1');
  assert.equal(at[0].usuario, 'Rodolfo');
  assert.equal(at[0].acoes, 2);
  assert.equal(at[1].usuario, 'Ana');
});

test('auditoria: limite de histórico (50 padrão)', () => {
  const m = nova();
  for (let i = 0; i < 60; i++) m.auditar('board-1', 'card-move', `u${i}`, `c${i}`);
  assert.equal(m.historico('board-1').length, 50);
});
