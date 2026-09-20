import { api } from './api.js';

const $ = (selector) => document.querySelector(selector);
const SYSTEM_TIME_ZONE = 'America/Sao_Paulo';
const state = { user: null, users: [], teams: [], quickReplies: [], quickReplyMatches: [], quickReplyIndex: -1, templates: [], tags: [], contacts: [], conversations: [], messages: [], scheduledMessages: [], pendingMessages: [], pastedFiles: [], pastedFileIndex: 0, pasteObjectUrls: [], active: null, status: 'new', contactStatus: '', contactPage: 1, contactPages: 1, contactTotal: 0, searchTimer: null, contactSearchTimer: null, replyTo: null, actionMessage: null, contextConversation: null, assignmentConversationId: null, scheduleConversationId: null, scheduleEditingId: null, emojiMode: 'insert', recorder: null, typingTimer: null, pendingOpenConversationId: null, soundEnabled: localStorage.getItem('chat.notificationSound') !== 'off', notificationAudio: null };

function escapeHtml(value = '') { const node = document.createElement('div'); node.textContent = String(value); return node.innerHTML; }
function initials(name = '?') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(); }
function displayName(item) { return item.name || item.profileName || item.phone || 'Contato'; }
function time(value) { return value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Encerrada'; }
function dayKey(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)); }
function dayLabel(value) {
  const date = new Date(value); const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(date) === dayKey(today)) return 'Hoje';
  if (dayKey(date) === dayKey(yesterday)) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, day: '2-digit', month: 'long', year: dayKey(date).slice(0, 4) === dayKey(today).slice(0, 4) ? undefined : 'numeric' }).format(date);
}
function windowOpen(item) { return item?.serviceWindowExpiresAt && new Date(item.serviceWindowExpiresAt) > new Date(); }
function safeImageUrl(value) { try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function catalogPrice(product = {}) {
  if (product.formattedPrice) return String(product.formattedPrice);
  if (product.price == null) return '';
  const amount = Number(product.price);
  if (product.currency && Number.isFinite(amount)) {
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: String(product.currency) }).format(amount / 100); } catch { /* exibe o valor original abaixo */ }
  }
  return `${product.price}${product.currency ? ` ${product.currency}` : ''}`;
}
function catalogProductCard(product = {}, fallback = {}) {
  const name = product.name || fallback.product_retailer_id || 'Produto do catálogo';
  const price = catalogPrice(product);
  const imageUrl = safeImageUrl(product.imageUrl || product.image_url);
  return `<div class="catalog-product-card"><div class="catalog-product-copy"><span>Produto do catálogo</span><strong>${escapeHtml(name)}</strong>${price ? `<b>${escapeHtml(price)}</b>` : ''}</div>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)}" loading="lazy">` : '<div class="catalog-product-placeholder" aria-hidden="true">▣</div>'}</div>`;
}
function messageContent(item) {
  const url = `/api/messages/${encodeURIComponent(item.id)}/media`;
  const content = typeof item.content === 'string' ? JSON.parse(item.content || '{}') : (item.content || {});
  const referredProduct = content.context?.referred_product;
  if (referredProduct) return `${catalogProductCard(content.catalog_product, referredProduct)}${item.textBody ? `<p class="catalog-message-text">${escapeHtml(item.textBody)}</p>` : ''}`;
  if (item.type === 'order' && content.order) {
    const products = Array.isArray(content.order.product_items) ? content.order.product_items : [];
    return `<div class="catalog-order"><span>Pedido do catálogo</span>${products.map(product => catalogProductCard({ retailerId: product.product_retailer_id, name: product.product_retailer_id, price: product.item_price != null ? Number(product.item_price) * 100 : undefined, currency: product.currency }, product)).join('')}</div>${content.order.text ? `<p class="catalog-message-text">${escapeHtml(content.order.text)}</p>` : ''}`;
  }
  if (item.type === 'template') {
    const buttons = Array.isArray(content.buttons) ? content.buttons : [];
    return `<p>${escapeHtml(item.textBody || `Template: ${content.template || 'mensagem'}`).replaceAll('\n', '<br>')}</p>${buttons.length ? `<div class="message-template-buttons">${buttons.map(button => button.url ? `<a href="${escapeHtml(button.url)}" target="_blank" rel="noopener">${escapeHtml(button.text || 'Abrir')}</a>` : `<span>${escapeHtml(button.text || 'Ação')}</span>`).join('')}</div>` : ''}`;
  }
  if (item.type === 'image' || item.type === 'sticker') return `<a href="${url}" target="_blank" class="media-preview"><img src="${url}" alt="${escapeHtml(item.textBody || 'Imagem')}"></a>${item.textBody ? `<p>${escapeHtml(item.textBody)}</p>` : ''}`;
  if (item.type === 'video') return `<video class="media-preview" src="${url}" controls preload="metadata"></video>${item.textBody ? `<p>${escapeHtml(item.textBody)}</p>` : ''}`;
  if (item.type === 'audio') return `<audio class="audio-preview" src="${url}" controls preload="metadata"></audio>`;
  if (item.type === 'document') return `<a class="document-preview" href="${url}" target="_blank"><span>↓</span><div><strong>Baixar documento</strong><small>${escapeHtml(item.textBody || 'Arquivo recebido')}</small></div></a>`;
  if (item.type === 'location' && content.location) { const { latitude, longitude, name, address } = content.location; return `<a class="document-preview" href="https://maps.google.com/?q=${encodeURIComponent(`${latitude},${longitude}`)}" target="_blank" rel="noopener"><span>⌖</span><div><strong>${escapeHtml(name || 'Localização')}</strong><small>${escapeHtml(address || `${latitude}, ${longitude}`)}</small></div></a>`; }
  if (item.type === 'contacts' && Array.isArray(content.contacts)) return content.contacts.map(contact => `<div class="document-preview"><span>◉</span><div><strong>${escapeHtml(contact.name?.formatted_name || 'Contato')}</strong><small>Contato compartilhado</small></div></div>`).join('');
  return `<p>${escapeHtml(item.textBody || `[${item.type}]`)}</p>`;
}
function messageOrigin(item) { const content = typeof item.content === 'string' ? JSON.parse(item.content || '{}') : (item.content || {}); if (content.origin !== 'integration') return ''; const source = content.source === 'site' ? 'Site' : content.source; return `<div class="message-origin"><span>◆</span>${escapeHtml(source || 'Integração')}${content.externalId ? ` · ${escapeHtml(content.externalId)}` : ''}</div>`; }
function replyContent(item) { if (!item.replyToMessageId && !item.replyToMetaMessageId) return ''; return `<div class="quoted-message"><strong>${escapeHtml(item.replySenderName || (item.replyDirection === 'outbound' ? 'Atendimento' : displayName(state.active)))}</strong><span>${escapeHtml(item.replyTextBody || `[${item.replyType || 'mensagem'}]`)}</span></div>`; }
function reactionContent(item) { return item.reactions?.length ? `<div class="message-reactions">${item.reactions.map(reaction => `<button type="button" data-existing-reaction="${item.id}" title="${reaction.direction === 'outbound' ? 'Atendimento' : 'Cliente'}">${escapeHtml(reaction.emoji)}</button>`).join('')}</div>` : ''; }

async function init() {
  renderSoundPreference();
  state.user = (await api('/api/auth/me')).user;
  const [users, teams, quickReplies] = await Promise.all([api('/api/users'), api('/api/management/teams'), api('/api/quick-replies')]);
  state.users = users.items; state.teams = teams.items; state.quickReplies = quickReplies.items;
  renderAgentOptions(); renderTeamOptions(); renderQuickReplies(); await loadConversations();
  const requestedConversation = new URLSearchParams(location.search).get('conversation');
  if (requestedConversation) {
    state.status = ''; document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item.dataset.status === ''));
    await loadConversations(); if (state.conversations.some(item => item.id === requestedConversation)) await openConversation(requestedConversation);
  }
  connectEvents();
}

async function loadConversations(preserve = true) {
  const data = await api(`/api/conversations?search=${encodeURIComponent($('#search').value)}&status=${encodeURIComponent(state.status)}`);
  $('#total-count').textContent = Number(data.counts?.total || 0);
  $('#unread-count').textContent = Number(data.counts?.unreadCount || 0);
  document.querySelectorAll('[data-count]').forEach(badge => { badge.textContent = Number(data.counts?.[badge.dataset.count] || 0); });
  state.conversations = data.items;
  renderConversations();
  if (preserve && state.active) { state.active = state.conversations.find(item => item.id === state.active.id) || state.active; renderContactActivity(); }
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
  $('#detail-phone').textContent = state.active.phone;
  $('#chat-avatar').textContent = $('#detail-avatar').textContent = initials(name);
  $('#detail-agent').textContent = state.active.assignedUserName || 'Não atribuído';
  $('#assign').querySelector('span').textContent = state.active.assignedUserName ? 'Reatribuir' : 'Assumir conversa';
  $('#status').value = state.active.status;
  $('#team-select').value = state.active.teamId || ''; $('#priority-select').value = state.active.priority || 'normal';
  renderContactActivity(); updateWindow(); await Promise.all([loadMessages(), loadNotes(), loadTags(), loadDetailScheduledMessages(), api(`/api/conversations/${id}/read`, { method: 'POST' })]);
  layoutConversation();
}

function renderContactActivity() {
  if (!state.active) return;
  const last = state.active.lastCustomerMessageAt ? new Date(state.active.lastCustomerMessageAt) : null;
  const elapsed = last ? Date.now() - last.getTime() : Infinity; let label = 'Sem atividade recente'; let recent = false;
  if (elapsed < 2 * 60 * 1000) { label = 'Ativo recentemente'; recent = true; }
  else if (last && dayKey(last) === dayKey(new Date())) label = `Última mensagem hoje às ${time(last)}`;
  else if (last) label = `Última atividade em ${dateTime(last)}`;
  $('#contact-activity').textContent = label; $('#contact-presence-dot').classList.toggle('recent', recent);
}

function layoutConversation() {
  if (!state.active) return;
  const chat = $('#chat'); const composer = $('#composer'); const alert = $('#composer-alert'); const messages = $('#message-list');
  composer.hidden = false; composer.classList.remove('hidden');
  if (!state.recorder) composer.classList.remove('recording');
  const panelRect = chat.parentElement.getBoundingClientRect();
  chat.style.height = `${panelRect.height}px`;
  Object.assign(composer.style, { position: 'fixed', left: `${panelRect.left + 22}px`, right: `${Math.max(innerWidth - panelRect.right + 22, 22)}px`, bottom: '18px', display: 'flex', visibility: 'visible' });
  const reserved = composer.offsetHeight + 36 + (alert.classList.contains('hidden') ? 0 : alert.offsetHeight);
  messages.style.bottom = `${Math.max(reserved, 100)}px`;
}

function updateWindow() {
  const open = windowOpen(state.active); const label = open ? `Janela aberta até ${dateTime(state.active.serviceWindowExpiresAt)}` : 'Janela encerrada · use um template';
  $('#composer').classList.remove('hidden');
  $('#window-badge').textContent = open ? 'Janela aberta' : 'Janela encerrada'; $('#window-badge').className = `badge ${open ? 'success' : 'warning'}`;
  $('#detail-window').textContent = label; $('#message').disabled = !open; $('.send-button').disabled = !open;
  $('#composer-alert').classList.toggle('hidden', open); $('#composer-alert').textContent = open ? '' : 'A resposta livre não está disponível. Selecione um template aprovado pela Meta.';
  requestAnimationFrame(layoutConversation);
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
    return `${separator}<div class="message-row ${item.direction} ${grouped ? 'same-author' : 'new-author'}" data-message-id="${item.id}"><article class="bubble">
      ${replyContent(item)}${messageOrigin(item)}${item.senderName ? `<small>${escapeHtml(item.senderName)}</small>` : ''}${messageContent(item)}
      <footer>${item.status === 'failed' && item.direction === 'outbound' ? `<button type="button" class="message-retry" data-retry-id="${item.id}" title="${escapeHtml(item.errorMessage || 'Falha no envio')}">Reenviar</button>` : ''}<time>${time(item.createdAt)}</time>${item.direction === 'outbound' ? `<span class="message-status ${item.status}" title="${escapeHtml(item.errorMessage || statusLabel(item))}">${statusIcon(item.status)}</span>` : ''}</footer>
      ${reactionContent(item)}</article><button type="button" class="message-more" data-open-actions="${item.id}" aria-label="Ações da mensagem">⌄</button></div>`;
  }).join('') : '<div class="empty">Ainda não há mensagens.</div>';
  $('#message-list').scrollTop = $('#message-list').scrollHeight;
  requestAnimationFrame(layoutConversation);
}

function statusIcon(status) { return status === 'queued' ? '◷' : status === 'read' ? '✓✓' : status === 'delivered' ? '✓✓' : status === 'failed' ? '!' : '✓'; }
function statusLabel(item) { if (item.status === 'queued') { const content = typeof item.content === 'string' ? JSON.parse(item.content || '{}') : (item.content || {}); if (content.scheduledFor && new Date(content.scheduledFor) > new Date()) return `Agendada para ${dateTime(content.scheduledFor)}`; } return ({ queued: 'Enviando…', sent: 'Enviada', delivered: 'Entregue', read: 'Lida', failed: 'Falha no envio' })[item.status] || item.status; }
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3500); }

function renderSoundPreference() {
  const button = $('#sound-toggle'); if (!button) return;
  button.classList.toggle('sound-muted', !state.soundEnabled); button.setAttribute('aria-pressed', String(state.soundEnabled));
  const action = state.soundEnabled ? 'Desativar' : 'Ativar'; button.title = `${action} som de novas mensagens`; button.setAttribute('aria-label', `${action} som de novas mensagens`);
}
function getNotificationAudio() {
  if (!state.notificationAudio) { state.notificationAudio = new Audio('/notificacao.mp3'); state.notificationAudio.preload = 'auto'; }
  return state.notificationAudio;
}
async function unlockNotificationAudio() {
  const audio = getNotificationAudio(); const previousVolume = audio.volume; audio.volume = 0;
  try { await audio.play(); audio.pause(); audio.currentTime = 0; } catch {} finally { audio.volume = previousVolume; }
  return audio;
}
async function playNotificationSound(preview = false) {
  if (!state.soundEnabled && !preview) return; const audio = getNotificationAudio(); audio.currentTime = 0; await audio.play().catch(() => {});
  const button = $('#sound-toggle'); button?.classList.add('ringing'); setTimeout(() => button?.classList.remove('ringing'), 650);
}
$('#sound-toggle').addEventListener('click', async () => { state.soundEnabled = !state.soundEnabled; localStorage.setItem('chat.notificationSound', state.soundEnabled ? 'on' : 'off'); renderSoundPreference(); if (state.soundEnabled) { await playNotificationSound(true); toast('Som de novas mensagens ativado.'); } else toast('Som de novas mensagens desativado.'); });
document.addEventListener('pointerdown', () => { if (state.soundEnabled) void unlockNotificationAudio(); }, { once: true });

const settingsToggle = $('#settings-toggle'); const settingsMenu = $('#settings-menu');
function closeSettingsMenu() { settingsMenu?.classList.add('hidden'); settingsToggle?.setAttribute('aria-expanded', 'false'); }
settingsToggle?.addEventListener('click', event => { event.stopPropagation(); const opening = settingsMenu.classList.contains('hidden'); settingsMenu.classList.toggle('hidden', !opening); settingsToggle.setAttribute('aria-expanded', String(opening)); });
settingsMenu?.addEventListener('click', event => event.stopPropagation());
document.addEventListener('click', closeSettingsMenu);
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeSettingsMenu(); settingsToggle?.focus(); } });

function renderAgentOptions() {
  $('#agent-select').innerHTML = `<option value="">Não atribuído</option>${state.users.map(user => `<option value="${user.id}">${escapeHtml(user.name)} · ${escapeHtml(user.role)}</option>`).join('')}`;
}

function renderTeamOptions() {
  $('#team-select').innerHTML = '<option value="">Sem equipe</option>' + state.teams.filter(team => team.active).map(team => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
}

function renderQuickReplies(items = state.quickReplies, filtering = false) {
  state.quickReplyMatches = items;
  $('#quick-replies-popover').innerHTML = `<div class="quick-popover-head"><div><strong>${filtering ? 'Sugestões de mensagens' : 'Mensagens rápidas'}</strong><small>${filtering ? 'Continue digitando para filtrar' : 'Respostas da equipe e pessoais'}</small></div><button type="button" data-add-quick-reply>＋ Nova</button></div><div class="quick-replies-list">${items.length ? items.map((item, index) => `<button type="button" class="quick-reply ${index === state.quickReplyIndex ? 'keyboard-active' : ''}" data-quick-id="${item.id}" data-quick-index="${index}"><code>${escapeHtml(item.shortcut)}</code><strong>${escapeHtml(item.title)}${item.userId ? '<i>Minha</i>' : ''}</strong><small>${escapeHtml(item.body)}</small></button>`).join('') : '<div class="empty">Nenhuma mensagem rápida encontrada.</div>'}</div>`;
}

function previewQuickReplies(value) {
  const query = value.trim().toLowerCase();
  if (!/^\/[^\s]*$/.test(query)) { $('#quick-replies-popover').classList.add('hidden'); state.quickReplyIndex = -1; return; }
  const term = query.slice(1); const matches = state.quickReplies.filter(item => item.shortcut.slice(1).toLowerCase().startsWith(term) || item.title.toLowerCase().includes(term));
  state.quickReplyIndex = matches.length ? 0 : -1; renderQuickReplies(matches, true); $('#quick-replies-popover').classList.remove('hidden');
}

function applyQuickReply(item) { if (!item) return; $('#message').value = item.body; $('#message').dispatchEvent(new Event('input')); $('#message').focus(); $('#quick-replies-popover').classList.add('hidden'); state.quickReplyIndex = -1; }

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

const contactStatusLabels = { new: 'Novo', open: 'Em atendimento', pending: 'Pendente', resolved: 'Concluído' };
async function loadContacts() {
  const list = $('#contacts-list');
  list.innerHTML = '<div class="contacts-empty"><span class="contacts-loader"></span>Carregando contatos...</div>';
  try {
    const data = await api(`/api/contacts?search=${encodeURIComponent($('#contacts-search').value)}&status=${encodeURIComponent(state.contactStatus)}&page=${state.contactPage}&limit=25`);
    state.contacts = data.items; state.contactPage = data.pagination.page; state.contactPages = data.pagination.pages; state.contactTotal = data.pagination.total;
    $('#contacts-total').textContent = `${state.contactTotal} ${state.contactTotal === 1 ? 'contato' : 'contatos'}`; renderContacts(); renderContactsPagination();
  } catch (error) { list.innerHTML = `<div class="contacts-empty error">${escapeHtml(error.message)}</div>`; }
}
function renderContacts() {
  $('#contacts-list').innerHTML = state.contacts.length ? state.contacts.map(item => {
    const name = displayName(item); const status = item.status || 'new';
    return `<article class="contact-row"><span class="contact-avatar">${escapeHtml(initials(name))}</span><div class="contact-main"><div><strong>${escapeHtml(name)}</strong><span class="contact-status ${escapeHtml(status)}">${escapeHtml(contactStatusLabels[status] || 'Sem conversa')}</span></div><small>${escapeHtml(item.phone || item.waId || '')}</small><p>${escapeHtml(item.lastMessagePreview || 'Contato cadastrado')}</p></div><div class="contact-meta"><time>${item.lastMessageAt ? dateTime(item.lastMessageAt) : 'Sem mensagens'}</time><small>${escapeHtml(item.assignedUserName || 'Não atribuído')}</small><button type="button" data-open-contact="${item.id || ''}" ${item.id ? '' : 'disabled'}>Abrir conversa <span>→</span></button></div></article>`;
  }).join('') : '<div class="contacts-empty"><span class="contacts-empty-icon">◎</span><strong>Nenhum contato encontrado</strong><small>Tente outro nome, telefone ou filtro.</small></div>';
}
function renderContactsPagination() {
  $('#contacts-page-info').textContent = `Página ${state.contactPage} de ${state.contactPages}`;
  $('#contacts-previous').disabled = state.contactPage <= 1;
  $('#contacts-next').disabled = state.contactPage >= state.contactPages;
}

$('#contacts-button').addEventListener('click', async () => { state.contactPage = 1; openDialog('contacts-dialog'); await loadContacts(); requestAnimationFrame(() => $('#contacts-search').focus()); });
$('#new-contact-button').addEventListener('click', () => { $('#new-contact-form').reset(); $('#new-contact-error').textContent = ''; openDialog('new-contact-dialog'); requestAnimationFrame(() => $('#new-contact-name').focus()); });
$('#contacts-search').addEventListener('input', () => { clearTimeout(state.contactSearchTimer); state.contactPage = 1; state.contactSearchTimer = setTimeout(loadContacts, 250); });
document.querySelectorAll('[data-contact-status]').forEach(button => button.addEventListener('click', async () => { document.querySelectorAll('[data-contact-status]').forEach(item => item.classList.remove('active')); button.classList.add('active'); state.contactStatus = button.dataset.contactStatus; state.contactPage = 1; await loadContacts(); }));
$('#contacts-previous').addEventListener('click', async () => { if (state.contactPage > 1) { state.contactPage -= 1; await loadContacts(); $('#contacts-list').scrollTop = 0; } });
$('#contacts-next').addEventListener('click', async () => { if (state.contactPage < state.contactPages) { state.contactPage += 1; await loadContacts(); $('#contacts-list').scrollTop = 0; } });
$('#contacts-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-open-contact]'); if (!button?.dataset.openContact) return;
  const contact = state.contacts.find(item => item.id === button.dataset.openContact); if (!contact) return;
  if (!state.conversations.some(item => item.id === contact.id)) state.conversations.unshift(contact);
  closeDialog('contacts-dialog'); await openConversation(contact.id);
});

function closeConversationActions() { $('#conversation-actions').classList.add('hidden'); state.contextConversation = null; }
function openConversationActions(conversation, x, y) {
  state.contextConversation = conversation;
  $('#context-avatar').textContent = initials(displayName(conversation)); $('#context-name').textContent = displayName(conversation); $('#context-phone').textContent = conversation.phone || '';
  const resolved = conversation.status === 'resolved'; $('#context-status-label').textContent = resolved ? 'Reabrir conversa' : 'Concluir conversa'; $('#context-status-help').textContent = resolved ? 'Mover para em atendimento' : 'Mover para concluídas';
  const menu = $('#conversation-actions'); menu.classList.remove('hidden');
  const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(12, Math.min(x, innerWidth - rect.width - 12))}px`; menu.style.top = `${Math.max(12, Math.min(y, innerHeight - rect.height - 12))}px`;
}

function saoPauloInputValue(minutesAhead = 30) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + minutesAhead * 60000));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}
function saoPauloDateInput(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}`;
}

function renderDetailScheduledMessages() {
  const pending = state.scheduledMessages.filter(item => item.status === 'pending' || item.status === 'processing');
  $('#detail-scheduled-section').classList.toggle('hidden', !pending.length); $('#detail-scheduled-count').textContent = pending.length;
  $('#detail-scheduled-list').innerHTML = pending.map(item => `<article><div class="scheduled-detail-icon">◷</div><div><strong>${item.messageType === 'template' ? escapeHtml(item.templateName) : escapeHtml(item.body)}</strong><small>${item.messageType === 'template' ? 'Template Meta' : 'Texto livre'} · ${dateTime(item.scheduledFor)}</small></div><div class="scheduled-detail-actions"><button type="button" data-edit-detail-schedule="${item.id}" title="Editar agendamento">✎</button><button type="button" data-cancel-detail-schedule="${item.id}" title="Cancelar agendamento">×</button></div></article>`).join('');
}

async function loadDetailScheduledMessages() {
  if (!state.active) return;
  const data = await api(`/api/conversations/${state.active.id}/scheduled`); state.scheduledMessages = data.items; renderDetailScheduledMessages();
}

async function loadScheduledMessages() {
  if (!state.scheduleConversationId) return;
  const data = await api(`/api/conversations/${state.scheduleConversationId}/scheduled`); state.scheduledMessages = data.items;
  $('#scheduled-list').innerHTML = data.items.length ? `<div class="scheduled-title">Próximos agendamentos</div>${data.items.map(item => `<article><div><strong>${item.messageType === 'template' ? `Template: ${escapeHtml(item.templateName)}` : escapeHtml(item.body)}</strong><small>${dateTime(item.scheduledFor)} · ${item.status === 'failed' ? escapeHtml(item.errorMessage || 'Falhou') : item.status === 'processing' ? 'Processando' : 'Agendada'}</small></div>${item.status === 'pending' ? `<button type="button" data-cancel-schedule="${item.id}" title="Cancelar agendamento">×</button>` : ''}</article>`).join('')}` : '';
}

async function openScheduleDialog(conversation, scheduled = null) {
  state.scheduleConversationId = conversation.id; state.scheduleEditingId = scheduled?.id || null; $('#schedule-avatar').textContent = initials(displayName(conversation)); $('#schedule-name').textContent = displayName(conversation); $('#schedule-body').value = scheduled?.messageType === 'text' ? scheduled.body : ''; $('#schedule-at').value = scheduled ? saoPauloDateInput(scheduled.scheduledFor) : saoPauloInputValue(); $('#schedule-at').min = saoPauloInputValue(1); $('#schedule-error').textContent = ''; $('#schedule-message-type').value = scheduled?.messageType || 'template'; updateScheduleMessageType(); openDialog('schedule-dialog');
  $('#schedule-form .primary').textContent = scheduled ? 'Salvar alterações' : 'Confirmar agendamento';
  try {
    const data = await api('/api/templates'); state.templates = data.items;
    $('#schedule-template-select').innerHTML = '<option value="">Selecione um template</option>' + state.templates.map((item, index) => `<option value="${index}">${escapeHtml(item.name)} · ${escapeHtml(item.language)} · ${escapeHtml(item.category)}</option>`).join('');
    const selectedIndex = scheduled?.messageType === 'template' ? state.templates.findIndex(item => item.name === scheduled.templateName && item.language === scheduled.templateLanguage) : 0;
    if (state.templates.length && selectedIndex >= 0) { $('#schedule-template-select').value = String(selectedIndex); renderScheduleTemplate(state.templates[selectedIndex]); const stored = typeof scheduled?.templateComponents === 'string' ? JSON.parse(scheduled.templateComponents) : (scheduled?.templateComponents || []); document.querySelectorAll('[data-schedule-template-component]').forEach(input => { const component = stored.find(item => item.type?.toUpperCase() === input.dataset.scheduleTemplateComponent); input.value = component?.parameters?.[Number(input.dataset.variableIndex) - 1]?.text || ''; }); updateScheduleTemplatePreview(); }
  } catch (error) { $('#schedule-template-select').innerHTML = '<option value="">Templates indisponíveis</option>'; $('#schedule-error').textContent = error.message; }
  await loadScheduledMessages();
}

function updateScheduleMessageType() {
  const template = $('#schedule-message-type').value === 'template';
  $('#schedule-template-fields').classList.toggle('hidden', !template); $('#schedule-text-fields').classList.toggle('hidden', template);
  $('#schedule-template-select').required = template; $('#schedule-body').required = !template;
  $('.schedule-warning p').textContent = template ? 'O template aprovado pode ser enviado mesmo fora da janela de atendimento de 24 horas.' : 'O envio de texto livre só ocorrerá se a janela de atendimento de 24 horas estiver aberta nesse horário.';
}

function renderScheduleTemplate(template) {
  const preview = $('#schedule-template-preview'); if (!template) { preview.classList.add('hidden'); $('#schedule-template-variables').innerHTML = ''; return; }
  const header = template.components?.find(component => component.type === 'HEADER')?.text || ''; const body = template.components?.find(component => component.type === 'BODY')?.text || ''; const footer = template.components?.find(component => component.type === 'FOOTER')?.text || ''; const fields = [];
  for (const component of template.components || []) { if (!['BODY', 'HEADER'].includes(component.type) || typeof component.text !== 'string') continue; const indexes = [...component.text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1])); for (const index of [...new Set(indexes)].sort((a, b) => a - b)) fields.push(`<label>Variável ${index} · ${component.type.toLowerCase()}<input data-schedule-template-component="${component.type}" data-variable-index="${index}" required placeholder="Valor de {{${index}}}"></label>`); }
  $('#schedule-template-variables').innerHTML = fields.join(''); preview.dataset.header = header; preview.dataset.body = body; preview.dataset.footer = footer; updateScheduleTemplatePreview(); preview.classList.remove('hidden');
}

function updateScheduleTemplatePreview() {
  const preview = $('#schedule-template-preview'); let body = preview.dataset.body || ''; let header = preview.dataset.header || '';
  document.querySelectorAll('[data-schedule-template-component]').forEach(input => { if (input.dataset.scheduleTemplateComponent === 'HEADER') header = header.replaceAll(`{{${input.dataset.variableIndex}}}`, input.value || `{{${input.dataset.variableIndex}}}`); else body = body.replaceAll(`{{${input.dataset.variableIndex}}}`, input.value || `{{${input.dataset.variableIndex}}}`); });
  preview.innerHTML = `${header ? `<strong>${escapeHtml(header)}</strong>` : ''}<p>${escapeHtml(body).replaceAll('\n', '<br>')}</p>${preview.dataset.footer ? `<small>${escapeHtml(preview.dataset.footer)}</small>` : ''}`;
}

$('#conversation-list').addEventListener('contextmenu', event => {
  const button = event.target.closest('[data-id]'); if (!button) return; event.preventDefault();
  const conversation = state.conversations.find(item => item.id === button.dataset.id); if (conversation) openConversationActions(conversation, event.clientX, event.clientY);
});

$('#conversation-actions').addEventListener('click', async event => {
  const button = event.target.closest('[data-conversation-action]'); const conversation = state.contextConversation; if (!button || !conversation) return;
  const action = button.dataset.conversationAction; closeConversationActions();
  try {
    if (action === 'unread') { await api(`/api/conversations/${conversation.id}/unread`, { method: 'POST' }); await loadConversations(false); toast('Conversa marcada como não lida.'); }
    if (action === 'schedule') await openScheduleDialog(conversation);
    if (action === 'transfer') { state.assignmentConversationId = conversation.id; $('#agent-select').value = conversation.assignedUserId || ''; openDialog('assign-dialog'); }
    if (action === 'urgent') { await api(`/api/conversations/${conversation.id}/routing`, { method: 'PATCH', body: JSON.stringify({ priority: 'urgent' }) }); await loadConversations(); toast('Conversa marcada como urgente.'); }
    if (action === 'copy-phone') { await navigator.clipboard.writeText(conversation.phone || ''); toast('Telefone copiado.'); }
    if (action === 'toggle-status') {
      if (conversation.status === 'resolved') await api(`/api/conversations/${conversation.id}/open`, { method: 'POST' });
      else await api(`/api/conversations/${conversation.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) });
      await loadConversations(false); if (state.active?.id === conversation.id) { state.active.status = conversation.status === 'resolved' ? 'open' : 'resolved'; $('#status').value = state.active.status; }
      toast(conversation.status === 'resolved' ? 'Conversa reaberta.' : 'Conversa concluída.');
    }
  } catch (error) { toast(error.message); }
});

$('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true; $('#schedule-error').textContent = '';
  const messageType = $('#schedule-message-type').value; const template = messageType === 'template' && $('#schedule-template-select').value !== '' ? state.templates[Number($('#schedule-template-select').value)] : null;
  const templateComponents = [...document.querySelectorAll('[data-schedule-template-component]')].reduce((items, input) => { const type = input.dataset.scheduleTemplateComponent.toLowerCase(); let component = items.find(item => item.type === type); if (!component) { component = { type, parameters: [] }; items.push(component); } component.parameters.push({ type: 'text', text: input.value }); return items; }, []);
  const payload = messageType === 'template' ? { messageType, body: template?.components?.find(component => component.type === 'BODY')?.text || `Template: ${template?.name || ''}`, scheduledFor: $('#schedule-at').value, templateName: template?.name, templateLanguage: template?.language, templateComponents } : { messageType, body: $('#schedule-body').value, scheduledFor: $('#schedule-at').value };
  try { if (messageType === 'template' && !template) throw new Error('Selecione um template aprovado.'); const editing = state.scheduleEditingId; await api(editing ? `/api/scheduled/${editing}` : `/api/conversations/${state.scheduleConversationId}/scheduled`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); $('#schedule-body').value = ''; closeDialog('schedule-dialog'); state.scheduleConversationId = null; state.scheduleEditingId = null; if (state.active) await loadDetailScheduledMessages(); toast(editing ? 'Agendamento atualizado.' : 'Mensagem agendada com sucesso.'); }
  catch (error) { $('#schedule-error').textContent = error.message; } finally { submit.disabled = false; }
});
$('#schedule-message-type').addEventListener('change', updateScheduleMessageType);
$('#schedule-template-select').addEventListener('change', event => renderScheduleTemplate(event.target.value === '' ? null : state.templates[Number(event.target.value)]));
$('#schedule-template-variables').addEventListener('input', updateScheduleTemplatePreview);
$('#scheduled-list').addEventListener('click', async event => { const button = event.target.closest('[data-cancel-schedule]'); if (!button) return; try { await api(`/api/scheduled/${button.dataset.cancelSchedule}`, { method: 'DELETE' }); await loadScheduledMessages(); toast('Agendamento cancelado.'); } catch (error) { toast(error.message); } });
$('#detail-scheduled-list').addEventListener('click', async event => {
  const edit = event.target.closest('[data-edit-detail-schedule]'); const cancel = event.target.closest('[data-cancel-detail-schedule]');
  if (edit) { const item = state.scheduledMessages.find(schedule => schedule.id === edit.dataset.editDetailSchedule); if (item && state.active) await openScheduleDialog(state.active, item); return; }
  if (cancel) { try { await api(`/api/scheduled/${cancel.dataset.cancelDetailSchedule}`, { method: 'DELETE' }); await loadDetailScheduledMessages(); toast('Agendamento cancelado.'); } catch (error) { toast(error.message); } }
});
document.addEventListener('click', event => { if (!event.target.closest('#conversation-actions')) closeConversationActions(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeConversationActions(); });
window.addEventListener('blur', closeConversationActions);

$('#conversation-list').addEventListener('click', event => {
  const button = event.target.closest('[data-id]'); if (!button) return;
  const conversation = state.conversations.find(item => item.id === button.dataset.id);
  if (conversation?.status === 'open' && conversation.assignedUserId && conversation.assignedUserId !== state.user.id) {
    $('#conversation-busy-agent').textContent = conversation.assignedUserName || 'outro atendente'; openDialog('conversation-busy-dialog'); return;
  }
  if (conversation && ['new', 'resolved'].includes(state.status)) {
    state.pendingOpenConversationId = conversation.id;
    $('#conversation-open-name').textContent = displayName(conversation);
    $('#conversation-open-message').textContent = state.status === 'resolved' ? 'Esta conversa está concluída. Ao continuar, ela será reaberta e movida para Em atendimento.' : 'Ao continuar, esta nova conversa será iniciada e movida para Em atendimento.';
    $('#conversation-open-error').textContent = ''; openDialog('conversation-open-dialog'); return;
  }
  openConversation(button.dataset.id);
});
$('#confirm-conversation-open').addEventListener('click', async () => {
  const id = state.pendingOpenConversationId; if (!id) return;
  const button = $('#confirm-conversation-open'); button.disabled = true; $('#conversation-open-error').textContent = '';
  try {
    await api(`/api/conversations/${id}/open`, { method: 'POST' });
    closeDialog('conversation-open-dialog'); state.pendingOpenConversationId = null; state.status = 'open';
    document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item.dataset.status === 'open'));
    await loadConversations(false); await openConversation(id); toast('Conversa movida para Em atendimento.');
  } catch (error) {
    if (error.message.includes('já está em andamento')) { closeDialog('conversation-open-dialog'); $('#conversation-busy-agent').textContent = error.message.split('atendente ')[1]?.replace(/\.$/, '') || 'outro atendente'; openDialog('conversation-busy-dialog'); }
    else $('#conversation-open-error').textContent = error.message;
  }
  finally { button.disabled = false; }
});
$('#search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadConversations(false), 300); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search').focus(); $('#search').select(); } });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', async () => {
  document.querySelectorAll('.filter').forEach(x => x.classList.remove('active')); button.classList.add('active'); state.status = button.dataset.status;
  await loadConversations(false);
  if (state.active) { updateWindow(); renderConversations(); layoutConversation(); }
}));
window.addEventListener('resize', layoutConversation);
const filterStrip = $('.filters'); let filterDrag = null; let suppressFilterClick = false;
filterStrip.addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse' || event.button !== 0) return; filterDrag = { x: event.clientX, scrollLeft: filterStrip.scrollLeft, moved: false, pointerId: event.pointerId }; });
filterStrip.addEventListener('pointermove', event => { if (!filterDrag) return; const distance = event.clientX - filterDrag.x; if (Math.abs(distance) > 4 && !filterDrag.moved) { filterDrag.moved = true; filterStrip.setPointerCapture(filterDrag.pointerId); filterStrip.classList.add('dragging'); } if (filterDrag.moved) filterStrip.scrollLeft = filterDrag.scrollLeft - distance; });
filterStrip.addEventListener('pointerup', event => { if (!filterDrag) return; suppressFilterClick = filterDrag.moved; if (filterStrip.hasPointerCapture(filterDrag.pointerId)) filterStrip.releasePointerCapture(filterDrag.pointerId); filterDrag = null; filterStrip.classList.remove('dragging'); });
filterStrip.addEventListener('pointercancel', () => { filterDrag = null; filterStrip.classList.remove('dragging'); });
filterStrip.addEventListener('click', event => { if (suppressFilterClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressFilterClick = false; } }, true);
filterStrip.addEventListener('wheel', event => { if (filterStrip.scrollWidth <= filterStrip.clientWidth) return; event.preventDefault(); filterStrip.scrollLeft += event.deltaY || event.deltaX; }, { passive: false });
$('#composer').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('#message').value.trim(); if (!text || !state.active) return;
  $('#message').value = ''; $('#message').style.height = 'auto';
  await sendOptimisticMessage(state.active.id, text);
});

async function sendOptimisticMessage(conversationId, text) {
  const clientId = crypto.randomUUID();
  const reply = state.replyTo; state.replyTo = null; renderReplyPreview();
  const optimistic = { id: clientId, conversationId, direction: 'outbound', type: 'text', textBody: text, status: 'queued', senderName: state.user.name, createdAt: new Date().toISOString(), optimistic: true, replyToMessageId: reply?.id, replyToMetaMessageId: reply?.metaMessageId, replyTextBody: reply?.textBody, replyType: reply?.type, replyDirection: reply?.direction, replySenderName: reply?.senderName };
  state.pendingMessages.push(optimistic);
  if (state.active?.id === conversationId) renderMessages();
  try {
    await api(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ text, clientId, replyToMessageId: reply?.id }) });
    state.pendingMessages = state.pendingMessages.filter(item => item.id !== clientId);
    if (state.active?.id === conversationId) await loadMessages();
    await loadConversations();
  } catch (error) {
    optimistic.status = 'failed'; optimistic.errorMessage = error.message;
    if (state.active?.id === conversationId) renderMessages();
    toast(`Não foi possível enviar: ${error.message}`);
  }
}

$('#message-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-retry-id]'); if (!button) return;
  const failed = state.pendingMessages.find(item => item.id === button.dataset.retryId) || state.messages.find(item => item.id === button.dataset.retryId); if (!failed) return;
  if (failed.type !== 'text') {
    button.disabled = true;
    try { await api(`/api/conversations/${state.active.id}/messages/${failed.id}/retry-media`, { method: 'POST' }); await Promise.all([loadMessages(), loadConversations()]); toast('Mídia reenviada.'); }
    catch (error) { toast(error.message); button.disabled = false; }
    return;
  }
  state.pendingMessages = state.pendingMessages.filter(item => item.id !== failed.id);
  sendOptimisticMessage(failed.conversationId || state.active.id, failed.textBody);
});

function findMessage(id) { return [...state.messages, ...state.pendingMessages].find(item => item.id === id); }
function renderReplyPreview() {
  $('#reply-preview').classList.toggle('hidden', !state.replyTo); if (!state.replyTo) return;
  $('#reply-author').textContent = state.replyTo.senderName || (state.replyTo.direction === 'outbound' ? 'Atendimento' : displayName(state.active));
  $('#reply-text').textContent = state.replyTo.textBody || `[${state.replyTo.type}]`;
}
function selectReply(item) { if (!item?.metaMessageId) return toast('Aguarde a sincronização desta mensagem.'); state.replyTo = item; renderReplyPreview(); $('#message').focus(); closeMessageActions(); }
function closeMessageActions() { $('#message-actions').classList.add('hidden'); state.actionMessage = null; }
function openMessageActions(item, x, y) { state.actionMessage = item; const menu = $('#message-actions'); menu.classList.remove('hidden'); menu.style.left = `${Math.min(x, innerWidth - 300)}px`; menu.style.top = `${Math.min(y, innerHeight - 360)}px`; }
$('#message-list').addEventListener('contextmenu', event => { const row = event.target.closest('[data-message-id]'); if (!row) return; event.preventDefault(); openMessageActions(findMessage(row.dataset.messageId), event.clientX, event.clientY); });
$('#message-list').addEventListener('click', event => { const button = event.target.closest('[data-open-actions]'); if (!button) return; const rect = button.getBoundingClientRect(); openMessageActions(findMessage(button.dataset.openActions), rect.left, rect.bottom + 5); });
$('#message-list').addEventListener('dblclick', event => { const row = event.target.closest('[data-message-id]'); if (row) selectReply(findMessage(row.dataset.messageId)); });
$('#message-actions').addEventListener('click', async event => {
  const reaction = event.target.closest('[data-reaction]'); if (reaction) return applyReaction(state.actionMessage, reaction.dataset.reaction);
  if (event.target.closest('[data-more-reactions]') || event.target.closest('[data-message-action="react"]')) { state.emojiMode = 'reaction'; $('#emoji-popover').classList.remove('hidden'); return; }
  const action = event.target.closest('[data-message-action]')?.dataset.messageAction; const item = state.actionMessage; if (!action || !item) return;
  if (action === 'reply') selectReply(item);
  if (action === 'copy') { await navigator.clipboard.writeText(item.textBody || ''); toast('Mensagem copiada.'); closeMessageActions(); }
  if (action === 'note') { $('#note-body').value = item.textBody || `[${item.type}]`; openDialog('note-dialog'); closeMessageActions(); }
});
async function applyReaction(item, emoji) {
  if (!item?.metaMessageId || item.optimistic) return toast('Aguarde a sincronização da mensagem.');
  item.reactions = (item.reactions || []).filter(reaction => reaction.actorKey !== 'business'); if (emoji) item.reactions.push({ emoji, direction: 'outbound', actorKey: 'business' }); renderMessages(); closeMessageActions(); $('#emoji-popover').classList.add('hidden');
  try { await api(`/api/conversations/${state.active.id}/messages/${item.id}/reaction`, { method: 'POST', body: JSON.stringify({ emoji }) }); await loadMessages(); } catch (error) { toast(error.message); await loadMessages(); }
}
$('#cancel-reply').addEventListener('click', () => { state.replyTo = null; renderReplyPreview(); });
$('#emoji-button').addEventListener('click', () => { state.emojiMode = 'insert'; $('#emoji-popover').classList.toggle('hidden'); closeMessageActions(); });
$('emoji-picker').addEventListener('emoji-click', event => { const emoji = event.detail.unicode; if (state.emojiMode === 'reaction') applyReaction(state.actionMessage, emoji); else { const field = $('#message'), start = field.selectionStart, end = field.selectionEnd; field.setRangeText(emoji, start, end, 'end'); field.focus(); $('#emoji-popover').classList.add('hidden'); } });
document.addEventListener('click', event => { if (!event.target.closest('#message-actions') && !event.target.closest('[data-message-id]')) closeMessageActions(); if (!event.target.closest('#emoji-popover') && !event.target.closest('#emoji-button') && !event.target.closest('[data-more-reactions]')) $('#emoji-popover').classList.add('hidden'); });

$('#voice-button').addEventListener('click', startVoiceRecording);
async function startVoiceRecording() {
  if (!state.active || !windowOpen(state.active)) return toast('A janela de atendimento está encerrada.');
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Este navegador não permite gravar áudio.');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const recorder = new MediaRecorder(stream); const session = { recorder, stream, chunks: [], startedAt: Date.now(), send: false, timer: null }; state.recorder = session;
    recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
    recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); clearInterval(session.timer); $('#voice-recorder').classList.add('hidden'); $('#composer').classList.remove('recording'); if (session.send && session.chunks.length) sendVoiceBlob(new Blob(session.chunks, { type: recorder.mimeType || 'audio/webm' })); state.recorder = null; };
    recorder.start(250); $('#voice-recorder').classList.remove('hidden'); $('#composer').classList.add('recording'); updateVoiceTime(); session.timer = setInterval(updateVoiceTime, 500);
  } catch { toast('Permissão de microfone não concedida.'); }
}
function updateVoiceTime() { if (!state.recorder) return; const seconds = Math.floor((Date.now() - state.recorder.startedAt) / 1000); $('#voice-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
$('#cancel-voice').addEventListener('click', () => { if (state.recorder) { state.recorder.send = false; state.recorder.recorder.stop(); } });
$('#send-voice').addEventListener('click', () => { if (state.recorder) { state.recorder.send = true; state.recorder.recorder.stop(); } });
async function sendVoiceBlob(blob) { const form = new FormData(); form.append('file', blob, 'gravacao.webm'); toast('Enviando áudio…'); try { await api(`/api/conversations/${state.active.id}/voice`, { method: 'POST', body: form }); await Promise.all([loadMessages(), loadConversations()]); toast('Áudio enviado.'); } catch (error) { toast(error.message); } }
$('#assign').addEventListener('click', () => { if (!state.active) return; state.assignmentConversationId = state.active.id; const assigned = state.users.find(user => user.name === state.active.assignedUserName); $('#agent-select').value = assigned?.id || state.user.id; openDialog('assign-dialog'); });
$('#detail-assign-shortcut').addEventListener('click', () => $('#assign').click());
$('#status').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); await loadConversations(); });
$('#team-select').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/routing`, { method: 'PATCH', body: JSON.stringify({ teamId: event.target.value || null }) }); await loadConversations(); toast('Equipe atualizada.'); });
$('#priority-select').addEventListener('change', async event => { await api(`/api/conversations/${state.active.id}/routing`, { method: 'PATCH', body: JSON.stringify({ priority: event.target.value }) }); await loadConversations(); toast('Prioridade atualizada.'); });
$('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login.html'; });
$('#message').addEventListener('input', event => {
  event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
  previewQuickReplies(event.target.value);
  if (!event.target.value.trim() || !state.active) return;
  clearTimeout(state.typingTimer); state.typingTimer = setTimeout(() => api(`/api/conversations/${state.active.id}/typing`, { method: 'POST' }).catch(() => {}), 350);
});
$('#message').addEventListener('keydown', event => {
  const quickOpen = !$('#quick-replies-popover').classList.contains('hidden') && /^\/[^\s]*$/.test(event.currentTarget.value.trim());
  if (quickOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (!state.quickReplyMatches.length) return; const direction = event.key === 'ArrowDown' ? 1 : -1; state.quickReplyIndex = (state.quickReplyIndex + direction + state.quickReplyMatches.length) % state.quickReplyMatches.length; renderQuickReplies(state.quickReplyMatches, true); $('#quick-replies-popover [data-quick-index].keyboard-active')?.scrollIntoView({ block: 'nearest' }); return; }
  if (quickOpen && ['Enter', 'Tab'].includes(event.key) && state.quickReplyIndex >= 0) { event.preventDefault(); applyQuickReply(state.quickReplyMatches[state.quickReplyIndex]); return; }
  if (quickOpen && event.key === 'Escape') { event.preventDefault(); $('#quick-replies-popover').classList.add('hidden'); return; }
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#composer').requestSubmit(); }
});
$('#mobile-back').addEventListener('click', () => $('.app-shell').classList.remove('chat-open'));
$('#quick-replies-button').addEventListener('click', () => { const opening = $('#quick-replies-popover').classList.contains('hidden'); state.quickReplyIndex = -1; if (opening) renderQuickReplies(); $('#quick-replies-popover').classList.toggle('hidden', !opening); });
$('#quick-replies-popover').addEventListener('click', event => { if (event.target.closest('[data-add-quick-reply]')) { $('#quick-reply-form').reset(); $('#quick-reply-error').textContent = ''; $('#quick-replies-popover').classList.add('hidden'); openDialog('quick-reply-dialog'); requestAnimationFrame(() => $('#quick-reply-title').focus()); return; } const button = event.target.closest('[data-quick-id]'); if (!button) return; applyQuickReply(state.quickReplies.find(reply => reply.id === button.dataset.quickId)); });
$('#template-button').addEventListener('click', async () => {
  if (!state.active) return; openDialog('template-dialog'); $('#template-error').textContent = '';
  try {
    const data = await api('/api/templates'); state.templates = data.items;
    $('#template-select').innerHTML = '<option value="">Selecione um template</option>' + state.templates.map((item, index) => `<option value="${index}">${escapeHtml(item.name)} · ${escapeHtml(item.language)} · ${escapeHtml(item.category)}</option>`).join('');
    const preferred = state.templates.findIndex(item => item.name === 'pedido_recebido' && item.language === 'pt_BR');
    if (preferred >= 0) { $('#template-select').value = String(preferred); renderTemplateForm(state.templates[preferred]); }
  } catch (error) { $('#template-error').textContent = error.message; }
});
$('#attach-button').addEventListener('click', () => { if (state.active && windowOpen(state.active)) $('#media-input').click(); else toast('A janela de atendimento está encerrada.'); });
const acceptedPasteTypes = /^(image|audio|video)\//;
const acceptedDocumentTypes = ['application/pdf', 'text/plain', 'text/csv', 'application/zip', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'];
function validAttachment(file) { return file && file.size <= 20 * 1024 * 1024 && (acceptedPasteTypes.test(file.type) || acceptedDocumentTypes.includes(file.type)); }
function attachmentKind(file) { if (file.type.startsWith('image/')) return 'image'; if (file.type.startsWith('video/')) return 'video'; if (file.type.startsWith('audio/')) return 'audio'; if (file.type === 'application/pdf') return 'pdf'; return 'document'; }
function clearPasteObjectUrls() { state.pasteObjectUrls.forEach(URL.revokeObjectURL); state.pasteObjectUrls = []; }
function closePastePreview() { clearPasteObjectUrls(); state.pastedFiles = []; state.pastedFileIndex = 0; $('#paste-caption').value = ''; if ($('#paste-preview-dialog').open) $('#paste-preview-dialog').close(); }
function renderPastePreview() {
  clearPasteObjectUrls(); const file = state.pastedFiles[state.pastedFileIndex]; if (!file) return closePastePreview();
  const kind = attachmentKind(file); const url = URL.createObjectURL(file); state.pasteObjectUrls.push(url);
  $('#paste-file-info').textContent = `${file.name || 'Imagem colada'} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $('#paste-preview-stage').innerHTML = kind === 'image' ? `<img src="${url}" alt="Prévia de ${escapeHtml(file.name || 'imagem')}">` : kind === 'video' ? `<video src="${url}" controls></video>` : kind === 'audio' ? `<div class="paste-document-preview"><span>♫</span><strong>${escapeHtml(file.name)}</strong><audio src="${url}" controls></audio></div>` : kind === 'pdf' ? `<iframe src="${url}" title="Prévia do PDF"></iframe>` : `<div class="paste-document-preview"><span>▤</span><strong>${escapeHtml(file.name || 'Documento')}</strong><small>${escapeHtml(file.type || 'Arquivo')}</small></div>`;
  $('#paste-thumbnails').innerHTML = state.pastedFiles.map((item, index) => { const itemKind = attachmentKind(item); const thumbUrl = itemKind === 'image' ? URL.createObjectURL(item) : ''; if (thumbUrl) state.pasteObjectUrls.push(thumbUrl); return `<button type="button" class="paste-thumbnail ${index === state.pastedFileIndex ? 'active' : ''}" data-paste-index="${index}" title="${escapeHtml(item.name || 'Arquivo')}">${thumbUrl ? `<img src="${thumbUrl}" alt="">` : `<span>${itemKind === 'pdf' ? 'PDF' : itemKind === 'video' ? '▶' : itemKind === 'audio' ? '♫' : 'DOC'}</span>`}<i data-remove-paste="${index}">×</i></button>`; }).join('');
}
function openPastePreview(files) {
  if (!state.active) return toast('Selecione uma conversa antes de anexar.');
  if (!windowOpen(state.active)) return toast('A janela de atendimento está encerrada. Use um template aprovado.');
  const accepted = [...files].filter(validAttachment); const rejected = files.length - accepted.length;
  if (!accepted.length) return toast('Arquivo inválido ou maior que 20 MB.');
  state.pastedFiles.push(...accepted); state.pastedFileIndex = Math.max(0, state.pastedFiles.length - accepted.length); renderPastePreview(); if (!$('#paste-preview-dialog').open) $('#paste-preview-dialog').showModal(); $('#paste-caption').focus();
  if (rejected) toast(`${rejected} arquivo(s) não foram aceitos.`);
}
async function sendMediaFile(file, caption = '') { const form = new FormData(); form.append('file', file, file.name || `imagem-colada-${Date.now()}.png`); if (caption) form.append('caption', caption); return api(`/api/conversations/${state.active.id}/media`, { method: 'POST', body: form }); }
$('#message').addEventListener('paste', event => { const files = [...(event.clipboardData?.files || [])]; if (!files.length) return; event.preventDefault(); openPastePreview(files); });
$('#close-paste-preview').addEventListener('click', closePastePreview);
$('#paste-preview-dialog').addEventListener('cancel', event => { event.preventDefault(); closePastePreview(); });
$('#add-paste-files').addEventListener('click', () => $('#paste-files-input').click());
$('#paste-files-input').addEventListener('change', event => { if (event.target.files?.length) openPastePreview([...event.target.files]); event.target.value = ''; });
$('#paste-thumbnails').addEventListener('click', event => { const remove = event.target.closest('[data-remove-paste]'); if (remove) { event.stopPropagation(); const index = Number(remove.dataset.removePaste); state.pastedFiles.splice(index, 1); state.pastedFileIndex = Math.min(state.pastedFileIndex, state.pastedFiles.length - 1); renderPastePreview(); return; } const thumb = event.target.closest('[data-paste-index]'); if (thumb) { state.pastedFileIndex = Number(thumb.dataset.pasteIndex); renderPastePreview(); } });
$('#paste-caption').addEventListener('keydown', event => { if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); $('#send-paste-files').click(); } });
$('#send-paste-files').addEventListener('click', async () => {
  if (!state.pastedFiles.length || !state.active) return; const button = $('#send-paste-files'); button.disabled = true; const caption = $('#paste-caption').value.trim(); let sent = 0;
  try { for (const file of state.pastedFiles) { await sendMediaFile(file, caption); sent += 1; } closePastePreview(); await Promise.all([loadMessages(), loadConversations()]); toast(sent > 1 ? `${sent} arquivos enviados.` : 'Arquivo enviado.'); }
  catch (error) { if (sent) state.pastedFiles.splice(0, sent); renderPastePreview(); toast(error.message); } finally { button.disabled = false; }
});
$('#media-input').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file || !state.active) return;
  const caption = $('#message').value.trim();
  $('#attach-button').disabled = true;
  try { await sendMediaFile(file, caption); $('#message').value = ''; await Promise.all([loadMessages(), loadConversations()]); toast('Arquivo enviado.'); }
  catch (error) { toast(error.message); } finally { event.target.value = ''; $('#attach-button').disabled = false; }
});
$('#add-note').addEventListener('click', () => { if (state.active) openDialog('note-dialog'); });
$('#add-tag').addEventListener('click', () => { if (state.active) openDialog('tag-dialog'); });
$('#edit-contact').addEventListener('click', () => { if (!state.active) return; $('#contact-name').value = displayName(state.active); openDialog('contact-dialog'); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$('#assign-form').addEventListener('submit', async event => { event.preventDefault(); const id = state.assignmentConversationId || state.active?.id; if (!id) return; await api(`/api/conversations/${id}/assign`, { method: 'POST', body: JSON.stringify({ userId: $('#agent-select').value || null }) }); closeDialog('assign-dialog'); state.assignmentConversationId = null; await loadConversations(); if (state.active?.id === id) await openConversation(id); toast('Atendimento transferido.'); });
$('#note-form').addEventListener('submit', async event => { event.preventDefault(); await api(`/api/conversations/${state.active.id}/notes`, { method: 'POST', body: JSON.stringify({ body: $('#note-body').value }) }); $('#note-body').value = ''; closeDialog('note-dialog'); await loadNotes(); toast('Anotação salva.'); });
$('#tag-form').addEventListener('submit', async event => { event.preventDefault(); const name = $('#tag-name').value.trim().toLowerCase(); const names = [...new Set([...state.tags.map(tag => tag.name), name])]; await api(`/api/conversations/${state.active.id}/tags`, { method: 'PUT', body: JSON.stringify({ names }) }); $('#tag-name').value = ''; closeDialog('tag-dialog'); await Promise.all([loadTags(), loadConversations()]); toast('Etiqueta adicionada.'); });
$('#tag-list').addEventListener('click', async event => { const button = event.target.closest('[data-remove-tag]'); if (!button) return; const names = state.tags.map(tag => tag.name).filter(name => name !== button.dataset.removeTag); await api(`/api/conversations/${state.active.id}/tags`, { method: 'PUT', body: JSON.stringify({ names }) }); await Promise.all([loadTags(), loadConversations()]); });
$('#contact-form').addEventListener('submit', async event => { event.preventDefault(); await api(`/api/conversations/${state.active.id}/contact`, { method: 'PATCH', body: JSON.stringify({ name: $('#contact-name').value }) }); closeDialog('contact-dialog'); await loadConversations(); await openConversation(state.active.id); toast('Contato atualizado.'); });
$('#quick-reply-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true; $('#quick-reply-error').textContent = '';
  let shortcut = $('#quick-reply-shortcut').value.trim().toLowerCase(); if (!shortcut.startsWith('/')) shortcut = `/${shortcut}`;
  try { const item = await api('/api/quick-replies', { method: 'POST', body: JSON.stringify({ title: $('#quick-reply-title').value, shortcut, body: $('#quick-reply-body').value }) }); state.quickReplies.push(item); renderQuickReplies(); closeDialog('quick-reply-dialog'); toast('Mensagem rápida adicionada.'); }
  catch (error) { $('#quick-reply-error').textContent = error.message; } finally { submit.disabled = false; }
});
$('#new-contact-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true; $('#new-contact-error').textContent = '';
  try {
    const contact = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: $('#new-contact-name').value, countryCode: $('#new-contact-country').value, phone: $('#new-contact-phone').value }) });
    closeDialog('new-contact-dialog'); if (!state.conversations.some(item => item.id === contact.id)) state.conversations.unshift(contact);
    await openConversation(contact.id); toast('Contato adicionado.');
  } catch (error) { $('#new-contact-error').textContent = error.message; }
  finally { submit.disabled = false; }
});
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
  const header = template.components?.find(component => component.type === 'HEADER')?.text || '';
  const body = template.components?.find(component => component.type === 'BODY')?.text || '';
  const footer = template.components?.find(component => component.type === 'FOOTER')?.text || '';
  const buttons = template.components?.find(component => component.type === 'BUTTONS')?.buttons || [];
  const fields = [];
  for (const component of template.components || []) {
    if (!['BODY', 'HEADER'].includes(component.type) || typeof component.text !== 'string') continue;
    const indexes = [...component.text.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
    for (const index of [...new Set(indexes)].sort((a, b) => a - b)) {
      const orderField = template.name === 'pedido_recebido' && component.type === 'BODY';
      const label = orderField ? (index === 1 ? 'Nome do cliente' : index === 2 ? 'Número do pedido' : `Variável ${index}`) : `Variável ${index} · ${component.type.toLowerCase()}`;
      const value = orderField && index === 1 ? displayName(state.active) : '';
      const placeholder = orderField && index === 2 ? 'Ex.: nº 12345' : `Valor de {{${index}}}`;
      fields.push(`<label>${label}<input data-template-component="${component.type}" data-variable-index="${index}" value="${escapeHtml(value)}" required placeholder="${escapeHtml(placeholder)}"></label>`);
    }
  }
  $('#template-variables').innerHTML = fields.join('');
  $('#template-preview').dataset.header = header; $('#template-preview').dataset.body = body; $('#template-preview').dataset.footer = footer;
  $('#template-preview').dataset.buttons = JSON.stringify(buttons); updateTemplatePreview(); $('#template-preview').classList.remove('hidden');
}

function updateTemplatePreview() {
  const preview = $('#template-preview'); let body = preview.dataset.body || '';
  document.querySelectorAll('[data-template-component="BODY"]').forEach(input => { body = body.replaceAll(`{{${input.dataset.variableIndex}}}`, input.value || `{{${input.dataset.variableIndex}}}`); });
  const buttons = JSON.parse(preview.dataset.buttons || '[]');
  preview.innerHTML = `${preview.dataset.header ? `<strong>${escapeHtml(preview.dataset.header)}</strong>` : ''}<p>${escapeHtml(body).replaceAll('\n', '<br>')}</p>${preview.dataset.footer ? `<small>${escapeHtml(preview.dataset.footer)}</small>` : ''}${buttons.length ? `<div class="template-preview-buttons">${buttons.map(button => `<span>${escapeHtml(button.text || 'Abrir')}</span>`).join('')}</div>` : ''}`;
}
$('#template-variables').addEventListener('input', updateTemplatePreview);

function connectEvents() {
  const source = new EventSource('/api/events');
  source.onmessage = async event => {
    const data = JSON.parse(event.data); if (data.type === 'ready') return;
    if (data.type === 'message' && data.direction === 'inbound') void playNotificationSound();
    await loadConversations();
    if (state.active && (!data.conversationId || data.conversationId === state.active.id)) {
      await loadMessages();
      if (data.type === 'note') await loadNotes();
      if (data.type === 'conversation') await loadTags();
    }
  };
}

init().catch(error => toast(error.message));
setInterval(renderContactActivity, 30000);
