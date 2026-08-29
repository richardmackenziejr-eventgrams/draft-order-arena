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

// A referee — black-and-white striped jersey, black cap, one arm raised —
// used for the 40 Yard Dash's "Ready, Set, Go!" announcer and reused as the
// pair of officials standing the goal line on the Field Goal Kick scene.
function refereeFigureSvg() {
  return `
    <svg viewBox="0 0 24 34" width="34" height="48" xmlns="http://www.w3.org/2000/svg">
      <g class="ref-leg-l">
        <rect x="8" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
        <ellipse cx="10" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      </g>
      <g class="ref-leg-r">
        <rect x="12" y="23" width="4" height="9" rx="1.6" fill="#1c1c1c" />
        <ellipse cx="14" cy="32.3" rx="2.6" ry="1.4" fill="#050505" />
      </g>
      <clipPath id="refStripes">
        <path d="M6.5 9 Q6.5 7.2 8.3 7.2 L15.7 7.2 Q17.5 7.2 17.5 9 L16.9 23 Q12 24.4 7.1 23 Z" />
      </clipPath>
      <g clip-path="url(#refStripes)">
        <rect x="6.5" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="8.7" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="10.9" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="13.1" y="7.2" width="2.2" height="17" fill="#151515" />
        <rect x="15.3" y="7.2" width="2.2" height="17" fill="#f4f4f4" />
        <rect x="17.5" y="7.2" width="2.2" height="17" fill="#151515" />
      </g>
      <rect x="2.6" y="9.5" width="4" height="9.5" rx="2" fill="#151515" />
      <rect x="15.7" y="4.6" width="4" height="9.5" rx="2" fill="#151515" transform="rotate(-34 17.7 9.35)" />
      <circle cx="18.4" cy="6.1" r="1.15" fill="#e8e8e8" />
      <circle cx="12" cy="4.8" r="4.8" fill="#e8b98a" />
      <path d="M7.3 3.1 Q12 -0.8 16.7 3.1 L16.5 4.3 Q12 2.3 7.5 4.3 Z" fill="#151515" />
    </svg>
  `;
}
