document.addEventListener('DOMContentLoaded', () => {
  // DOM references
  const downloadForm = document.getElementById('downloadForm');
  const cidInput = document.getElementById('cid-input');
  const downloadBtn = document.getElementById('download-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progressText');
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');
  const successText = document.getElementById('successText');
  const errorText = document.getElementById('errorText');

  // Pre-fill from URL params (?cid=...&key=...&filename=...)
  const urlParams = new URLSearchParams(window.location.search);
  const paramCid = urlParams.get('cid');
  if (paramCid && cidInput) {
    cidInput.value = paramCid.trim();
  }

  function showSuccess(msg) {
    if (successText) successText.textContent = msg;
    if (successMessage) successMessage.classList.remove('hidden');
    if (errorMessage) errorMessage.classList.add('hidden');
  }

  function showError(msg) {
    if (errorText) errorText.textContent = msg;
    if (errorMessage) errorMessage.classList.remove('hidden');
    if (successMessage) successMessage.classList.add('hidden');
  }

  function hideMessages() {
    if (successMessage) successMessage.classList.add('hidden');
    if (errorMessage) errorMessage.classList.add('hidden');
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  // Handle file download
  async function handleDownload(e) {
    if (e) e.preventDefault();

    const cid = cidInput.value.trim();
    if (!cid) {
      showError('Please enter a File Transfer Code.');
      return;
    }

    hideMessages();
    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '20%';
    if (progressText) progressText.textContent = 'Connecting to server...';
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Downloading...';
    }

    const token = getToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      if (progressBar) progressBar.style.width = '55%';
      if (progressText) progressText.textContent = 'Retrieving file & decrypting...';

      const response = await fetch(`/api/files/download/${encodeURIComponent(cid)}`, {
        method: 'GET',
        headers
      });

      if (progressBar) progressBar.style.width = '85%';
      if (progressText) progressText.textContent = 'Saving file...';

      if (response.ok) {
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `file-${cid.slice(-8)}`;
        if (contentDisposition) {
          const m = contentDisposition.match(/filename="?(.+?)"?$/);
          if (m) filename = m[1];
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 200);

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = 'Download complete!';
        setTimeout(() => {
          if (progressContainer) progressContainer.classList.add('hidden');
          showSuccess(`"${filename}" downloaded and decrypted successfully!`);
          if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download File';
          }
        }, 600);

      } else {
        const data = await response.json().catch(() => ({}));
        if (progressContainer) progressContainer.classList.add('hidden');

        let msg = data.message || 'Download failed.';
        if (response.status === 404) {
          msg = 'File not found. Please verify the Transfer Code.';
        }
        showError(msg);
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download File';
        }
      }
    } catch (err) {
      if (progressContainer) progressContainer.classList.add('hidden');
      showError('Network error connecting to server: ' + err.message);
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.textContent = 'Download File';
      }
    }
  }

  if (downloadForm) {
    downloadForm.addEventListener('submit', handleDownload);
  }
});
