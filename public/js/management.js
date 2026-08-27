import { api } from './api.js';
const $ = selector => document.querySelector(selector);
const state = { me: null, users: [], teams: [] };
const escapeHtml = value => { const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML; };
const formatSeconds = seconds => !seconds ? 'Sem dados' : seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`;
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
    ['Conversas ativas', Number(s.newCount || 0) + Number(s.openCount || 0) + Number(s.pendingCount || 0), `${s.unreadCount || 0} mensagens não lidas`, ''],
    ['Novas', s.newCount || 0, 'Aguardando atendimento', ''], ['SLA vencido', s.slaBreached || 0, 'Primeira resposta atrasada', 'danger'],
    ['Resposta média', formatSeconds(data.averageFirstResponseSeconds), 'Tempo até primeira resposta', '']
  ].map(([label, value, help, kind]) => `<article class="metric-card ${kind}"><span>${label}</span><strong>${value}</strong><small>${help}</small></article>`).join('');
  $('#agent-performance').innerHTML = data.agents.length ? data.agents.map(agent => `<div class="data-row"><div><strong>${escapeHtml(agent.name)}</strong><small>${agent.conversations} conversas</small></div><div class="data-number"><strong>${agent.openCount || 0}</strong><small>abertas</small></div><div class="data-number"><strong>${agent.slaBreached || 0}</strong><small>SLA</small></div></div>`).join('') : '<div class="empty">Sem atendentes.</div>';
  $('#team-performance').innerHTML = data.teams.length ? data.teams.map(team => `<div class="data-row"><div><strong><i class="team-color" style="background:${team.color}"></i> ${escapeHtml(team.name)}</strong><small>${team.conversations} conversas</small></div><div class="data-number"><strong>${team.activeCount || 0}</strong><small>ativas</small></div></div>`).join('') : '<div class="empty">Sem equipes.</div>';
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

document.querySelectorAll('.management-tab').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.management-tab').forEach(item => item.classList.remove('active')); button.classList.add('active'); document.querySelectorAll('.management-content').forEach(item => item.classList.add('hidden')); $(`#tab-${button.dataset.tab}`).classList.remove('hidden'); $('#page-title').textContent = button.textContent; }));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$('#new-user').addEventListener('click', () => openDialog('user-dialog')); $('#new-team').addEventListener('click', () => { renderMemberOptions(); openDialog('team-dialog'); });
$('#user-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/management/users', { method: 'POST', body: JSON.stringify({ name: $('#user-name').value, email: $('#user-email').value, password: $('#user-password').value, role: $('#user-role').value }) }); event.target.reset(); closeDialog('user-dialog'); await loadUsers(); toast('Usuário criado.'); } catch (error) { toast(error.message); } });
$('#users-table').addEventListener('click', async event => { const button = event.target.closest('[data-toggle-user]'); if (!button) return; try { await api(`/api/management/users/${button.dataset.toggleUser}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1' }) }); await loadUsers(); toast('Usuário atualizado.'); } catch (error) { toast(error.message); } });
$('#team-form').addEventListener('submit', async event => { event.preventDefault(); const memberIds = [...document.querySelectorAll('#team-members input:checked')].map(input => input.value); try { await api('/api/management/teams', { method: 'POST', body: JSON.stringify({ name: $('#team-name').value, color: $('#team-color').value, memberIds }) }); event.target.reset(); $('#team-color').value = '#6657e8'; closeDialog('team-dialog'); await Promise.all([loadTeams(), loadDashboard()]); toast('Equipe criada.'); } catch (error) { toast(error.message); } });
$('#sla-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/management/sla', { method: 'PUT', body: JSON.stringify({ firstResponseMinutes: Number($('#sla-first').value), resolutionMinutes: Number($('#sla-resolution').value) }) }); toast('Política de SLA atualizada.'); } catch (error) { toast(error.message); } });
init().catch(error => toast(error.message));
