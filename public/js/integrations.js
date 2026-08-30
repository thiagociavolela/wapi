import { api } from './api.js';
const $ = selector => document.querySelector(selector); const SYSTEM_TIME_ZONE = 'America/Sao_Paulo';
const state = { items: [], templates: [], page: 1, pages: 1, loading: false };
const escapeHtml = value => { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; };
const number = value => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
const dateTime = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const shortDate = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, day: '2-digit', month: 'short' }).format(new Date(value)).replace('.', '') : '—';
const shortTime = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
const statusNames = { pending: 'Agendada', processing: 'Processando', sent: 'Enviada', failed: 'Falhou', cancelled: 'Cancelada', queued: 'Na fila', delivered: 'Entregue', read: 'Lida' };
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3000); }

async function init() { const me = (await api('/api/auth/me')).user; $('#profile').textContent = `${me.name} · ${me.role}`; await loadDashboard(); }
function query() { const params = new URLSearchParams({ page: String(state.page), limit: '30' }); const values = { search: $('#filter-search').value.trim(), status: $('#filter-status').value, template: $('#filter-template').value, from: $('#filter-from').value, to: $('#filter-to').value }; Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); }); return params; }
async function loadDashboard() {
  if (state.loading) return; state.loading = true; $('#refresh').disabled = true;
  try { const data = await api(`/api/management/integrations?${query()}`); state.items = data.items; state.templates = data.templates; state.page = data.pagination.page; state.pages = data.pagination.pages; render(data); }
  catch (error) { toast(error.message); } finally { state.loading = false; $('#refresh').disabled = false; }
}
function render(data) { renderMetrics(data.summary || {}); renderChart(data.daily || []); renderTemplates(data.templates || []); renderUpcoming(data.upcoming || []); renderRecords(data.items || [], data.pagination); $('#last-updated').textContent = `Atualizado às ${shortTime(data.generatedAt)}`; }
function renderMetrics(summary) {
  const average = Number(summary.averageProcessingSeconds || 0); const processingLabel = average < 60 ? `${average}s em média` : `${Math.round(average / 60)} min em média`;
  const cards = [
    ['Total solicitado', summary.total, `${number(summary.createdToday)} recebidos hoje`, 'purple', '↗'],
    ['Agendamentos', summary.scheduled, `${number(summary.next24Hours)} nas próximas 24h`, 'amber', '◷'],
    ['Enviadas', summary.sent, processingLabel, 'green', '✓'],
    ['Em processamento', Number(summary.pending || 0) + Number(summary.processing || 0), `${number(summary.processing)} sendo processadas`, 'purple', '↻'],
    ['Entregues', summary.delivered, 'Confirmadas pela Meta', 'green', '⇣'],
    ['Lidas', summary.messageRead, 'Visualizadas pelos clientes', 'green', '✓✓'],
    ['Falhas', summary.failed, 'Verifique os detalhes abaixo', 'danger', '!'],
    ['Canceladas', summary.cancelled, 'Agendamentos interrompidos', 'neutral', '×']
  ];
  $('#metrics').innerHTML = cards.map(([label, value, help, kind, icon]) => `<article class="integration-metric ${kind}"><header><span>${label}</span><i>${icon}</i></header><strong>${number(value)}</strong><small>${help}</small></article>`).join('');
}
function renderChart(items) {
  const byDay = new Map(items.map(item => [String(item.day).slice(0, 10), item])); const key = date => new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const days = Array.from({ length: 14 }, (_, index) => { const date = new Date(Date.now() - (13 - index) * 86400000); return { date, ...(byDay.get(key(date)) || { created: 0, sent: 0, failed: 0 }) }; }); const max = Math.max(1, ...days.flatMap(item => [Number(item.created), Number(item.sent), Number(item.failed)]));
  $('#period-total').textContent = `${number(days.reduce((sum, item) => sum + Number(item.created), 0))} solicitações`;
  $('#daily-chart').innerHTML = days.map(item => `<div class="daily-day"><div class="daily-bars"><i class="created" style="height:${Math.max(3, Number(item.created) / max * 100)}%" title="${number(item.created)} solicitados"></i><i class="sent" style="height:${Math.max(3, Number(item.sent) / max * 100)}%" title="${number(item.sent)} enviados"></i><i class="failed" style="height:${Number(item.failed) ? Math.max(3, Number(item.failed) / max * 100) : 0}%" title="${number(item.failed)} falhas"></i></div><span>${shortDate(item.date)}</span></div>`).join('');
}
function renderTemplates(items) {
  const max = Math.max(1, ...items.map(item => Number(item.total))); $('#template-ranking').innerHTML = items.length ? items.map(item => `<div class="template-row"><div><strong>${escapeHtml(item.template)}</strong><small>${number(item.total)}</small></div><div class="template-progress"><i style="width:${Number(item.total) / max * 100}%"></i></div><div class="template-status"><span class="ok">${number(item.sent)} enviadas</span><span>${number(item.pending)} pendentes</span>${Number(item.failed) ? `<span class="error">${number(item.failed)} falhas</span>` : ''}</div></div>`).join('') : '<div class="integration-empty">Nenhum template enviado.</div>';
  const selected = $('#filter-template').value; $('#filter-template').innerHTML = '<option value="">Todos os templates</option>' + items.map(item => `<option value="${escapeHtml(item.template)}">${escapeHtml(item.template)} (${number(item.total)})</option>`).join(''); $('#filter-template').value = selected;
}
function renderUpcoming(items) { $('#upcoming-list').innerHTML = items.length ? items.map(item => `<a class="upcoming-row" href="/?conversation=${item.conversationId}"><span class="upcoming-time"><strong>${shortTime(item.scheduledFor)}</strong>${shortDate(item.scheduledFor)}</span><span class="upcoming-copy"><strong>${escapeHtml(item.contactName)}</strong><small>${escapeHtml(item.template)} · ${escapeHtml(item.phone)}</small></span></a>`).join('') : '<div class="integration-empty">Nenhum envio programado.</div>'; }
function renderRecords(items, pagination) {
  $('#result-count').textContent = `${number(pagination.total)} registros`;
  $('#records-body').innerHTML = items.length ? items.map(item => `<tr data-record-id="${item.id}"><td><div class="record-contact"><strong>${escapeHtml(item.contactName)}</strong><small>${escapeHtml(item.phone)}${item.externalId ? ` · #${escapeHtml(item.externalId)}` : ''}</small></div></td><td><div class="record-template"><strong>${escapeHtml(item.template)}</strong><small>${escapeHtml(item.language)}</small></div></td><td><span class="record-time">${dateTime(item.createdAt)}</span></td><td><span class="record-time"><strong>${dateTime(item.scheduledFor)}</strong><small>${item.sentAt ? `Enviada ${dateTime(item.sentAt)}` : 'Aguardando envio'}</small></span></td><td><span class="record-status ${item.status}">${statusNames[item.status] || escapeHtml(item.status)}</span></td><td><span class="record-status ${item.deliveryStatus}">${statusNames[item.deliveryStatus] || escapeHtml(item.deliveryStatus)}</span></td><td>${number(item.attempts)}</td><td><button class="record-action" type="button">Detalhes</button></td></tr>`).join('') : '<tr><td colspan="8" class="loading-cell">Nenhum envio encontrado com esses filtros.</td></tr>';
  $('#page-info').textContent = `Página ${pagination.page} de ${pagination.pages}`; $('#previous-page').disabled = pagination.page <= 1; $('#next-page').disabled = pagination.page >= pagination.pages;
}
function openDetail(item) {
  const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata || '{}') : (item.metadata || {}); $('#detail-title').textContent = `${item.template} · ${item.contactName}`; $('#open-conversation').href = `/?conversation=${item.conversationId}`;
  const fields = [['Contato', `${item.contactName} · ${item.phone}`], ['Pedido/ID externo', item.externalId || 'Não informado'], ['Job', statusNames[item.status] || item.status], ['Entrega', statusNames[item.deliveryStatus] || item.deliveryStatus], ['Solicitado', dateTime(item.createdAt)], ['Agendado', dateTime(item.scheduledFor)], ['Enviado', dateTime(item.sentAt)], ['Entregue', dateTime(item.deliveredAt)], ['Lido', dateTime(item.readAt)], ['Tentativas', item.attempts], ['Idioma', item.language], ['wamid', item.wamid || 'Ainda não gerado']];
  $('#detail-content').innerHTML = `<div class="detail-grid">${fields.map(([label, value]) => `<div class="detail-field"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div><div class="detail-message"><span>Mensagem registrada</span><p>${escapeHtml(item.textBody || 'Sem conteúdo')}</p></div>${item.errorMessage ? `<div class="detail-error"><strong>Falha:</strong> ${escapeHtml(item.errorMessage)}</div>` : ''}${Object.keys(metadata).length ? `<pre class="detail-metadata">${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>` : ''}`; $('#message-detail').showModal();
}
$('#filters').addEventListener('submit', event => { event.preventDefault(); state.page = 1; loadDashboard(); }); $('#clear-filters').addEventListener('click', () => { $('#filters').reset(); state.page = 1; loadDashboard(); }); $('#refresh').addEventListener('click', loadDashboard); $('#previous-page').addEventListener('click', () => { if (state.page > 1) { state.page -= 1; loadDashboard(); } }); $('#next-page').addEventListener('click', () => { if (state.page < state.pages) { state.page += 1; loadDashboard(); } });
$('#records-body').addEventListener('click', event => { const row = event.target.closest('[data-record-id]'); if (!row) return; const item = state.items.find(entry => entry.id === row.dataset.recordId); if (item) openDetail(item); }); $('#close-detail').addEventListener('click', () => $('#message-detail').close()); $('#message-detail').addEventListener('click', event => { if (event.target === $('#message-detail')) $('#message-detail').close(); });
init().catch(error => toast(error.message));
