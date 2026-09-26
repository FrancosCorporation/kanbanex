// Kanbanex M1 — front: DnD nativo + sync em tempo real via WebSocket.
const $ = (s) => document.querySelector(s);

let TOKEN = localStorage.getItem('kanbanex_token') || null;
let USUARIO = localStorage.getItem('kanbanex_usuario') || '';
let quadroAtivo = null;
let ws = null;

// ---------- API ----------
async function api(caminho, opts = {}) {
  const r = await fetch('/api' + caminho, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(dados.erro?.mensagem || r.statusText), { status: r.status });
  return dados;
}

// ---------- login ----------
$('#btn-entrar').addEventListener('click', async () => {
  const nome = $('#inp-nome').value.trim();
  const email = $('#inp-email').value.trim();
  const senha = $('#inp-senha').value;
  try {
    let dados;
    try {
      dados = await api('/login', { method: 'POST', body: { email, senha } });
    } catch (e) {
      if (e.status === 401 && nome && senha.length >= 6) {
        await api('/register', { method: 'POST', body: { nome, email, senha } });
        dados = await api('/login', { method: 'POST', body: { email, senha } });
      } else throw e;
    }
    TOKEN = dados.token;
    USUARIO = dados.usuario.nome;
    localStorage.setItem('kanbanex_token', TOKEN);
    localStorage.setItem('kanbanex_usuario', USUARIO);
    abrirApp();
  } catch (e) {
    const el = $('#login-erro');
    el.hidden = false;
    el.textContent = e.message;
  }
});

$('#btn-sair').addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

// ---------- app ----------
function abrirApp() {
  $('#tela-login').hidden = true;
  $('#app').hidden = false;
  carregarQuadros();
}

async function carregarQuadros() {
  let quadros = await api('/boards');
  if (quadros.length === 0) {
    quadros = [await api('/boards', { method: 'POST', body: { nome: 'Meu quadro' } })];
  }
  $('#barra-quadros').innerHTML = '';
  for (const q of quadros) {
    const b = document.createElement('button');
    b.className = 'q-tab';
    b.textContent = q.nome;
    b.dataset.id = q.id;
    b.onclick = () => selecionarQuadro(q.id);
    $('#barra-quadros').appendChild(b);
  }
  selecionarQuadro(quadros[0].id);
}

function selecionarQuadro(id) {
  quadroAtivo = id;
  document.querySelectorAll('.q-tab').forEach((t) => t.classList.toggle('ativo', t.dataset.id === id));
  conectarWs(id);
  api(`/boards/${id}`).then(({ cartoes }) => renderizar(cartoes));
}

// ---------- websocket (tempo real) ----------
let wsRetry = 0;
function conectarWs(boardId) {
  if (ws) { ws.boardId = null; ws.close(); }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => { wsRetry = 0; setStatus(true); ws.send(JSON.stringify({ type: 'join', boardId })); };
  ws.onclose = () => { setStatus(false); if (quadroAtivo === boardId && wsRetry++ < 5) setTimeout(() => conectarWs(boardId), 1500); };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'presence') $('#online').textContent = `👤 ${msg.online}`;
    if (msg.type === 'card-move') moverNoDom(msg.cardId, msg.coluna, msg.posicao, msg.por);
    if (msg.type === 'card-create') adicionarNoDom(msg.cartao, true);
  };
}
const setStatus = (on) => { $('#status').textContent = on ? '● ao vivo' : 'reconectando…'; $('#status').className = `status ${on ? 'on' : ''}`; };

// ---------- render ----------
function renderizar(cartoes) {
  document.querySelectorAll('.cartoes').forEach((c) => (c.innerHTML = ''));
  for (const c of cartoes) adicionarNoDom(c, false);
}

function adicionarNoDom(cartao, destacado) {
  const div = document.createElement('div');
  div.className = 'cartao entrando' + (destacado ? ' recente' : '');
  div.draggable = true;
  div.dataset.id = cartao.id;
  div.textContent = cartao.titulo;
  ligarDrag(div);
  $(`.cartoes[data-coluna="${cartao.coluna}"]`).appendChild(div);
  if (destacado) setTimeout(() => div.classList.remove('recente'), 2500);
}

function moverNoDom(cardId, coluna, posicao, por) {
  const el = document.querySelector(`.cartao[data-id="${cardId}"]`);
  if (!el) return location.reload(); // cartão novo p/ este quadro: recarrega
  const destino = $(`.cartoes[data-coluna="${coluna}"]`);
  const referencia = destino.children[posicao];
  destino.insertBefore(el, referencia || null);
  el.classList.add('recente');
  setTimeout(() => el.classList.remove('recente'), 2500);
  if (por && por !== USUARIO) flashUsuario(el, por);
}

function flashUsuario(el, por) {
  const tag = document.createElement('small');
  tag.className = 'por';
  tag.textContent = ` (por ${por})`;
  el.appendChild(tag);
  setTimeout(() => tag.remove(), 2500);
}

// ---------- drag & drop nativo ----------
function ligarDrag(el) {
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', el.dataset.id);
    el.classList.add('arrastando');
  });
  el.addEventListener('dragend', () => el.classList.remove('arrastando'));
}
document.querySelectorAll('.cartoes').forEach((zona) => {
  zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.closest('.coluna').classList.add('alvo'); });
  zona.addEventListener('dragleave', () => zona.closest('.coluna').classList.remove('alvo'));
  zona.addEventListener('drop', (e) => {
    e.preventDefault();
    zona.closest('.coluna').classList.remove('alvo');
    const cardId = e.dataTransfer.getData('text/plain');
    const coluna = zona.dataset.coluna;
    const posicao = [...zona.children].filter((c) => c.dataset.id !== cardId).findIndex((c) => {
      const rect = c.getBoundingClientRect();
      return e.clientY < rect.top + rect.height / 2;
    });
    const pos = posicao === -1 ? [...zona.children].filter((c) => c.dataset.id !== cardId).length : posicao;
    // otimista
    const el = document.querySelector(`.cartao[data-id="${cardId}"]`);
    const referencia = zona.children[pos];
    zona.insertBefore(el, referencia || null);
    // broadcast
    ws.send(JSON.stringify({ type: 'card-move', cardId, coluna, posicao: pos, por: USUARIO }));
  });
});

// ---------- novo cartão ----------
document.querySelectorAll('.add').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const titulo = prompt('Título do cartão:');
    if (!titulo) return;
    const coluna = btn.dataset.coluna;
    const cartao = await api(`/boards/${quadroAtivo}/cards`, { method: 'POST', body: { titulo, coluna } });
    adicionarNoDom(cartao, true);
    ws.send(JSON.stringify({ type: 'card-create', titulo, coluna }));
  });
});

$('#btn-novo-quadro').addEventListener('click', async () => {
  const nome = prompt('Nome do quadro:');
  if (!nome) return;
  const q = await api('/boards', { method: 'POST', body: { nome } });
  carregarQuadros();
  selecionarQuadro(q.id);
});

// ---------- boot ----------
if (TOKEN) {
  api('/boards').then(abrirApp).catch(() => { localStorage.clear(); location.reload(); });
}
