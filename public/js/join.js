const codeFromLink = qs('code');
if (codeFromLink) document.getElementById('code').value = codeFromLink.toUpperCase();

document.getElementById('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('err');
  clearError(errEl);
  const code = document.getElementById('code').value.trim().toUpperCase();
  const name = document.getElementById('name').value.trim();
  try {
    const { league } = await api('GET', `/api/leagues/by-code/${code}`);
    const { member } = await api('POST', `/api/leagues/${league.id}/members`, { name });
    saveMembership(league.id, member);
    window.location.href = `/member-home.html?league=${league.id}`;
  } catch (err) {
    showError(errEl, err);
  }
});
