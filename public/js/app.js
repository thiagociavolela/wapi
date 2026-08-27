import { api } from './api.js';

const $ = (selector) => document.querySelector(selector);
const state = { user: null, conversations: [], active: null, status: '', searchTimer: null };

function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function displayName(item) { return item.name || item.profileName || item.phone || 'Contato'; }
function time(value) { return value ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Encerrada'; }
function windowOpen(item) { return item?.serviceWindowExpiresAt && new Date(item.serviceWindowExpiresAt) > new Date(); }

async function init() {
  state.user = (await api('/api/auth/me')).user;
  await loadConversations(); connectEvents();
}

async function loadConversations(preserve = true) {
  const data = await api(`/api/conversations?search=${encodeURIComponent($('#search').value)}`);
  $('#total-count').textContent = data.items.length;
  $('#unread-count').textContent = data.items.reduce((total, item) => total + Number(item.unreadCount || 0), 0);
  state.conversations = data.items.filter(item => !state.status || item.status === state.status);
  renderConversations();
  if (preserve && state.active) state.active = state.conversations.find(item => item.id === state.active.id) || state.active;
}

function renderConversations() {
  $('#conversation-list').innerHTML = state.conversations.length ? state.conversations.map(item => `
    <button class="conversation ${state.active?.id === item.id ? 'active' : ''}" data-id="${item.id}">
      <span class="avatar">${escapeHtml(initials(displayName(item)))}</span><span class="conversation-copy">
        <span class="conversation-top"><strong>${escapeHtml(displayName(item))}</strong><time>${time(item.lastMessageAt)}</time></span>
        <span class="conversation-bottom"><span><i class="status-dot ${escapeHtml(item.status)}"></i>${escapeHtml(item.lastMessagePreview || 'Nova conversa')}</span>${item.unreadCount ? `<b>${item.unreadCount}</b>` : ''}</span>
      </span>
    </button>`).join('') : '<div class="empty">Nenhuma conversa encontrada.</div>';
}

async function openConversation(id) {
  state.active = state.conversations.find(item => item.id === id);
  if (!state.active) return;
  $('.app-shell').classList.add('chat-open');
  renderConversations(); $('#no-chat').classList.add('hidden'); $('#chat').classList.remove('hidden'); $('#details').classList.remove('hidden');
  const name = displayName(state.active);
  $('#chat-name').textContent = $('#detail-name').textContent = name;
  $('#chat-phone').textContent = $('#detail-phone').textContent = state.active.phone;
  $('#chat-avatar').textContent = $('#detail-avatar').textContent = initials(name);
  $('#detail-agent').textContent = state.active.assignedUserName || 'Não atribuído';
  $('#assign').textContent = state.active.assignedUserName ? 'Reatribuir' : 'Assumir conversa';
  $('#status').value = state.active.status;
  updateWindow(); await Promise.all([loadMessages(), api(`/api/conversations/${id}/read`, { method: 'POST' })]);
}

function updateWindow() {
  const open = windowOpen(state.active); const label = open ? `Janela aberta até ${dateTime(state.active.serviceWindowExpiresAt)}` : 'Janela encerrada · use um template';
  $('#window-badge').textContent = open ? 'Janela aberta' : 'Janela encerrada'; $('#window-badge').className = `badge ${open ? 'success' : 'warning'}`;
  $('#detail-window').textContent = label; $('#message').disabled = !open; $('.send-button').disabled = !open;
  $('#composer-alert').classList.toggle('hidden', open); $('#composer-alert').textContent = open ? '' : 'A resposta livre não está disponível. Selecione um template aprovado pela Meta.';
}

async function loadMessages() {
  const data = await api(`/api/conversations/${state.active.id}/messages`);
  $('#message-list').innerHTML = data.items.length ? data.items.map(item => `
    <div class="message-row ${item.direction}"><article class="bubble">
      ${item.senderName ? `<small>${escapeHtml(item.senderName)}</small>` : ''}<p>${escapeHtml(item.textBody || `[${item.type}]`)}</p>
      <footer><time>${time(item.createdAt)}</time>${item.direction === 'outbound' ? `<span class="message-status ${item.status}">${statusIcon(item.status)}</span>` : ''}</footer>
    </article></div>`).join('') : '<div class="empty">Ainda não há mensagens.</div>';
  $('#message-list').scrollTop = $('#message-list').scrollHeight;
}

function statusIcon(status) { return status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : status === 'failed' ? '!' : '✓'; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3500); }

$('#conversation-list').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) openConversation(button.dataset.id); });
$('#search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadConversations(false), 300); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach(x => x.classList.remove('active')); button.classList.add('active'); state.status = button.dataset.status; loadConversations(false); }));
$('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('#message').value.trim(); if (!text || !state.active) return;
  $('.send-button').disabled = true;
  try { await api(`/api/conversations/${state.active.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }); $('#message').value = ''; await Promise.all([loadMessages(), loadConversations()]); }
  catch (error) { toast(error.message); } finally { $('.send-button').disabled = !windowOpen(state.active); }
});
$('#assign').addEventListener('click', async () => { if (!state.active) return; await api(`/api/conversations/${state.active.id}/assign`, { method: 'POST', body: JSON.stringify({ userId: state.user.id }) }); await loadConversations(); await openConversation(state.active.id); });
$('#detail-assign-shortcut').addEventListener('click', () => $('#assign').click());
$('#status').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); await loadConversations(); });
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
$('#message').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`; });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); } });
$('#mobile-back').addEventListener('click', () => $('.app-shell').classList.remove('chat-open'));

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onmessage = async event => { const data = JSON.parse(event.data); if (data.type === 'ready') return; await loadConversations(); if (state.active && (!data.conversationId || data.conversationId === state.active.id)) await loadMessages(); };
}

init().catch(error => toast(error.message));
