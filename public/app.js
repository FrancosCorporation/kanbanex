// Kanbanex M1 — front: DnD nativo + sync em tempo real via WebSocket.
const $ = (s) => document.querySelector(s);

let TOKEN = localStorage.getItem('kanbanex_token') || null;
let USUARIO = localStorage.getItem('kanbanex_usuario_id') || null;
let NOME_USUARIO = localStorage.getItem('kanbanex_usuario') || '';
let quadroAtivo = null;
let ws = null;
let wsAutenticado = false;
let modoConta = 'login';

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
$('#btn-alternar').addEventListener('click', () => {
  modoConta = modoConta === 'login' ? 'register' : 'login';
  const cadastro = modoConta === 'register';
  $('#inp-nome').hidden = !cadastro;
  $('#label-nome').hidden = !cadastro;
  $('#inp-senha').autocomplete = cadastro ? 'new-password' : 'current-password';
  $('#btn-entrar').textContent = cadastro ? 'Criar conta' : 'Entrar';
  $('#btn-alternar').textContent = cadastro ? 'Já tenho uma conta' : 'Criar uma conta';
  $('#login-erro').hidden = true;
});

$('#btn-entrar').addEventListener('click', async () => {
  const nome = $('#inp-nome').value.trim();
  const email = $('#inp-email').value.trim();
  const senha = $('#inp-senha').value;
  const botao = $('#btn-entrar');
  botao.disabled = true;
  try {
    if (modoConta === 'register') await api('/register', { method: 'POST', body: { nome, email, senha } });
    const dados = await api('/login', { method: 'POST', body: { email, senha } });
    TOKEN = dados.token;
    USUARIO = dados.usuario.id;
    NOME_USUARIO = dados.usuario.nome;
    localStorage.setItem('kanbanex_token', TOKEN);
    localStorage.setItem('kanbanex_usuario_id', USUARIO);
    localStorage.setItem('kanbanex_usuario', NOME_USUARIO);
    abrirApp();
  } catch (e) {
    const el = $('#login-erro');
    el.hidden = false;
    el.textContent = e.status === 409 ? 'Este e-mail já tem uma conta. Entre com sua senha.' : e.message;
  } finally {
    botao.disabled = false;
  }
});

$('#btn-sair').addEventListener('click', () => {
  localStorage.removeItem('kanbanex_token');
  localStorage.removeItem('kanbanex_usuario_id');
  localStorage.removeItem('kanbanex_usuario');
  location.reload();
});

// ---------- app ----------
function abrirApp() {
  $('#tela-login').hidden = true;
  $('#app').hidden = false;
  carregarQuadros();
}

async function carregarQuadros(preferido = null) {
  try {
    let quadros = await api('/boards');
    if (quadros.length === 0) {
      quadros = [await api('/boards', { method: 'POST', body: { nome: 'Meu quadro' } })];
    }
    $('#barra-quadros').replaceChildren();
    for (const q of quadros) {
      const b = document.createElement('button');
      b.className = 'q-tab';
      b.textContent = q.nome;
      b.dataset.id = q.id;
      b.onclick = () => selecionarQuadro(q.id);
      $('#barra-quadros').appendChild(b);
    }
    selecionarQuadro(quadros.find((q) => q.id === preferido)?.id || quadros[0].id);
  } catch (e) {
    if (e.status === 401) {
      localStorage.removeItem('kanbanex_token');
      localStorage.removeItem('kanbanex_usuario_id');
      localStorage.removeItem('kanbanex_usuario');
      location.reload();
    } else alert('Não foi possível carregar os quadros. ' + e.message);
  }
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
  if (ws) { ws.boardId = null; wsAutenticado = false; ws.close(); }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen = () => { wsRetry = 0; wsAutenticado = false; setStatus(false); ws.send(JSON.stringify({ type: 'join', boardId, token: TOKEN })); };
  ws.onclose = () => { wsAutenticado = false; setStatus(false); if (quadroAtivo === boardId && wsRetry++ < 5) setTimeout(() => conectarWs(boardId), 1500); };
  ws.onerror = () => setStatus(false);
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'joined') { wsAutenticado = true; setStatus(true); $('#online').textContent = `👤 ${msg.online}`; }
    if (msg.type === 'error') setStatus(false);
    if (msg.type === 'presence') $('#online').textContent = `👤 ${msg.online}`;
    if (msg.type === 'card-move') moverNoDom(msg.cardId, msg.coluna, msg.posicao, msg.nome || msg.por, msg.por);
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

function moverNoDom(cardId, coluna, posicao, por, porId = por) {
  const el = document.querySelector(`.cartao[data-id="${cardId}"]`);
  if (!el) return location.reload(); // cartão novo p/ este quadro: recarrega
  const destino = $(`.cartoes[data-coluna="${coluna}"]`);
  const referencia = destino.children[posicao];
  destino.insertBefore(el, referencia || null);
  el.classList.add('recente');
  setTimeout(() => el.classList.remove('recente'), 2500);
  if (por && porId !== USUARIO) flashUsuario(el, por);
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
    if (!wsAutenticado || !ws || ws.readyState !== WebSocket.OPEN) {
      api(`/boards/${quadroAtivo}`).then(({ cartoes }) => renderizar(cartoes)).catch(() => {});
      return;
    }
    ws.send(JSON.stringify({ type: 'card-move', cardId, coluna, posicao: pos }));
  });
});

// ---------- novo cartão ----------
document.querySelectorAll('.add').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const titulo = prompt('Título do cartão:');
    if (!titulo) return;
    if (!wsAutenticado || !ws || ws.readyState !== WebSocket.OPEN) return alert('Aguarde a conexão segura com o quadro.');
    const coluna = btn.dataset.coluna;
    ws.send(JSON.stringify({ type: 'card-create', titulo, coluna }));
  });
});

$('#btn-novo-quadro').addEventListener('click', async () => {
  const nome = prompt('Nome do quadro:');
  if (!nome) return;
  const q = await api('/boards', { method: 'POST', body: { nome } });
  await carregarQuadros(q.id);
});

// ---------- boot ----------
if (TOKEN) api('/boards').then(abrirApp).catch((e) => {
  if (e.status === 401) {
    localStorage.removeItem('kanbanex_token');
    localStorage.removeItem('kanbanex_usuario_id');
    localStorage.removeItem('kanbanex_usuario');
    location.reload();
  } else {
    const erro = $('#login-erro');
    erro.hidden = false;
    erro.textContent = 'Não foi possível conectar ao servidor. Tente novamente.';
  }
});
