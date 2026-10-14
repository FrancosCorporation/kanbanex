# Plan — kanbanex

## 1. Visão geral

- **Nome:** kanbanex — Kanban colaborativo em tempo real
- **Descrição:** quadro Kanban multiusuário com REST (Express), relay WebSocket próprio (`ws`), persistência em `node:sqlite` (built-in), JWT (segredo obrigatório ≥32 bytes), BCrypt e sincronização colaborativa com `yjs`. 886 LOC, 3 suítes de teste (16/16 no marco M3).
- **Problema que resolve:** colaboração em tempo real self-hosted com dependências mínimas e sem banco externo.
- **Estado atual:** API e relay já endurecidos (SEC-01..06 implementados no commit `c507d72`); CI completa (testes + build Docker + Trivy + licenças). Repositório é uma das peças mais maduras do portfólio.

## 2. Arquitetura e tecnologias

- Node ≥ 22.5 (`node:sqlite`), ESM (`"type": "module"`).
- Dependências: express 4, ws 8, yjs 13, jsonwebtoken 9, bcryptjs 2.
- WebSocket sobre o mesmo HTTP (padrão validado em `chat_criptografado`), transações `BEGIN/COMMIT/ROLLBACK` corretas no `moverCartao` (não alterar — §0 do MELHORIAS).
- Docker (multi-stage) + Trivy + license-checker na CI.

## 3. Funcionalidades existentes

- [x] REST de quadros/cartões com dono obrigatório (SEC-02/03/04) — implementado.
- [x] Handshake WS autenticado por token e autor = `socket.userId` (SEC-01/06) — implementado.
- [x] Limites de payload/conexões (SEC-05) — implementado.
- [x] Convites por link + auditoria (M3) com testes — 16/16 no marco (última execução registrada no histórico; nesta sessão testes não rodaram localmente, apenas na CI).
- [x] CI com testes, Docker, Trivy e licenças — existe; **modernizada nesta sessão** (runner fixo + actions v7 + Node 22/24 + audit gate).

## 4. Objetivos futuros

- **OBJ-01 (P2, concluído nesta sessão):** CI previsível — `ubuntu-24.04` fixo (evita migração para Ubuntu 26 em 2026-10-19), Actions v7 pinadas por SHA, matriz Node 22/24, `npm audit --audit-level=high` como gate.
- **OBJ-02 (P3, recomendação):** atualizar `bcryptjs` 2→3 (alinha com os demais repos do workspace; exige validação da suíte).
- **OBJ-03 (P3, recomendação):** documentar protocolo WS (payloads de presença/ação) em `docs/` para integradores.
- **OBJ-04 (P3, ideia):** exportar quadro para JSON/Markdown (portabilidade dos dados do `node:sqlite`).

## 5. Melhorias técnicas

- **Infraestrutura:** ✅ CI endurecida. 
- **Dependências:** npm audit 0 (alto+crítico) — manter gate; avaliar bcryptjs 3 (OBJ-02).
- **Qualidade:** suíte existente é o ativo mais valioso do repo — não deixar a CI verde sem ela.

## 6. Roadmap

- **Fase 1–3:** concluídas (segurança + CI).
- **Fase 4:** OBJ-02, OBJ-03.
- **Fase 5:** OBJ-04 e/ou publicação de release com imagem Docker assinada.

## 7. Backlog priorizado

1. OBJ-02 — bcryptjs 3 (P3, baixa).
2. OBJ-03 — documentação do protocolo WS (P3, baixa).
3. OBJ-04 — exportação de quadros (P3, média).

## 8. Riscos e pendências

- `license-checker` e Trivy rodam com fallback de warning — convém revisar periodicamente se warnings acumularam.
- bcryptjs 2 → 3 pode mudar custo/rounding padrão: testar antes (OBJ-02).

## 9. Ideias adicionais

- Hugo/JaCoCo-style badge de cobertura seria útil quando houver relatório de cobertura do `node --test`.

---
*(Gerado em 2026-10-14 pelo agente orquestrador)*
