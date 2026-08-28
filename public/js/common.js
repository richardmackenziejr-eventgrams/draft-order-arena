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
