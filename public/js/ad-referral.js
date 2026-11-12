function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function adReferralCard(item) {
  const content = typeof item.content === 'string' ? JSON.parse(item.content || '{}') : (item.content || {});
  const referral = content.referral;
  if (!referral || typeof referral !== 'object' || Array.isArray(referral)) return '';
  const link = safeUrl(referral.source_url);
  const isInstagram = link && /(^|\.)instagram\.com$/i.test(new URL(link).hostname);
  const image = safeUrl(referral.image_url || referral.thumbnail_url);
  const headline = String(referral.headline || '').trim();
  const title = headline && !/^(https?:\/\/)?(www\.)?(api\.)?whatsapp\.com\/?$/i.test(headline) ? headline : 'Anúncio que iniciou esta conversa';
  const label = referral.source_type === 'post' ? 'Publicação de origem' : 'Anúncio de origem';
  return `<section class="ad-referral-card" aria-label="${label}">
    <div class="ad-referral-label">${label}${isInstagram && referral.source_type !== 'post' ? '<br><strong>Anúncio do Instagram @provida.far</strong>' : ''}</div>
    ${image ? `<img class="ad-referral-image" src="${escapeHtml(image)}" alt="Imagem do anúncio" loading="lazy" referrerpolicy="no-referrer">` : ''}
    <div class="ad-referral-copy"><strong>${escapeHtml(title)}</strong>
      ${referral.body ? `<p class="ad-referral-preview">${escapeHtml(String(referral.body).slice(0, 180))}${String(referral.body).length > 180 ? '…' : ''}</p>${String(referral.body).length > 180 ? `<details class="ad-referral-description"><summary>Ver descrição completa</summary><p>${escapeHtml(referral.body)}</p></details>` : ''}` : ''}
      ${referral.source_id ? `<span class="ad-referral-id">ID: ${escapeHtml(referral.source_id)}</span>` : ''}
      ${link ? `<a class="ad-referral-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${referral.source_type === 'post' ? 'Ver publicação' : 'Ver anúncio'} ↗</a>` : ''}
    </div>
  </section>`;
}
