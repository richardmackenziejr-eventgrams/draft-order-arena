// Small shared helpers used by every page's script.

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function showError(el, err) {
  if (!el) return;
  el.textContent = err && err.message ? err.message : String(err);
  el.style.display = 'block';
}

function clearError(el) {
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

// Per-league membership, remembered locally so a member doesn't have to
// re-type their name every visit on the same device/browser.
function saveMembership(leagueId, member) {
  localStorage.setItem(`doa:member:${leagueId}`, JSON.stringify(member));
}
function getMembership(leagueId) {
  const raw = localStorage.getItem(`doa:member:${leagueId}`);
  return raw ? JSON.parse(raw) : null;
}

function saveCommish(leagueId, name) {
  localStorage.setItem(`doa:commish:${leagueId}`, name);
}
function isCommish(leagueId) {
  return !!localStorage.getItem(`doa:commish:${leagueId}`);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// A single-post football goalpost — two uprights joined by a crossbar, on a
// support pole — used as the Field Goal Kick game's icon. Real NFL
// goalposts are yellow, so that's fixed rather than currentColor.
function goalpostSvg() {
  return `
    <svg viewBox="0 0 24 32" width="23" height="30" xmlns="http://www.w3.org/2000/svg">
      <rect x="11" y="14" width="2" height="18" rx="1" fill="#f4c542" />
      <rect x="4" y="12" width="16" height="2.4" rx="1.2" fill="#f4c542" />
      <rect x="4" y="1.5" width="2.2" height="12" rx="1.1" fill="#f4c542" />
      <rect x="17.8" y="1.5" width="2.2" height="12" rx="1.1" fill="#f4c542" />
    </svg>
  `;
}

