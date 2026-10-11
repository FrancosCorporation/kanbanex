// Instância M3 compartilhada pelo REST e pelo relay, no mesmo SQLite do M1.
import { db } from './db.js';
import { criarM3 } from './m3.js';

export const m3 = criarM3(undefined, db);
