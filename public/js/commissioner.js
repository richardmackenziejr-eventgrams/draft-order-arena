document.getElementById('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('err');
  clearError(errEl);
  const name = document.getElementById('league-name').value.trim();
  const commissionerName = document.getElementById('commish-name').value.trim();
  try {
    const { league } = await api('POST', '/api/leagues', { name, commissionerName });
    saveCommish(league.id, commissionerName);
    window.location.href = `/league-dashboard.html?id=${league.id}`;
  } catch (err) {
    showError(errEl, err);
  }
});
