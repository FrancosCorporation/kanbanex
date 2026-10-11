// Persistência zero-dep via node:sqlite (DatabaseSync).
import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(process.env.KANBANEX_DB || 'kanbanex.db');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quadros (
  id TEXT PRIMARY KEY,
  dono_id TEXT NOT NULL,
  nome TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cartoes (
  id TEXT PRIMARY KEY,
  quadro_id TEXT NOT NULL,
  titulo TEXT NOT NULL,
  coluna TEXT NOT NULL CHECK (coluna IN ('fazer','fazendo','pronto')),
  posicao INTEGER NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cartoes_quadro ON cartoes (quadro_id, coluna, posicao);
`);

const emailsDuplicados = db.prepare('SELECT 1 FROM usuarios GROUP BY lower(email) HAVING COUNT(*) > 1 LIMIT 1').get();
if (!emailsDuplicados) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_canonico ON usuarios (lower(email))');
} else {
  console.warn('[Kanbanex] Há contas com e-mails que diferem apenas por maiúsculas/minúsculas; índice normalizado não criado.');
}
