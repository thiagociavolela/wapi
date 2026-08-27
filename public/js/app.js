import { api } from './api.js';

const $ = (selector) => document.querySelector(selector);
const state = { user: null, users: [], teams: [], quickReplies: [], templates: [], tags: [], conversations: [], messages: [], pendingMessages: [], active: null, status: '', searchTimer: null };

function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function displayName(item) { return item.name || item.profileName || item.phone || 'Contato'; }
function time(value) { return value ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Encerrada'; }
function dayKey(value) { const date = new Date(value); return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function dayLabel(value) {
  const date = new Date(value); const today = new Date(); const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Hoje';
  if (dayKey(date) === dayKey(yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date);
}
function windowOpen(item) { return item?.serviceWindowExpiresAt && new Date(item.serviceWindowExpiresAt) > new Date(); }
function messageContent(item) {
  const url = `/api/messages/${encodeURIComponent(item.id)}/media`;
  const content = typeof item.content === 'string' ? JSON.parse(item.content || '{}') : (item.content || {});
  if (item.type === 'image' || item.type === 'sticker') return `<a href="${url}" target="_blank" class="media-preview"><img src="${url}" alt="${escapeHtml(item.textBody || 'Imagem')}"></a>${item.textBody ? `<p>${escapeHtml(item.textBody)}</p>` : ''}`;
  if (item.type === 'video') return `<video class="media-preview" src="${url}" controls preload="metadata"></video>${item.textBody ? `<p>${escapeHtml(item.textBody)}</p>` : ''}`;
  if (item.type === 'audio') return `<audio class="audio-preview" src="${url}" controls preload="metadata"></audio>`;
  if (item.type === 'document') return `<a class="document-preview" href="${url}" target="_blank"><span>↓</span><div><strong>Baixar documento</strong><small>${escapeHtml(item.textBody || 'Arquivo recebido')}</small></div></a>`;
  if (item.type === 'location' && content.location) { const { latitude, longitude, name, address } = content.location; return `<a class="document-preview" href="https://maps.google.com/?q=${encodeURIComponent(`${latitude},${longitude}`)}" target="_blank" rel="noopener"><span>⌖</span><div><strong>${escapeHtml(name || 'Localização')}</strong><small>${escapeHtml(address || `${latitude}, ${longitude}`)}</small></div></a>`; }
  if (item.type === 'contacts' && Array.isArray(content.contacts)) return content.contacts.map(contact => `<div class="document-preview"><span>◉</span><div><strong>${escapeHtml(contact.name?.formatted_name || 'Contato')}</strong><small>Contato compartilhado</small></div></div>`).join('');
  return `<p>${escapeHtml(item.textBody || `[${item.type}]`)}</p>`;
}

async function init() {
  state.user = (await api('/api/auth/me')).user;
  const [users, teams, quickReplies] = await Promise.all([api('/api/users'), api('/api/management/teams'), api('/api/quick-replies')]);
  state.users = users.items; state.teams = teams.items; state.quickReplies = quickReplies.items;
  renderAgentOptions(); renderTeamOptions(); renderQuickReplies(); await loadConversations();
  const requestedConversation = new URLSearchParams(location.search).get('conversation');
  if (requestedConversation && state.conversations.some(item => item.id === requestedConversation)) await openConversation(requestedConversation);
  connectEvents();
}

async function loadConversations(preserve = true) {
  const data = await api(`/api/conversations?search=${encodeURIComponent($('#search').value)}&status=${encodeURIComponent(state.status)}`);
  $('#total-count').textContent = data.items.length;
  $('#unread-count').textContent = data.items.reduce((total, item) => total + Number(item.unreadCount || 0), 0);
  state.conversations = data.items;
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
  $('#team-select').value = state.active.teamId || ''; $('#priority-select').value = state.active.priority || 'normal';
  updateWindow(); await Promise.all([loadMessages(), loadNotes(), loadTags(), api(`/api/conversations/${id}/read`, { method: 'POST' })]);
}

function updateWindow() {
  const open = windowOpen(state.active); const label = open ? `Janela aberta até ${dateTime(state.active.serviceWindowExpiresAt)}` : 'Janela encerrada · use um template';
  $('#window-badge').textContent = open ? 'Janela aberta' : 'Janela encerrada'; $('#window-badge').className = `badge ${open ? 'success' : 'warning'}`;
  $('#detail-window').textContent = label; $('#message').disabled = !open; $('.send-button').disabled = !open;
  $('#composer-alert').classList.toggle('hidden', open); $('#composer-alert').textContent = open ? '' : 'A resposta livre não está disponível. Selecione um template aprovado pela Meta.';
}

async function loadMessages() {
  const data = await api(`/api/conversations/${state.active.id}/messages`);
  state.messages = data.items;
  renderMessages();
}

function renderMessages() {
  if (!state.active) return;
  const serverIds = new Set(state.messages.map(item => item.id));
  const pending = state.pendingMessages.filter(item => item.conversationId === state.active.id && !serverIds.has(item.id));
  const items = [...state.messages, ...pending].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  let previousDay = ''; let previousDirection = '';
  $('#message-list').innerHTML = items.length ? items.map(item => {
    const currentDay = dayKey(item.createdAt);
    const separator = currentDay !== previousDay ? `<div class="message-day"><span>${dayLabel(item.createdAt)}</span></div>` : '';
    const grouped = currentDay === previousDay && item.direction === previousDirection;
    previousDay = currentDay; previousDirection = item.direction;
    return `${separator}<div class="message-row ${item.direction} ${grouped ? 'same-author' : 'new-author'}"><article class="bubble">
      ${item.senderName ? `<small>${escapeHtml(item.senderName)}</small>` : ''}${messageContent(item)}
      <footer>${item.status === 'failed' && item.direction === 'outbound' ? `<button type="button" class="message-retry" data-retry-id="${item.id}">Reenviar</button>` : ''}<time>${time(item.createdAt)}</time>${item.direction === 'outbound' ? `<span class="message-status ${item.status}" title="${statusLabel(item.status)}">${statusIcon(item.status)}</span>` : ''}</footer>
    </article></div>`;
  }).join('') : '<div class="empty">Ainda não há mensagens.</div>';
  $('#message-list').scrollTop = $('#message-list').scrollHeight;
}

function statusIcon(status) { return status === 'queued' ? '◷' : status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : status === 'failed' ? '!' : '✓'; }
function statusLabel(status) { return ({ queued: 'Enviando…', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falha no envio' })[status] || status; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3500); }

function renderAgentOptions() {
  $('#agent-select').innerHTML = `<option value="">Não atribuído</option>${state.users.map(user => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.role)}</option>`).join('')}`;
}

function renderTeamOptions() {
  $('#team-select').innerHTML = '<option value="">Sem equipe</option>' + state.teams.filter(team => team.active).map(team => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
}

function renderQuickReplies() {
  $('#quick-replies-popover').innerHTML = state.quickReplies.length ? state.quickReplies.map(item => `<button type="button" class="quick-reply" data-quick-id="${item.id}"><code>${escapeHtml(item.shortcut)}</code><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small></button>`).join('') : '<div class="empty">Nenhuma resposta rápida configurada.</div>';
}

async function loadNotes() {
  if (!state.active) return;
  const data = await api(`/api/conversations/${state.active.id}/notes`);
  $('#notes-list').innerHTML = data.items.length ? data.items.map(note => `<article class="note-card"><p>${escapeHtml(note.body)}</p><footer><span>${escapeHtml(note.userName)}</span><time>${dateTime(note.createdAt)}</time></footer></article>`).join('') : '<span class="detail-empty">Nenhuma anotação</span>';
}

async function loadTags() {
  if (!state.active) return;
  const data = await api(`/api/conversations/${state.active.id}/tags`); state.tags = data.items;
  $('#tag-list').innerHTML = state.tags.length ? state.tags.map(tag => `<span class="tag-chip">${escapeHtml(tag.name)}<button type="button" data-remove-tag="${escapeHtml(tag.name)}" aria-label="Remover">×</button></span>`).join('') : '<span class="detail-empty">Nenhuma etiqueta</span>';
}

function openDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { const dialog = $(`#${id}`); if (dialog.open) dialog.close(); }

$('#conversation-list').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) openConversation(button.dataset.id); });
$('#search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadConversations(false), 300); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.filter').forEach(x => x.classList.remove('active')); button.classList.add('active'); state.status = button.dataset.status; loadConversations(false); }));
$('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('#message').value.trim(); if (!text || !state.active) return;
  $('#message').value = ''; $('#message').style.height = 'auto';
  await sendOptimisticMessage(state.active.id, text);
});

async function sendOptimisticMessage(conversationId, text) {
  const clientId = crypto.randomUUID();
  const optimistic = { id: clientId, conversationId, direction: 'outbound', type: 'text', textBody: text, status: 'queued', senderName: state.user.name, createdAt: new Date().toISOString(), optimistic: true };
  state.pendingMessages.push(optimistic);
  if (state.active?.id === conversationId) renderMessages();
  try {
    await api(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ text, clientId }) });
    state.pendingMessages = state.pendingMessages.filter(item => item.id !== clientId);
    if (state.active?.id === conversationId) await loadMessages();
    await loadConversations();
  } catch (error) {
    optimistic.status = 'failed'; optimistic.errorMessage = error.message;
    if (state.active?.id === conversationId) renderMessages();
    toast(`Não foi possível enviar: ${error.message}`);
  }
}

$('#message-list').addEventListener('click', event => {
  const button = event.target.closest('[data-retry-id]'); if (!button) return;
  const failed = state.pendingMessages.find(item => item.id === button.dataset.retryId) || state.messages.find(item => item.id === button.dataset.retryId); if (!failed) return;
  state.pendingMessages = state.pendingMessages.filter(item => item.id !== failed.id);
  sendOptimisticMessage(failed.conversationId || state.active.id, failed.textBody);
});
$('#assign').addEventListener('click', () => { if (!state.active) return; const assigned = state.users.find(user => user.name === state.active.assignedUserName); $('#agent-select').value = assigned?.id || state.user.id; openDialog('assign-dialog'); });
$('#detail-assign-shortcut').addEventListener('click', () => $('#assign').click());
$('#status').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); await loadConversations(); });
$('#team-select').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/routing`, { method: 'PATCH', body: JSON.stringify({ teamId: event.target.value || null }) }); await loadConversations(); toast('Equipe atualizada.'); });
$('#priority-select').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/routing`, { method: 'PATCH', body: JSON.stringify({ priority: event.target.value }) }); await loadConversations(); toast('Prioridade atualizada.'); });
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
$('#message').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`; });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); } });
$('#mobile-back').addEventListener('click', () => $('.app-shell').classList.remove('chat-open'));
$('#quick-replies-button').addEventListener('click', () => $('#quick-replies-popover').classList.toggle('hidden'));
$('#quick-replies-popover').addEventListener('click', event => { const button = event.target.closest('[data-quick-id]'); if (!button) return; const item = state.quickReplies.find(reply => reply.id === button.dataset.quickId); if (item) { $('#message').value = item.body; $('#message').focus(); } $('#quick-replies-popover').classList.add('hidden'); });
$('#template-button').addEventListener('click', async () => {
  if (!state.active) return; openDialog('template-dialog'); $('#template-error').textContent = '';
  try {
    const data = await api('/api/templates'); state.templates = data.items;
    $('#template-select').innerHTML = '<option value="">Selecione um template</option>' + state.templates.map((item, index) => `<option value="${index}">${escapeHtml(item.name)} · ${escapeHtml(item.language)} · ${escapeHtml(item.category)}</option>`).join('');
  } catch (error) { $('#template-error').textContent = error.message; }
});
$('#attach-button').addEventListener('click', () => { if (state.active && windowOpen(state.active)) $('#media-input').click(); else toast('A janela de atendimento está encerrada.'); });
$('#media-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file || !state.active) return;
  const form = new FormData(); form.append('file', file); const caption = $('#message').value.trim(); if (caption) form.append('caption', caption);
  $('#attach-button').disabled = true;
  try { await api(`/api/conversations/${state.active.id}/media`, { method: 'POST', body: form }); $('#message').value = ''; await Promise.all([loadMessages(), loadConversations()]); toast('Arquivo enviado.'); }
  catch (error) { toast(error.message); } finally { event.target.value = ''; $('#attach-button').disabled = false; }
});
$('#add-note').addEventListener('click', () => { if (state.active) openDialog('note-dialog'); });
$('#add-tag').addEventListener('click', () => { if (state.active) openDialog('tag-dialog'); });
$('#edit-contact').addEventListener('click', () => { if (!state.active) return; $('#contact-name').value = displayName(state.active); openDialog('contact-dialog'); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$('#assign-form').addEventListener('submit', async event => { event.preventDefault(); await api(`/api/conversations/${state.active.id}/assign`, { method: 'POST', body: JSON.stringify({ userId: $('#agent-select').value || null }) }); closeDialog('assign-dialog'); await loadConversations(); await openConversation(state.active.id); toast('Conversa atribuída.'); });
$('#note-form').addEventListener('submit', async event => { event.preventDefault(); await api(`/api/conversations/${state.active.id}/notes`, { method: 'POST', body: JSON.stringify({ body: $('#note-body').value }) }); $('#note-body').value = ''; closeDialog('note-dialog'); await loadNotes(); toast('Anotação salva.'); });
$('#tag-form').addEventListener('submit', async event => { event.preventDefault(); const name = $('#tag-name').value.trim().toLowerCase(); const names = [...new Set([...state.tags.map(tag => tag.name), name])]; await api(`/api/conversations/${state.active.id}/tags`, { method: 'PUT', body: JSON.stringify({ names }) }); $('#tag-name').value = ''; closeDialog('tag-dialog'); await Promise.all([loadTags(), loadConversations()]); toast('Etiqueta adicionada.'); });
$('#tag-list').addEventListener('click', async event => { const button = event.target.closest('[data-remove-tag]'); if (!button) return; const names = state.tags.map(tag => tag.name).filter(name => name !== button.dataset.removeTag); await api(`/api/conversations/${state.active.id}/tags`, { method: 'PUT', body: JSON.stringify({ names }) }); await Promise.all([loadTags(), loadConversations()]); });
$('#contact-form').addEventListener('submit', async event => { event.preventDefault(); await api(`/api/conversations/${state.active.id}/contact`, { method: 'PATCH', body: JSON.stringify({ name: $('#contact-name').value }) }); closeDialog('contact-dialog'); await loadConversations(); await openConversation(state.active.id); toast('Contato atualizado.'); });
$('#template-select').addEventListener('change', event => renderTemplateForm(event.target.value === '' ? null : state.templates[Number(event.target.value)]));
$('#template-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#template-error').textContent = ''; const selectedIndex = $('#template-select').value; const template = selectedIndex === '' ? null : state.templates[Number(selectedIndex)];
  if (!template) return ($('#template-error').textContent = 'Selecione um template.');
  const components = [...document.querySelectorAll('[data-template-component]')].reduce((items, input) => {
    const type = input.dataset.templateComponent.toLowerCase(); let component = items.find(item => item.type === type);
    if (!component) { component = { type, parameters: [] }; items.push(component); }
    component.parameters.push({ type: 'text', text: input.value }); return items;
  }, []);
  try { await api(`/api/conversations/${state.active.id}/templates`, { method: 'POST', body: JSON.stringify({ name: template.name, language: template.language, components }) }); closeDialog('template-dialog'); await loadMessages(); toast('Template enviado.'); }
  catch (error) { $('#template-error').textContent = error.message; }
});

function renderTemplateForm(template) {
  if (!template) { $('#template-preview').classList.add('hidden'); $('#template-variables').innerHTML = ''; return; }
  const body = template.components?.find(component => component.type === 'BODY')?.text || '';
  $('#template-preview').textContent = body || `Template ${template.name}`; $('#template-preview').classList.remove('hidden');
  const fields = [];
  for (const component of template.components || []) {
    if (!['BODY', 'HEADER'].includes(component.type) || typeof component.text !== 'string') continue;
    const indexes = [...component.text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
    for (const index of [...new Set(indexes)].sort((a, b) => a - b)) fields.push(`<label>Variável ${index} · ${component.type.toLowerCase()}<input data-template-component="${component.type}" data-variable-index="${index}" required placeholder="Valor de {{${index}}}"></label>`);
  }
  $('#template-variables').innerHTML = fields.join('');
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onmessage = async event => {
    const data = JSON.parse(event.data); if (data.type === 'ready') return;
    await loadConversations();
    if (state.active && (!data.conversationId || data.conversationId === state.active.id)) {
      await loadMessages();
      if (data.type === 'note') await loadNotes();
      if (data.type === 'conversation') await loadTags();
    }
  };
}

init().catch(error => toast(error.message));
