// Kanbanex M3 — convites por link + histórico de auditoria dos movimentos.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function criarM3(dbPath, dbExistente = null) {
  // usa o MESMO db do kanbanex (cria se necessário)
  const db = dbExistente || new DatabaseSync(dbPath || 'kanbanex.db');
  db.exec(`
  CREATE TABLE IF NOT EXISTS convites (
    token TEXT PRIMARY KEY,
    quadro_id TEXT NOT NULL,
    criado_por TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT (datetime('now')),
    usos INTEGER NOT NULL DEFAULT 0,
    expira_em TEXT
  );
  CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quadro_id TEXT NOT NULL,
    acao TEXT NOT NULL,
    card_id TEXT,
    usuario TEXT NOT NULL,
    detalhe TEXT DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  return {
    db,

    // convite por link: token único, expiração opcional (dias)
    criarConvite(quadroId, criadoPor, diasValidade = 7) {
      const token = randomUUID().replace(/-/g, '').slice(0, 16);
      const expira = diasValidade ? new Date(Date.now() + diasValidade * 86400000).toISOString() : null;
      db.prepare('INSERT INTO convites (token, quadro_id, criado_por, expira_em) VALUES (?, ?, ?, ?)').run(token, quadroId, criadoPor, expira);
      return { token, link: `/entrar/${token}`, expiraEm: expira };
    },

    // usa o convite (valida expiração + incrementa usos)
    usarConvite(token) {
      const c = db.prepare('SELECT * FROM convites WHERE token = ?').get(token);
      if (!c) return { ok: false, motivo: 'inexistente' };
      if (c.expira_em && new Date(c.expira_em) < new Date()) return { ok: false, motivo: 'expirado' };
      db.prepare('UPDATE convites SET usos = usos + 1 WHERE token = ?').run(token);
      return { ok: true, quadroId: c.quadro_id };
    },

    listarConvites(quadroId) {
      return db.prepare('SELECT token, criado_por, usos, criado_em, expira_em FROM convites WHERE quadro_id = ?').all(quadroId);
    },

    // auditoria: registra cada ação (move/create/delete) com usuário e detalhe
    auditar(quadroId, acao, usuario, cardId = null, detalhe = '') {
      db.prepare('INSERT INTO auditoria (quadro_id, acao, card_id, usuario, detalhe) VALUES (?, ?, ?, ?, ?)')
        .run(quadroId, acao, cardId, usuario, detalhe);
    },

    historico(quadroId, limite = 50) {
      return db.prepare('SELECT acao, card_id, usuario, detalhe, criado_em FROM auditoria WHERE quadro_id = ? ORDER BY id DESC LIMIT ?').all(quadroId, limite);
    },

    // atividade por usuário (quem mais mexeu)
    atividadePorUsuario(quadroId) {
      return db.prepare('SELECT usuario, COUNT(*) AS acoes FROM auditoria WHERE quadro_id = ? GROUP BY usuario ORDER BY acoes DESC').all(quadroId);
    }
  };
}
