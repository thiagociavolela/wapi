import { api } from './api.js';
const $ = selector => document.querySelector(selector);
const SYSTEM_TIME_ZONE = 'America/Sao_Paulo';
const state = { me: null, users: [], teams: [] };
const escapeHtml = value => { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; };
const formatSeconds = seconds => !seconds ? 'Sem dados' : seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
const number = value => Number(value || 0);
const shortTime = value => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3000); }
function openDialog(id) { $(`#${id}`).showModal(); } function closeDialog(id) { $(`#${id}`).close(); }

async function init() {
  state.me = (await api('/api/auth/me')).user; $('#manager-profile').textContent = `${state.me.name} · ${state.me.role}`;
  await Promise.all([loadDashboard(), loadTeams(), loadSla()]);
  if (state.me.role !== 'agent') await loadUsers();
  else { $('#new-user').classList.add('hidden'); $('#new-team').classList.add('hidden'); }
}

async function loadDashboard() {
  const data = await api('/api/management/dashboard'); const s = data.summary || {};
  $('#metric-grid').innerHTML = [
    ['Total de conversas', number(s.total), `${number(s.everRespondedCount)} já receberam resposta`, 'purple', '⌁'],
    ['Conversas ativas', number(s.newCount) + number(s.openCount) + number(s.pendingCount), `${number(s.unreadCount)} mensagens não lidas`, 'green', '●'],
    ['Recebidas hoje', number(data.messageSummary?.conversationsReceivedToday), `${number(data.messageSummary?.inboundToday)} mensagens recebidas`, 'purple', '↓'],
    ['Respondidas hoje', number(data.messageSummary?.conversationsAnsweredToday), `${number(data.messageSummary?.outboundToday)} mensagens enviadas`, 'green', '↑'],
    ['Resolvidas hoje', number(s.resolvedToday), `${number(s.resolvedCount)} resolvidas no total`, 'green', '✓'],
    ['Janelas abertas', number(s.windowOpenCount), `${number(s.windowExpiringCount)} vencem em até 2 horas`, 'amber', '◷'],
    ['SLA vencido', number(s.slaBreached), 'Primeira resposta atrasada', 'danger', '!'],
    ['Resposta média', formatSeconds(data.averageFirstResponseSeconds), `${number(data.messageSummary?.messagesToday)} mensagens hoje`, 'purple', '↗']
  ].map(([label, value, help, kind, icon]) => `<article class="metric-card ${kind}"><div class="metric-top"><span>${label}</span><i>${icon}</i></div><strong>${value}</strong><small>${help}</small></article>`).join('');
  renderMessageChart(data.dailyMessages || [], number(data.messageSummary?.messagesSevenDays));
  renderWindowHealth(s); renderDistributions(s, data.priorities || []); renderAttention(data.recent || []);
  $('#agent-performance').innerHTML = data.agents.length ? data.agents.map(agent => `<div class="data-row"><div><strong>${escapeHtml(agent.name)}</strong><small>${agent.conversations} conversas</small></div><div class="data-number"><strong>${agent.openCount || 0}</strong><small>abertas</small></div><div class="data-number"><strong>${agent.slaBreached || 0}</strong><small>SLA</small></div></div>`).join('') : '<div class="empty">Sem atendentes.</div>';
  $('#team-performance').innerHTML = data.teams.length ? data.teams.map(team => `<div class="data-row"><div><strong><i class="team-color" style="background:${team.color}"></i> ${escapeHtml(team.name)}</strong><small>${team.conversations} conversas</small></div><div class="data-number"><strong>${team.activeCount || 0}</strong><small>ativas</small></div></div>`).join('') : '<div class="empty">Sem equipes.</div>';
  $('#dashboard-updated').textContent = `Atualizado às ${shortTime(data.generatedAt)}`;
}

function renderMessageChart(items, total) {
  const byDay = new Map(items.map(item => [String(item.day).slice(0, 10), item])); const keyFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: SYSTEM_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }); const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(Date.now() - (6 - index) * 86400000); const key = keyFormatter.format(date); return { date, ...(byDay.get(key) || { inbound: 0, outbound: 0 }) }; });
  const values = days.flatMap(item => [number(item.inbound), number(item.outbound)]); const max = Math.max(1, ...values);
  $('#messages-week-total').textContent = `${total} mensagens`;
  $('#message-chart').innerHTML = days.map(item => `<div class="chart-day"><div class="chart-bars"><i class="bar-inbound" style="height:${Math.max(5, number(item.inbound) / max * 100)}%" title="${number(item.inbound)} recebidas"></i><i class="bar-outbound" style="height:${Math.max(5, number(item.outbound) / max * 100)}%" title="${number(item.outbound)} enviadas"></i></div><span>${new Intl.DateTimeFormat('pt-BR', { timeZone: SYSTEM_TIME_ZONE, weekday: 'short' }).format(item.date).replace('.', '')}</span></div>`).join('');
}

function renderWindowHealth(summary) {
  const open = number(summary.windowOpenCount), expiring = number(summary.windowExpiringCount), expired = number(summary.windowExpiredCount), total = Math.max(1, open + expired);
  const openPercent = Math.round(open / total * 100), stable = Math.max(0, open - expiring), stablePercent = stable / total * 100, warningPercent = expiring / total * 100;
  $('#window-health').innerHTML = `<div class="health-ring" style="--open:${stablePercent * 3.6}deg;--warning:${Math.min(360, (stablePercent + warningPercent) * 3.6)}deg"><div><strong>${openPercent}%</strong><span>abertas</span></div></div><div class="health-list"><p><i class="green"></i><span>Abertas</span><strong>${open}</strong></p><p><i class="amber"></i><span>Vencem em até 2h</span><strong>${expiring}</strong></p><p><i class="gray"></i><span>Encerradas</span><strong>${expired}</strong></p></div>`;
}

function distributionRow(label, value, total, kind) { return `<div class="distribution-row"><div><span>${label}</span><strong>${value}</strong></div><div class="progress"><i class="${kind}" style="width:${total ? Math.max(3, value / total * 100) : 0}%"></i></div></div>`; }
function renderDistributions(summary, priorities) {
  const statuses = [['Novas', number(summary.newCount), 'purple'], ['Em atendimento', number(summary.openCount), 'green'], ['Pendentes', number(summary.pendingCount), 'amber'], ['Resolvidas', number(summary.resolvedCount), 'gray']]; const statusTotal = statuses.reduce((sum, item) => sum + item[1], 0);
  $('#status-distribution').innerHTML = statuses.map(item => distributionRow(item[0], item[1], statusTotal, item[2])).join('');
  const priorityMap = Object.fromEntries(priorities.map(item => [item.priority, number(item.total)])); const priorityItems = [['Urgente', priorityMap.urgent || 0, 'danger'], ['Alta', priorityMap.high || 0, 'amber'], ['Normal', priorityMap.normal || 0, 'purple'], ['Baixa', priorityMap.low || 0, 'green']]; const priorityTotal = priorityItems.reduce((sum, item) => sum + item[1], 0);
  $('#priority-distribution').innerHTML = priorityItems.map(item => distributionRow(item[0], item[1], priorityTotal, item[2])).join('');
}

function renderAttention(items) {
  const statusNames = { new: 'Nova', open: 'Em atendimento', pending: 'Pendente', resolved: 'Resolvida' };
  $('#attention-list').innerHTML = items.length ? items.map(item => `<a class="attention-row" href="/?conversation=${item.id}"><span class="attention-avatar">${escapeHtml((item.contactName || '?').slice(0, 2).toUpperCase())}</span><span class="attention-contact"><strong>${escapeHtml(item.contactName)}</strong><small>${escapeHtml(item.phone)}</small></span><span class="status-pill ${item.status}">${statusNames[item.status] || escapeHtml(item.status)}</span><span class="priority-pill ${item.priority}">${escapeHtml(item.priority)}</span><span class="attention-agent">${escapeHtml(item.assignedUserName || 'Não atribuído')}</span><span class="attention-time">${shortTime(item.lastMessageAt)}</span>${number(item.unreadCount) ? `<b class="attention-unread">${number(item.unreadCount)}</b>` : ''}</a>`).join('') : '<div class="empty">Nenhuma conversa registrada.</div>';
}

async function loadUsers() {
  const data = await api('/api/management/users'); state.users = data.items;
  $('#users-table').innerHTML = state.users.map(user => `<tr><td><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></td><td><span class="role-badge">${escapeHtml(user.role)}</span></td><td>${escapeHtml((user.teamNames || '').split('||').filter(Boolean).join(', ') || '—')}</td><td><span class="active-badge ${user.active ? '' : 'inactive'}">${user.active ? 'Ativo' : 'Inativo'}</span></td><td><button class="row-action" data-toggle-user="${user.id}" data-active="${user.active ? '1' : '0'}">${user.active ? 'Desativar' : 'Ativar'}</button></td></tr>`).join('');
  renderMemberOptions();
}

async function loadTeams() {
  const data = await api('/api/management/teams'); state.teams = data.items;
  $('#teams-grid').innerHTML = state.teams.map(team => `<article class="team-card"><div class="team-card-header"><span class="team-color" style="background:${team.color}"></span><h3>${escapeHtml(team.name)}</h3></div><p>${team.memberCount} membros · ${team.active ? 'Ativa' : 'Inativa'}</p></article>`).join('');
}

async function loadSla() { const data = await api('/api/management/sla'); $('#sla-first').value = data.firstResponseMinutes; $('#sla-resolution').value = data.resolutionMinutes; }
function renderMemberOptions() { $('#team-members').innerHTML = state.users.filter(user => user.active).map(user => `<label><input type="checkbox" value="${user.id}">${escapeHtml(user.name)}</label>`).join('') || '<span class="detail-empty">Crie usuários primeiro.</span>'; }

function activateManagementTab(tab) {
  const button = document.querySelector(`.management-tab[data-tab="${tab}"]`) || document.querySelector('.management-tab'); if (!button) return;
  document.querySelectorAll('.management-tab').forEach(item => item.classList.toggle('active', item === button)); document.querySelectorAll('.management-content').forEach(item => item.classList.add('hidden')); $(`#tab-${button.dataset.tab}`).classList.remove('hidden'); $('#page-title').textContent = button.textContent;
}
document.querySelectorAll('.management-tab').forEach(button => button.addEventListener('click', () => { activateManagementTab(button.dataset.tab); history.replaceState(null, '', `#${button.dataset.tab}`); }));
activateManagementTab(location.hash.slice(1));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$('#new-user').addEventListener('click', () => openDialog('user-dialog')); $('#new-team').addEventListener('click', () => { renderMemberOptions(); openDialog('team-dialog'); });
$('#user-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/management/users', { method: 'POST', body: JSON.stringify({ name: $('#user-name').value, email: $('#user-email').value, password: $('#user-password').value, role: $('#user-role').value }) }); event.target.reset(); closeDialog('user-dialog'); await loadUsers(); toast('Usuário criado.'); } catch (error) { toast(error.message); } });
$('#users-table').addEventListener('click', async event => { const button = event.target.closest('[data-toggle-user]'); if (!button) return; try { await api(`/api/management/users/${button.dataset.toggleUser}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1' }) }); await loadUsers(); toast('Usuário atualizado.'); } catch (error) { toast(error.message); } });
$('#team-form').addEventListener('submit', async event => { event.preventDefault(); const memberIds = [...document.querySelectorAll('#team-members input:checked')].map(input => input.value); try { await api('/api/management/teams', { method: 'POST', body: JSON.stringify({ name: $('#team-name').value, color: $('#team-color').value, memberIds }) }); event.target.reset(); $('#team-color').value = '#6657e8'; closeDialog('team-dialog'); await Promise.all([loadTeams(), loadDashboard()]); toast('Equipe criada.'); } catch (error) { toast(error.message); } });
$('#sla-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/management/sla', { method: 'PUT', body: JSON.stringify({ firstResponseMinutes: Number($('#sla-first').value), resolutionMinutes: Number($('#sla-resolution').value) }) }); toast('Política de SLA atualizada.'); } catch (error) { toast(error.message); } });
$('#refresh-dashboard').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await loadDashboard(); toast('Indicadores atualizados.'); } catch (error) { toast(error.message); } finally { event.currentTarget.disabled = false; } });
init().catch(error => toast(error.message));
