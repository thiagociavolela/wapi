const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const dismissedKey = 'central.install.dismissed';
let installPrompt = null;
let banner = null;

function hideBanner() {
  banner?.remove();
  banner = null;
}

function showBanner() {
  if (installed() || banner || localStorage.getItem(dismissedKey)) return;
  if (!isIos && !installPrompt) return;
  banner = document.createElement('aside');
  banner.className = 'install-banner';
  banner.setAttribute('aria-label', 'Instalar aplicativo');
  banner.innerHTML = `<img src="/images/favicon.png" alt="" width="44" height="44"><div class="install-banner-copy"><strong>Use o Atendimento Wapi como aplicativo</strong><span>${isIos ? 'No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.' : 'Acesse o Atendimento Wapi direto da tela inicial do seu dispositivo.'}</span></div><button class="install-action" type="button">${isIos ? 'Como instalar' : 'Instalar'}</button><button class="install-dismiss" type="button" aria-label="Dispensar convite">×</button>`;
  document.body.append(banner);
  banner.querySelector('.install-dismiss').addEventListener('click', () => {
    localStorage.setItem(dismissedKey, 'yes');
    hideBanner();
  });
  banner.querySelector('.install-action').addEventListener('click', async () => {
    if (isIos) {
      banner.querySelector('.install-banner-copy span').textContent = 'Safari: toque no ícone Compartilhar (quadrado com seta para cima), selecione Adicionar à Tela de Início e confirme em Adicionar.';
      return;
    }
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') hideBanner();
    else hideBanner();
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  showBanner();
});
window.addEventListener('appinstalled', hideBanner);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (isIos) showBanner();
