// Kanbanex M2 — sincronização CRDT com Yjs: posição/texto dos cards converge
// entre clientes sem perda silenciosa (ADR-001: Yjs para card state; membership LWW).
// O servidor mantém um Y.Doc por quadro e transmite updates binários via ws.
import * as Y from 'yjs';

export function criarSyncYjs() {
  const documentos = new Map(); // boardId -> Y.Doc

  function obter(boardId) {
    if (!documentos.has(boardId)) {
      const doc = new Y.Doc();
      doc.clientID = boardIdHash(boardId);
      documentos.set(boardId, doc);
    }
    return documentos.get(boardId);
  }

  // aplica um update binário (do cliente) no doc do servidor; devolve o update agregado
  function aplicar(boardId, updateBinario) {
    const doc = obter(boardId);
    Y.applyUpdate(doc, updateBinario);
    return Y.encodeStateAsUpdate(doc);
  }

  // snapshot completo do doc (para novos clientes / re-sync)
  function snapshot(boardId) {
    return Y.encodeStateAsUpdate(obter(boardId));
  }

  // estado legível do doc (para testes): mapa coluna -> [cards ordenados]
  function estado(boardId) {
    const doc = obter(boardId);
    const mapa = doc.getMap('quadro');
    const estado = {};
    for (const [coluna, arr] of mapa.entries()) {
      estado[coluna] = arr.toJSON ? arr.toJSON() : arr;
    }
    return estado;
  }

  return { obter, aplicar, snapshot, estado, documentos };
}

function boardIdHash(boardId) {
  let h = 0;
  for (const c of String(boardId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h || 1;
}
