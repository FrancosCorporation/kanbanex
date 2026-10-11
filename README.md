# Kanbanex

Quadros Kanban com cartões, arrastar e soltar, presença e atualizações em tempo real. O servidor
usa Express, WebSocket (`ws`) e SQLite. Cada quadro pertence a um dono; as rotas REST e o relay
conferem essa identidade antes de mostrar ou alterar cartões.

## Requisitos

- Node.js 22.5 ou superior (usa `node:sqlite`).
- `JWT_SECRET` com pelo menos 32 bytes.
- Docker e Docker Compose, se preferir contêiner.

## Executar localmente

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
npm ci
npm start
```

Abra <http://localhost:3210>. O SQLite local usa `kanbanex.db`, ignorado pelo Git. Para trocar a
porta ou o caminho do banco, defina `PORT` ou `KANBANEX_DB`. Não use `NODE_ENV=test` em produção:
nesse modo existe um segredo fixo exclusivo para testes.

### Docker Compose

Copie `.env.example` para `.env`, defina `JWT_SECRET` com um valor gerado por
`openssl rand -hex 32` e execute:

```bash
docker compose up --build
```

A porta fica publicada apenas em `127.0.0.1`; os dados ficam em volume. Para acesso público,
coloque o serviço atrás de um proxy reverso com HTTPS. O limite de conexões WebSocket usa o IP do
socket; o Express não confia em `X-Forwarded-For` por padrão. Configure proxies confiáveis somente
de acordo com a topologia real.

## API REST

Registre uma conta em `POST /api/register` e entre por `POST /api/login`. As rotas privadas exigem
`Authorization: Bearer <token>`.

| Rota | Acesso | Descrição |
|---|---|---|
| `POST /api/register` | Público, limitado | Criar conta |
| `POST /api/login` | Público, limitado | Receber token JWT |
| `GET /api/boards` | Dono | Listar os próprios quadros |
| `POST /api/boards` | Dono | Criar quadro |
| `GET /api/boards/:id` | Dono | Ler quadro e cartões |
| `POST /api/boards/:id/cards` | Dono | Criar cartão pelo REST |
| `GET /api/boards/:id/historico` | Dono | Consultar até 100 ações recentes |

Uma conta não lê nem altera quadros de outro dono. A resposta para quadro ausente ou alheio é
`404`, para não revelar se o identificador existe.

Exemplo de login e leitura:

```bash
TOKEN=$(curl -s http://localhost:3210/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dono@exemplo.com","senha":"senha-forte"}' | jq -r .token)
curl http://localhost:3210/api/boards -H "Authorization: Bearer $TOKEN"
```

## Relay WebSocket

Conecte ao mesmo host (`ws://localhost:3210/ws`, ou `wss://` atrás de HTTPS). O primeiro evento
precisa ser um `join` com quadro próprio e token JWT:

```json
{"type":"join","boardId":"<id-do-quadro>","token":"<jwt>"}
```

O token não vai na URL. O servidor só aceita `card-move` e `card-create` depois do `joined`; o
autor vem do `sub` do JWT, e o valor `por` enviado pelo cliente é ignorado. O relay limita cada
mensagem a 1 MiB, o total a 100 conexões e cada IP a 10 conexões. Uma conexão sem autenticação é
fechada após 10 segundos e uma conexão inativa após 5 minutos. Salas vazias são removidas.

Login e cadastro aceitam 20 tentativas por IP e 5 por e-mail a cada cinco minutos. Ao exceder o
limite, a API responde `429` com `Retry-After`. Os contadores ficam em memória, por processo, e
reiniciam junto com o servidor.

## Estado de M2 e M3

- **Yjs (M2):** o módulo e os exemplos de convergência existem, mas o relay de produção continua
  usando SQLite. A integração CRDT está pendente até haver validação pelo WebSocket real; veja
  [ADR-001](ADR-001.md) e `BUG-01` em `MELHORIAS.md`.
- **Auditoria (parte de M3):** criação e movimento de cartões são gravados no SQLite e o dono pode
  consultar o histórico pela rota acima.
- **Convites (parte de M3):** o módulo de convites ainda não tem rota HTTP nem concede acesso a
  outro usuário. Compartilhamento entre contas exige um modelo de membros e permissões, que não
  faz parte do modelo atual de dono único. Não trate a existência dos testes do módulo como uma
  função disponível no painel.

O segredo JWT é obrigatório; sua rotação invalida os tokens existentes. O banco, arquivos `.env` e
segredos ficam fora do Git e do contexto de build Docker. Para reportar vulnerabilidades, consulte
[SECURITY.md](SECURITY.md).
