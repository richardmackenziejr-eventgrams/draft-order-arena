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

// A small SVG football player — helmet, jersey with a trim stripe, padded
// arms/legs, cleats — used both as the animated racer on the 40 Yard Dash
// track and as that game's icon elsewhere. Jersey/helmet use currentColor,
// so callers set a `color` (via CSS) to pick the team/accent color; pants,
// cleats, and the facemask stay fixed colors regardless.
function runnerFigureSvg() {
  return `
    <svg viewBox="0 0 24 32" width="23" height="30" xmlns="http://www.w3.org/2000/svg">
      <g class="leg leg-l">
        <rect x="8" y="19" width="4" height="9" rx="2" fill="#e9e9ec" />
        <ellipse cx="10" cy="28.4" rx="3" ry="1.7" fill="#232323" />
      </g>
      <g class="leg leg-r">
        <rect x="12" y="19" width="4" height="9" rx="2" fill="#e9e9ec" />
        <ellipse cx="14" cy="28.4" rx="3" ry="1.7" fill="#232323" />
      </g>
      <path class="torso" d="M6 8 Q6 6.5 8 6.5 L16 6.5 Q18 6.5 18 8 L17.3 19 Q12 20.6 6.7 19 Z" fill="currentColor" />
      <rect x="6.2" y="9.6" width="11.6" height="2" fill="rgba(255,255,255,0.32)" />
      <g class="arm arm-l">
        <rect x="2.2" y="8.5" width="4.4" height="9.5" rx="2.2" fill="currentColor" />
      </g>
      <g class="arm arm-r">
        <rect x="17.4" y="8.5" width="4.4" height="9.5" rx="2.2" fill="currentColor" />
      </g>
      <circle class="head" cx="12" cy="5" r="5.4" fill="currentColor" stroke="rgba(0,0,0,0.35)" stroke-width="0.5" />
      <path d="M12 0.2 L12 5.6" stroke="rgba(255,255,255,0.4)" stroke-width="1.1" />
      <path class="facemask" d="M7.6 5.6 Q12 8.6 16.4 5.6" fill="none" stroke="#f4f4f4" stroke-width="1.1" stroke-linecap="round" />
    </svg>
  `;
}
