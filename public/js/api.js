export async function api(url, options = {}) {
  const { skipAuthRedirect = false, ...fetchOptions } = options;
  const response = await fetch(url, {
    ...fetchOptions,
    headers: { ...(fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...fetchOptions.headers }
  });
  if (response.status === 401 && !skipAuthRedirect) {
    if (location.pathname !== '/login.html') location.replace('/login.html');
    throw new Error('Sessão expirada.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a operação.');
  return data;
}
