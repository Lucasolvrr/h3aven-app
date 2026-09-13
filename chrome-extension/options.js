const input = document.getElementById('token-input');
const status = document.getElementById('status');

chrome.storage.local.get('refresh_token').then(({ refresh_token }) => {
  if (refresh_token) {
    status.textContent = 'Já conectado. Cole um novo token para trocar de conta.';
  }
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const value = input.value.trim();
  if (!value) {
    status.textContent = 'Cole um token válido antes de salvar.';
    return;
  }
  await chrome.storage.local.set({ refresh_token: value });
  status.textContent = 'Conectado! Pode fechar esta aba.';
  input.value = '';
});
