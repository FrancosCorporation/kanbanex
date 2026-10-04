# MELHORIAS — kanbanex

> **Gerado por análise de código em 2026-10-02** · Stack: Node 22 (Express + `ws` + `node:sqlite` + JWT + BCrypt + `yjs`)
> Branch `main` · base `0e26d97` (M3: convites + auditoria, 16/16 testes) · 886 LOC · **3 suites** · CI presente
>
> **Este arquivo é um plano de execução.** Cada item tem ID, `arquivo:linha`, mudança exata,
> critério de aceite e comando de verificação.

---

## 0. Como usar este documento

1. Execute na ordem **P0 → P1 → P2 → P3**, respeitando as ondas da §8.
2. Ao terminar um item: marque `- [x]`, rode o **Verificação**, comite `fix(<ID>): descrição`.
3. **Não reescreva o relay.** O `ws` sobre HTTP único é padrão validado no `chat_criptografado` —
   os defeitos são de **autorização e de limite**, não de transporte.
4. **Não "corrija" a transação do `moverCartao`.** O `BEGIN/COMMIT/ROLLBACK` de `server.js:95-104`
   está correto; o problema é quem pode chamá-lo, não como ele persiste.
5. **Idioma:** português; commits em inglês com `fix:`/`feat:`/`docs:`.

---

## 1. Diagnóstico executivo

Kanban colaborativo em tempo real: REST para quadros/cartões, relay WebSocket para presença e
movimentos, com M2 (CRDT Yjs) e M3 (convites + auditoria). São 11 arquivos com 16 testes e CI — o
projeto mais maduro da Wave 2, com `ADR-001.md` documentando a decisão de sincronização.

**O que está bem (não refaça):**

| Item | Evidência |
|---|---|
| Senha com BCrypt custo 10 + resposta uniforme | `auth.js:19,26-27` |
| SQL parametrizado em todo o REST | `api.js`, `auth.js`, `db.js` — nenhum template string com dado |
| Transação com rollback no movimento | `server.js:95-104` |
| Validação de domínio no cartão (coluna enum, título ≤120) | `server.js:108-109`, `api.js:31` |
| CHECK constraint no schema | `db.js:22` (`coluna IN (...)`) + índice `db.js:26` |
| `listarQuadros` filtra por dono | `api.js:6` (`WHERE dono_id = ?`) |
| Path traversal bloqueado no estático | `server.js:34` |
| Token extraído com segurança | `auth.js:35-36` (checa `Bearer ` antes de fatiar — sem `Split[1]`) |
| ADR documentado e testado | `ADR-001.md` + `sync-yjs-test.mjs` |
| Convite com expiração + contagem de usos | `m3.js:32-46` |

**O que está quebrado:**

1. **O relay WebSocket não autentica ninguém** (`server.js:50`): qualquer conexão entra em qualquer
   sala (`join` com `boardId` arbitrário, linhas 54-57), move cartão (`card-move`, linha 63) e cria
   cartão (`card-create`, linha 68) — tudo sem token, mesmo o REST exigindo.
2. **IDOR no REST**: `obterQuadro` (`api.js:21`) e `criarCartao` (`api.js:29`) não conferem `dono_id`
   — qualquer token lê/escreve em quadro alheio.
3. **M2 e M3 não estão ligados ao servidor.** `sync-yjs.js` só é importado por `test/sync-yjs-test.mjs`;
   nenhuma rota expõe convite/auditoria (`grep convite server.js` → vazio). São 16 testes verdes para
   código que **não roda em produção**.

---

## 2. Tabela de prioridades

| ID | Título | Sev | Arquivo | Depende de |
|---|---|---|---|---|
| SEC-01 | Relay `ws` sem autenticação (join/move/create livres) | **P0** | `server.js:50-72` | — |
| SEC-02 | IDOR: `obterQuadro` lê quadro alheio | **P0** | `src/api.js:21` | — |
| SEC-03 | IDOR: `criarCartao` escreve em quadro alheio | **P0** | `src/api.js:29` | — |
| SEC-04 | Fallback de segredo JWT hardcoded | **P0** | `src/auth.js:7` | — |
| SEC-05 | Relay sem `maxPayload` nem limite de conexões | **P1** | `server.js:47` | SEC-01 |
| SEC-06 | `msg.por` aceito do cliente (spoof de autor) | **P1** | `server.js:66` | SEC-01 |
| SEC-07 | Login/register sem rate limit | **P1** | `server.js:19-20` | — |
| BUG-01 | M2 (Yjs) não está ligado ao relay — só existe em teste | **P1** | `src/sync-yjs.js` | SEC-01 |
| BUG-02 | M3 (convites/auditoria) sem rota HTTP | **P1** | `src/m3.js` | — |
| BUG-03 | `Math.random` no ID do cartão (colisão + previsível) | **P1** | `src/api.js:35`, `server.js:111` | — |
| BUG-04 | `join` sem validar existência do quadro | **P1** | `server.js:54-57` | SEC-01 |
| BUG-05 | Sala `ws` nunca expira (vazamento de memória) | **P2** | `server.js:48` | — |
| BUG-06 | Token de convite com 16 hex (64 bits) | **P2** | `src/m3.js:33` | BUG-02 |
| IMP-01 | `usarConvite` sem limite de usos configurável | **P2** | `src/m3.js:40-46` | BUG-02 |
| TEST-01 | Testes não cobrem IDOR nem relay autenticado | **P1** | `test/kanban-test.mjs` | SEC-02, SEC-03 |
| TEST-02 | Sem teste do M2 ligado ao relay | **P2** | novo `test/` | BUG-01 |
| DEVOPS-01 | `kanbanex.db` commitado no repo | **P1** | `kanbanex.db` | — |
| DEVOPS-02 | Sem `.env.example` | **P2** | *(ausente)* | SEC-04 |
| DOC-01 | README não documenta M2/M3 como não-expostos | **P2** | `README.md` (74 linhas) | BUG-01, BUG-02 |
| DOC-02 | ADR-001 desatualizado (Yjs não está no relay) | **P3** | `ADR-001.md` | BUG-01 |

**Placar: 4 P0 · 9 P1 · 6 P2 · 1 P3 = 20 itens.**

---

## 3. Segurança
### SEC-01 · Relay `ws` sem autenticação (join/move/create livres) · [P0]

- **Arquivo:** `server.js:50-72`
- **Evidência:**
  ```javascript
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'join') {
        socket.boardId = msg.boardId;   // sem verificar nada
  ```
  Nenhuma linha do handler toca em token. O REST exige (`auth.js:33-44`), o relay **não**.
- **Impacto:** qualquer pessoa com a URL entra em **qualquer** sala (`join` com `boardId` arbitrário),
  move cartões (`card-move` → `moverCartao` persiste no banco, linha 64) e cria cartões
  (`card-create` → `inserirCartao`, linha 69). Ou seja: **todo o controle de acesso do REST é
  contornável pelo relay** — o atacante nem precisa de conta. E como `msg.por` vem do cliente
  (`SEC-06`), a auditoria (quando ligada) registrará o nome que o atacante escolher.
- **Mudança:** (1) exigir token no handshake `ws` — aceitar via `Sec-WebSocket-Protocol` ou primeiro
  `join` com `{ boardId, token }`, validando com o mesmo `jwt.verify` de `auth.js:39`;
  (2) no `join`, conferir que o quadro **existe e pertence** ao `sub` do token (liga a `SEC-02`);
  (3) guardar `socket.userId = payload.sub` e usá-lo como autor (liga a `SEC-06`);
  (4) recusar `card-move`/`card-create` sem `join` prévio válido.
- **Aceite:** conexão sem token não entra em sala nem move cartão; com token de outro dono, o `join`
  é recusado.
- **Verificação:**
  ```bash
  node -e "const WebSocket=require('ws');const w=new WebSocket('ws://localhost:3210');
  w.on('open',()=>w.send(JSON.stringify({type:'join',boardId:'qualquer'})));
  w.on('message',d=>console.log('resposta:',d.toString().slice(0,80)));
  setTimeout(()=>process.exit(0),2000)"
  # esperado: recusa (close ou error), nunca 'joined'
  ```

### SEC-02 · IDOR em `obterQuadro` (lê quadro alheio) · [P0]

- **Arquivo:** `src/api.js:20-25`
- **Evidência:**
  ```javascript
  const quadro = db.prepare('SELECT * FROM quadros WHERE id = ?').get(req.params.id);
  ```
  Sem `AND dono_id = ?`. Comparar com `listarQuadros` (linha 6), que filtra corretamente.
- **Impacto:** qualquer token lista cartões de **qualquer** quadro — basta o ID (12 chars,
  `api.js:15`). Como `criarCartao` também não checa (`SEC-03`), leitura + escrita alheias estão
  abertas no REST, independentemente do relay.
- **Mudança:** `WHERE id = ? AND dono_id = ?` com `req.usuario.sub`; ausência → `404` uniforme
  (não `403`, para não confirmar existência — documentar a escolha no `TEST-01`).
- **Aceite:** token de A + `GET /api/boards/<id-de-B>` → `404`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3210/api/boards/$ID_B \
    -H "Authorization: Bearer $TOKEN_A"     # esperado 404
  ```

### SEC-03 · IDOR em `criarCartao` (escreve em quadro alheio) · [P0]

- **Arquivo:** `src/api.js:27-39`
- **Evidência:** `SELECT id FROM quadros WHERE id = ?` (linha 29) — checa existência, não dono.
- **Impacto:** token de A cria cartão no quadro de B, poluindo o board alheio. E como o relay
  retransmite `card-create` sem validar (`server.js:68-71`), o cartão aparece na tela de B em tempo
  real — vandalismo visível.
- **Mudança:** mesma checagem de dono do `SEC-02`, antes do `INSERT`.
- **Aceite:** `POST /api/boards/<id-de-B>/cards` com token de A → `404`.
- **Verificação:**
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3210/api/boards/$ID_B/cards \
    -H "Authorization: Bearer $TOKEN_A" -H 'Content-Type: application/json' \
    -d '{"titulo":"x","coluna":"fazer"}'    # esperado 404
  ```

### SEC-04 · Fallback de segredo JWT hardcoded · [P0]

- **Arquivo:** `src/auth.js:7`
- **Evidência:** `const SEGREDO = process.env.JWT_SECRET || 'kanbanex-dev-secret-troque-em-producao';`
- **Impacto:** sem `JWT_SECRET`, sobe com segredo público — e o nome do fallback **é o próprio
  segredo**. Token forjável; com `SEC-02`/`SEC-03` abertos, acesso total.
- **Mudança:** falhar sem a variável (mínimo 32 bytes), padrão da casa:
  ```javascript
  const SEGREDO = process.env.JWT_SECRET;
  if (!SEGREDO || Buffer.byteLength(SEGREDO, 'utf8') < 32)
    throw new Error('JWT_SECRET nao definido ou curto (min 32 bytes).');
  ```
- **Aceite:** sem `JWT_SECRET` o processo morre com mensagem clara.
- **Verificação:**
  ```bash
  grep -n 'kanbanex-dev-secret' src/auth.js && echo FALHA || echo OK
  unset JWT_SECRET; node server.js 2>&1 | grep -qi 'JWT_SECRET' && echo OK
  ```

### SEC-05 · Relay sem `maxPayload` nem limite de conexões · [P1]

- **Arquivo:** `server.js:47` (`new WebSocketServer({ server })`)
- **Evidência:** construtor só com `{ server }` — sem `maxPayload`, sem contagem de conexões, sem
  limite por sala. O mesmo defeito do `chat_criptografado` (`BUG-00`/`BUG-01` de lá), herdado junto
  com o padrão (o comentário da linha 2 admite a origem).
- **Impacto:** mensagem gigante → `JSON.parse` de buffer enorme + `broadcast` que multiplica por N
  pares; milhares de conexões vazias esgotam FDs. Sem auth (`SEC-01`), qualquer anônimo executa.
- **Mudança:** (1) `maxPayload: 1_048_576` (1 MB — cartão/move cabem com folga);
  (2) teto global de conexões + por IP; (3) fechar conexão ociosa após timeout;
  (4) validar `msg.boardId` como string curta antes de usar como chave de `Map`.
- **Aceite:** payload > 1 MB fecha com 1009; 101ª conexão é recusada.
- **Verificação:**
  ```bash
  grep -n 'maxPayload' server.js   # deve existir
  node -e "const WebSocket=require('ws');const w=new WebSocket('ws://localhost:3210');
  w.on('open',()=>w.send('a'.repeat(2*1024*1024)));w.on('close',c=>console.log('close',c));
  setTimeout(()=>process.exit(0),2500)"   # esperado close 1009
  ```

### SEC-06 · `msg.por` aceito do cliente (spoof de autor) · [P1]

- **Arquivo:** `server.js:66` (`por: msg.por`)
- **Evidência:** o broadcast repassa `por: msg.por` — campo digitado pelo remetente, nunca validado.
  Idêntico ao `BUG-02` do `chat_criptografado` (`pacote.from`).
- **Impacto:** atacante move cartão "em nome de" outro usuário; a auditoria M3 (quando ligada,
  `BUG-02`) registrará o nome forjado como autor — histórico contaminado na fonte.
- **Mudança:** (requer `SEC-01`) usar `socket.userId` (do token) como autor; ignorar `msg.por`.
- **Aceite:** `card-move` com `por: 'outro'` aparece com o ID do token, não com `'outro'`.
- **Verificação:** enviar `por` forjado e conferir o broadcast recebido (deve trazer o `sub` real).

### SEC-07 · Login/register sem rate limit · [P1]

- **Arquivo:** `server.js:19-20`
- **Evidência:** rotas públicas diretas; nenhum contador no projeto.
- **Impacto:** brute-force + enumeração de e-mail (o `409` de `auth.js:14-16` distingue existente).
  Cada tentativa custa BCrypt — DoS assimétrico barato.
- **Mudança:** rate limit por IP (20/5 min) + por e-mail (5/5 min) → `429` com `Retry-After`.
- **Aceite:** 6ª tentativa no e-mail em 5 min → `429`.
- **Verificação:**
  ```bash
  for i in $(seq 1 7); do
    curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3210/api/login \
      -H 'Content-Type: application/json' -d '{"email":"a@a.com","senha":"x"}'
  done; echo
  ```
---

## 4. Bugs e defeitos funcionais

### BUG-01 · M2 (Yjs) não está ligado ao relay — só existe em teste · [P1]

- **Arquivo:** `src/sync-yjs.js` (48 linhas) · `server.js` (nenhuma referência)
- **Evidência:** `grep -rln 'sync-yjs' server.js src/` → vazio; só `test/sync-yjs-test.mjs` importa.
  O `ADR-001.md` declara Yjs como decisão **aceita** para estado de card, mas o relay real
  (`server.js:63-71`) persiste via SQL direto, sem CRDT.
- **Impacto:** dois problemas em um: (a) o comportamento testado (convergência CRDT) **não é** o
  comportamento de produção (LWW via SQL) — os testes provam algo que não roda; (b) a decisão do
  ADR está documentada como implementada sem estar. Movimento simultâneo em produção **perde
  edição silenciosamente** — exatamente o problema que o ADR diz ter resolvido.
- **Mudança:** (1) ligar o `criarSyncYjs()` ao relay: `card-move` aplica update Yjs **e** persiste;
  (2) novos clientes recebem `snapshot()` no `join`; (3) `TEST-02` prova convergência pelo relay real;
  (4) **ou** arquivar o M2 (atualizar ADR para "adiado") se a decisão for manter SQL — mas nunca
  manter os dois divergentes.
- **Aceite:** dois clientes movendo o mesmo cartão simultaneamente convergem (sem perda); ou ADR
  marcado como adiado com motivo.
- **Verificação:**
  ```bash
  grep -n 'sync-yjs\|criarSyncYjs' server.js   # deve existir (ou ADR adiado)
  node --test test/sync-yjs-test.mjs
  ```

### BUG-02 · M3 (convites/auditoria) sem rota HTTP · [P1]

- **Arquivo:** `src/m3.js` (67 linhas) · `server.js` (nenhuma rota)
- **Evidência:** `grep -n 'convite\|auditoria\|historico\|entrar' server.js` → vazio. O commit
  `0e26d97` anuncia "M3 - convites por link + auditoria completa (16/16 testes)", mas nenhuma rota
  expõe `criarConvite`, `usarConvite`, `historico` ou `auditar`.
- **Impacto:** funcionalidade anunciada e testada que **não é acessível**. Pior: `auditar()` nunca é
  chamada pelo relay (`card-move` em `server.js:63-71` não registra nada), então mesmo quando as
  rotas existirem, o histórico nasce vazio — auditoria que não audita.
- **Mudança:** (1) rotas `POST /api/boards/:id/convites` (dono, exige `SEC-02`), `GET /entrar/:token`
  (público, valida expiração), `GET /api/boards/:id/historico` (dono);
  (2) chamar `auditar()` em `card-move`/`card-create` com `socket.userId` (liga a `SEC-01`/`SEC-06`);
  (3) `TEST-01` cobre o fluxo pela rota.
- **Aceite:** criar convite pela rota, entrar pelo link e ver o movimento no histórico.
- **Verificação:**
  ```bash
  grep -n 'convites\|historico' server.js   # rotas existem
  # fluxo: POST convite -> GET /entrar/:token -> mover cartao -> GET historico mostra a acao
  ```

### BUG-03 · `Math.random` no ID do cartão (colisão + previsível) · [P1]

- **Arquivo:** `src/api.js:35` e `server.js:111`
- **Evidência:** `` `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` `` — idêntico nos dois
  caminhos (REST e relay). `Date.now()` + 6 chars base36 ≈ 31 bits de aleatoriedade.
- **Impacto:** dois cartões criados no mesmo milissegundo (relay com 2 clientes, teste paralelo)
  têm chance real de colidir — e `id` é PRIMARY KEY (`db.js:19`), então o segundo `INSERT` **falha
  com constraint**. Além disso o ID é previsível (timestamp + aleatório fraco), o que ajuda
  enumeração (`SEC-02`).
- **Mudança:** `randomUUID()` (já importado em `api.js:2`) nos dois pontos — `c_${randomUUID()}` ou
  UUID puro. Regra da casa: `Math.random` nunca em identificador.
- **Aceite:** nenhum `Math.random` em ID nos dois arquivos.
- **Verificação:**
  ```bash
  grep -n 'Math.random' src/api.js server.js && echo FALHA || echo OK
  ```

### BUG-04 · `join` sem validar existência do quadro · [P1]

- **Arquivo:** `server.js:54-57`
- **Evidência:** `socket.boardId = msg.boardId` e `salas.set(msg.boardId, ...)` sem checar se o quadro
  existe no banco. Qualquer string vira sala.
- **Impacto:** salas fantasmas acumulam no `Map` (`BUG-05`); `card-move` em sala fantasma falha
  silenciosamente (`moverCartao` devolve `false`, linha 65); e o `join` bem-sucedido em ID inexistente
  dá falsa sensação de conexão.
- **Mudança:** (junto com `SEC-01`) no `join`, buscar o quadro e recusar se inexistente ou de outro
  dono; responder `joined` só após validar.
- **Aceite:** `join` com `boardId` inexistente é recusado (não entra na sala).
- **Verificação:** enviar `join` com ID aleatório e conferir que não chega `joined`.

### BUG-05 · Sala `ws` nunca expira (vazamento de memória) · [P2]

- **Arquivo:** `server.js:48` (`const salas = new Map();`)
- **Evidência:** o `close` (linhas 73-79) remove o socket da sala, mas **nunca remove a sala** do
  `Map` — mesmo vazia para sempre. Salas fantasmas do `BUG-04` também ficam.
- **Impacto:** crescimento indefinido do `Map` (chave por `boardId` + `Set` vazio) num processo
  24/7. Com Yjs ligado (`BUG-01`), cada sala guarda ainda um `Y.Doc` (~1 KB+) — o vazamento multiplica.
- **Mudança:** ao esvaziar, `salas.delete(boardId)` (e descartar o `Y.Doc` correspondente); logar a
  limpeza em modo debug.
- **Aceite:** após todos saírem, a sala some do `Map`.
- **Verificação:** entrar/sair e inspecionar `salas.size` (expor via endpoint debug ou teste).

### BUG-06 · Token de convite com 16 hex (64 bits) · [P2]

- **Arquivo:** `src/m3.js:33` (`randomUUID().replace(/-/g, '').slice(0, 16)`)
- **Evidência:** UUID sem hífens tem 32 hex (128 bits); cortado para 16 = **64 bits**. O link é
  `/entrar/${token}` (linha 36) — token na URL, compartilhável.
- **Impacto:** 64 bits é pouco para segredo de URL pública e permanente (até 7 dias, linha 32-34).
  Com expiração longa e sem limite de tentativas (ver `IMP-01`), força bruta do espaço de 64 bits
  é factível para atacante dedicado. E o truncamento desperdiça os 128 bits que já estavam na mão.
- **Mudança:** usar os 32 hex completos (128 bits); considerar `randomBytes(16).toString('hex')`
  explícito. Combinar com rate limit no `/entrar/:token` (liga ao `SEC-07`).
- **Aceite:** token com 32 hex; nenhum `.slice(0, 16)` em segredo.
- **Verificação:**
  ```bash
  grep -n 'slice(0, 16)' src/m3.js && echo FALHA || echo OK
  ```

### IMP-01 · `usarConvite` sem limite de usos configurável · [P2]

- **Arquivo:** `src/m3.js:40-46`
- **Evidência:** `usos` é incrementado (linha 44) mas **nunca** comparado a um máximo — só expiração
  por data (linha 43). Um link "para a Maria" pode ser repassado infinitamente dentro da validade.
- **Impacto:** convite unipessoal vira convite público de fato. A contagem existe mas não limita —
  é telemetria sem enforcement.
- **Mudança:** `max_usos` na criação (default 1 para convite pessoal, `NULL` para aberto); `usarConvite`
  recusa quando `usos >= max_usos`.
- **Aceite:** convite `max_usos=1` funciona uma vez; a segunda tentativa é recusada.
- **Verificação:** usar o mesmo token 2× e conferir `ok: false` na segunda.
---

## 5. Qualidade: testes, arquitetura e observabilidade

### TEST-01 · Testes cobrem CRUD mas não autorização · [P1]

- **Arquivo:** `test/kanban-test.mjs` (141 linhas), `test/m3-test.mjs` (65 linhas)
- **Evidência:** 16 testes cobrem CRUD, convite, expiração e auditoria em memória — mas **nenhum**
  cria dois donos e cruza quadro. E nenhum testa o relay com token (o relay nem aceita token).
- **Impacto:** os 3 P0 (`SEC-01`, `SEC-02`, `SEC-03`) sobrevivem porque o teste valida fluxo feliz.
  É o mesmo padrão das APIs irmãs.
- **Mudança:** adicionar: A lê quadro de B → 404; A cria cartão em B → 404; `join` sem token →
  recusa; `join` com token de outro dono → recusa; `card-move` sem `join` → erro.
- **Aceite:** `npm test` inclui os 5 casos; remover uma checagem quebra o build.
- **Verificação:**
  ```bash
  npm test 2>&1 | tail -3   # 21/21 (16 + 5)
  ```

### TEST-02 · Sem teste do M2 ligado ao relay · [P2]

- **Arquivo:** novo `test/relay-yjs-test.mjs`
- **Evidência:** `sync-yjs-test.mjs` testa CRDT **em memória** (dois `Y.Doc` locais), nunca pelo
  `ws` real. Se o `BUG-01` for corrigido, não há prova de convergência pelo relay.
- **Impacto:** a correção do `BUG-01` sem teste é trocar um comportamento não-provado por outro.
- **Mudança:** dois clientes `ws` reais movendo o mesmo cartão simultaneamente pelo relay;
  assert de convergência (mesmo estado final nos dois + no banco).
- **Aceite:** o teste passa com Yjs ligado e **falha** (perda silenciosa) com SQL puro.
- **Verificação:**
  ```bash
  node --test test/relay-yjs-test.mjs
  ```

---

## 6. DevOps / Infra

### DEVOPS-01 · `kanbanex.db` commitado no repo · [P1]

- **Arquivo:** `kanbanex.db` (na raiz, trackeado)
- **Evidência:** `git ls-files | grep '\\.db$'` lista o arquivo; `.gitignore` (9 linhas) não o cobre.
  `src/db.js:4` usa `KANBANEX_DB || 'kanbanex.db'` — o default aponta para o commitado.
- **Impacto:** dados de usuário versionados (e-mails, quadros, cartões); cada `pull` pode trazer ou
  sobrescrever banco com dado real; histórico inchado com binário mutante.
- **Mudança:** `git rm --cached kanbanex.db`; `*.db` no `.gitignore`; testes com banco próprio
  (conferir que `KANBANEX_DB=:memory:` ou tmp é usado nos testes).
- **Aceite:** nenhum `.db` no índice; testes verdes.
- **Verificação:**
  ```bash
  git ls-files | grep -c '\\.db$'   # 0
  npm test 2>&1 | tail -2
  ```

### DEVOPS-02 · Sem `.env.example` · [P2]

- **Arquivo:** *(ausente)* `.env.example`
- **Evidência:** `server.js:14` lê `PORT`; `db.js:4` lê `KANBANEX_DB`; `auth.js:7` lê `JWT_SECRET`.
  Nenhum exemplo versionado.
- **Impacto:** após o `SEC-04`, quem clona não sobe sem ler código.
- **Mudança:**
  ```
  PORT=3210
  KANBANEX_DB=kanbanex.db
  JWT_SECRET=   # obrigatorio, min 32 bytes: openssl rand -hex 32
  ```
- **Aceite:** `.env.example` versionado cobre as 3 variáveis.
- **Verificação:** `diff` entre `process.env.*` do código e as chaves do exemplo.

---

## 7. Documentação

### DOC-01 · README não documenta M2/M3 como não-expostos · [P2]

- **Arquivo:** `README.md` (74 linhas)
- **Evidência:** o README descreve M1/M2/M3 como recursos, mas `BUG-01`/`BUG-02` mostram que M2 e M3
  **não rodam** — sem rota, sem relay ligado.
- **Impacto:** usuário (e outra IA) lê "convites por link + auditoria" e tenta usar endpoint que
  não existe; ou lê o ADR e assume CRDT ativo.
- **Mudança:** marcar M2/M3 como "implementado, em integração" com o estado real + link para os
  itens `BUG-01`/`BUG-02`; atualizar quando ligados.
- **Aceite:** README reflete o que responde HTTP hoje, não o que os testes cobrem.
- **Verificação:** `grep -ni 'em integracao\|nao exposto' README.md`.

### DOC-02 · ADR-001 desatualizado (Yjs não está no relay) · [P3]

- **Arquivo:** `ADR-001.md:1-3` ("Status: Aceito")
- **Evidência:** o ADR declara a decisão como aceita e implementada, mas o `BUG-01` prova que não
  está ligada. "Aceito" sem "em produção" é meia-verdade arquitetural.
- **Impacto:** decisão futura assume CRDT ativo e projeta em cima de premissa falsa.
- **Mudança:** atualizar status para "Aceito, integração pendente (`BUG-01`)" com link para este
  plano; ou reverter para "Proposto" se a integração for incerta.
- **Aceite:** ADR reflete o estado real com referência ao item.
- **Verificação:** `grep -n 'BUG-01\|pendente' ADR-001.md`.

---

## 8. Ordem de execução (waves)

### Wave 1 — Travar acesso (P0)
1. **`SEC-04`** — exigir `JWT_SECRET` (sem isso, todo token é forjável).
2. **`SEC-02`** — dono em `obterQuadro`.
3. **`SEC-03`** — dono em `criarCartao`.
4. **`SEC-01`** — token no handshake `ws` + `join` validado (exige 2 e 3 prontos para checar dono).

> Depois da Wave 1, REST e relay exigem dono.

### Wave 2 — Fechar a borda (P1)
5. **`SEC-05`** — `maxPayload` + teto de conexões.
6. **`SEC-06`** — autor = `socket.userId` (exige `SEC-01`).
7. **`BUG-04`** — `join` valida existência (junto com `SEC-01`).
8. **`SEC-07`** — rate limit no login/register.
9. **`BUG-03`** — `randomUUID` nos IDs de cartão (REST + relay juntos).
10. **`TEST-01`** — os 5 casos de autorização.

### Wave 3 — Ligar o que está solto (P1/P2)
11. **`BUG-02`** — rotas de convite/auditoria + `auditar()` no relay.
12. **`BUG-01`** — Yjs no relay + `TEST-02` junto (ou arquivar o ADR).
13. **`BUG-06`** — token de convite com 128 bits.
14. **`IMP-01`** — `max_usos` no convite.
15. **`BUG-05`** — expiração de sala vazia.
16. **`DEVOPS-01`** — tirar o `.db` do índice.
17. **`DEVOPS-02`** — `.env.example`.
18. **`DOC-01`** — README com estado real.

### Wave 4 — Registro (P3)
19. **`DOC-02`** — ADR com status real.

**Dependências que não podem ser invertidas:**
`SEC-04` antes de tudo que usa token · `SEC-02`/`SEC-03` antes de `SEC-01` (o `join` precisa saber
checar dono) · `SEC-01` antes de `SEC-06`/`BUG-04` (autor e validação exigem identidade) ·
`BUG-01` junto com `TEST-02` · `BUG-02` antes de `IMP-01` (limite precisa da rota).

---

## 9. Fora de escopo / riscos

| Item | Decisão | Motivo |
|---|---|---|
| Trocar `ws` por Socket.IO | **Não** | O `ws` puro é o padrão validado; o defeito é auth, não protocolo. |
| Trocar SQLite por Postgres | **Não** | Volume não justifica; transação local resolve. |
| Ligar Yjs sem teste de convergência | **Não** | Ver `TEST-02`: ligar sem prova troca um risco por outro. |
| Multi-dono por quadro (compartilhamento) | **Não, ainda** | Modelo atual é dono único; compartilhar exige tabela de membros — feature nova, não correção. |
| Expor auditoria publicamente | **Não** | Histórico é do dono; rota exige dono (`BUG-02`). |

**Riscos desta execução:**

- **`SEC-01` quebra cliente existente.** O front `public/app.js` precisará enviar token no `join` —
  mudar servidor e cliente juntos, ou versionar o protocolo do relay.
- **`SEC-04` invalida tokens.** Trocar o segredo desloga todos — comunicar.
- **`BUG-01` (ligar Yjs) muda semântica de movimento.** SQL puro vs CRDT podem divergir em
  concorrência — o `TEST-02` existe para provar, não pular.
- **`BUG-02` (rotas novas) amplia superfície.** Cada rota nova exige os mesmos `SEC-02`/`SEC-03` —
  não criar rota sem checagem de dono.

---

## 10. Definição de pronto (DoD)

**Segurança**
- [ ] `SEC-01` — `join`/move/create sem token são recusados
- [ ] `SEC-02` — quadro alheio → `404`
- [ ] `SEC-03` — cartão em quadro alheio → `404`
- [ ] `SEC-04` — sem `JWT_SECRET` (≥32 bytes) o processo não inicia
- [ ] `SEC-05` — payload > 1 MB fecha com 1009; conexões com teto
- [ ] `SEC-06` — autor do broadcast é o `sub` do token
- [ ] `SEC-07` — 6º login no e-mail em 5 min → `429`

**Funcional**
- [ ] `BUG-01` — Yjs ligado ao relay (ou ADR arquivado com motivo)
- [ ] `BUG-02` — convite/auditoria acessíveis por rota; relay audita
- [ ] `BUG-03` — nenhum `Math.random` em ID
- [ ] `BUG-04` — `join` em quadro inexistente recusado
- [ ] `BUG-05` — sala vazia some do `Map`
- [ ] `BUG-06` — token de convite com 128 bits
- [ ] `IMP-01` — `max_usos` respeitado

**Testes e infra**
- [ ] `TEST-01` — 21/21 (16 + 5 de autorização)
- [ ] `TEST-02` — convergência pelo relay provada
- [ ] `DEVOPS-01` — nenhum `.db` no índice
- [ ] `DEVOPS-02` — `.env.example` com as 3 variáveis
- [ ] `DOC-01` — README com estado real de M2/M3
- [ ] `DOC-02` — ADR com status real

**Validação final:**
```bash
npm test 2>&1 | tail -2   # 21/21
grep -rn 'Math.random' src/ server.js && echo FALHA || echo OK
git ls-files | grep -c '\\.db$'   # 0
```

---

*Fim do plano. Gerado por leitura direta do código em 2026-10-02. Nenhum item já estava corrigido*
*— todos apontam para defeitos ainda presentes.*
