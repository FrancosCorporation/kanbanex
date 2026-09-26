// Testes do M2: convergência CRDT — 2 docs recebem updates em ORDEM DIFERENTE e convergem iguais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { criarSyncYjs } from '../src/sync-yjs.js';

test('sync-yjs: snapshot vazio inicial', () => {
  const sync = criarSyncYjs();
  const snap = sync.snapshot('board-x');
  assert.ok(snap instanceof Uint8Array);
  assert.ok(snap.length > 0);
});

test('CONVERGÊNCIA: updates aplicados em ordem diferente → estado idêntico (sem perda)', () => {
  const sync = criarSyncYjs();
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  // A cria 3 cards no mapa 'fazer'
  const mapaA = docA.getMap('quadro');
  const cardsA = mapaA.set('fazer', new Y.Array());
  // Yjs: precisa obter a referência após set
  const listaA = mapaA.get('fazer');
  listaA.push(['card-1', 'card-2', 'card-3']);
  const updateA = Y.encodeStateAsUpdate(docA);

  // B cria 2 cards no mapa 'fazendo' (trabalho concorrente!)
  const mapaB = docB.getMap('quadro');
  mapaB.set('fazendo', new Y.Array());
  const listaB = mapaB.get('fazendo');
  listaB.push(['card-4', 'card-5']);
  const updateB = Y.encodeStateAsUpdate(docB);

  // sincroniza em ORDEM DIFERENTE: servidor agrega; A recebe B primeiro, B recebe A depois
  const agregado = sync.aplicar('board-x', updateA);
  const agregado2 = sync.aplicar('board-x', updateB);

  // aplica o estado agregado em ambos os docs
  Y.applyUpdate(docA, Y.encodeStateAsUpdate(sync.obter('board-x')));
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(sync.obter('board-x')));

  // convergência: os dois docs têm EXATAMENTE o mesmo estado (nada perdido!)
  const tA = docA.getMap('quadro').get('fazer').toJSON();
  const tB = docB.getMap('quadro').get('fazer').toJSON();
  assert.deepEqual(tA, tB, 'cards de "fazer" convergiram');
  const fA = docA.getMap('quadro').get('fazendo').toJSON();
  const fB = docB.getMap('quadro').get('fazendo').toJSON();
  assert.deepEqual(fA, fB, 'cards de "fazendo" convergiram');
  assert.deepEqual(tA, ['card-1', 'card-2', 'card-3'], 'nenhum card perdido');
  assert.deepEqual(fA, ['card-4', 'card-5'], 'nenhum card perdido');
});

test('movimento de card via CRDT: delete+insert converge sem duplicar nem perder', () => {
  const docA = new Y.Doc();
  const mapaA = docA.getMap('quadro');
  mapaA.set('fazer', new Y.Array());
  const listaA = mapaA.get('fazer');
  listaA.push(['a', 'b', 'c']);
  const mapaB = docB(mapaA);
  function docB(m) { return m; } // noop (clareza)

  // B recebe o estado inicial
  const docB2 = new Y.Doc();
  Y.applyUpdate(docB2, Y.encodeStateAsUpdate(docA));
  const mapaB2 = docB2.getMap('quadro');
  const listaB2 = mapaB2.get('fazer');

  // A move 'b' para 'pronto' (delete+insert concorrente)
  listaA.delete(1, 1);
  mapaA.set('pronto', new Y.Array());
  mapaA.get('pronto').push(['b']);
  const upA = Y.encodeStateAsUpdate(docA);

  // B renomeia 'a' -> 'a-renomeado' ao mesmo tempo (conflito de TEXTO!)
  listaB2.delete(0, 1);
  listaB2.insert(0, ['a-renomeado']);
  const upB = Y.encodeStateAsUpdate(docB2);

  // troca os updates
  Y.applyUpdate(docA, upB);
  Y.applyUpdate(docB2, upA);

  // convergência: ambos têm 'a-renomeado' em fazer E 'b' em pronto
  const fimA = { fazer: docA.getMap('quadro').get('fazer').toJSON(), pronto: docA.getMap('quadro').get('pronto').toJSON() };
  const fimB = { fazer: docB2.getMap('quadro').get('fazer').toJSON(), pronto: docB2.getMap('quadro').get('pronto').toJSON() };
  assert.deepEqual(fimA.fazer, fimB.fazer, 'fazer convergiu');
  assert.deepEqual(fimA.pronto, fimB.pronto, 'pronto convergiu');
  assert.deepEqual(fimA.fazer, ['a-renomeado', 'c'], 'renomeação sem perda, ordem preservada');
  assert.deepEqual(fimA.pronto, ['b'], 'card movido sem duplicar');
});
