import { api } from './api.js';
const form = document.querySelector('#login-form');
const error = document.querySelector('#error');
const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
api('/api/auth/me', { skipAuthRedirect: true }).then(() => location.replace('/')).catch(() => {});
form.addEventListener('submit', async (event) => {
  event.preventDefault(); error.textContent = '';
  const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Entrando…';
  try {
    await api('/api/auth/login', {
      method: 'POST',
      skipAuthRedirect: true,
      body: JSON.stringify({
        email: emailInput.value.trim().toLowerCase(),
        password: passwordInput.value
      })
    });
    location.href = '/';
  } catch (reason) { error.textContent = reason.message; button.disabled = false; button.textContent = 'Entrar'; }
});
