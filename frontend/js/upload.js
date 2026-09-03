document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  const fileDropZone = document.getElementById('file-drop-zone');
  const fileLabel = document.getElementById('file-label');
  const uploadForm = document.getElementById('uploadForm');
  const uploadBtn = document.getElementById('upload-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const resultBox = document.getElementById('result-box');
  const errorMessage = document.getElementById('errorMessage');

  const resCid = document.getElementById('res-cid');
  const resKey = document.getElementById('res-key');
  const copyCidBtn = document.getElementById('copy-cid-btn');
  const copyKeyBtn = document.getElementById('copy-key-btn');
  const resDownloadLink = document.getElementById('res-download-link');

  // Click drop zone to select file
  if (fileDropZone && fileInput) {
    fileDropZone.addEventListener('click', () => {
      fileInput.click();
    });
  }

  // Selected filename feedback
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && fileLabel) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        fileLabel.textContent = `Selected: ${file.name} (${sizeMb} MB)`;
      }
    });
  }

  // Drag and drop events
  if (fileDropZone && fileInput) {
    fileDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileDropZone.classList.add('drag-over');
    });

    fileDropZone.addEventListener('dragleave', () => {
      fileDropZone.classList.remove('drag-over');
    });

    fileDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDropZone.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        const file = files[0];
        if (fileLabel) {
          const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
          fileLabel.textContent = `Selected: ${file.name} (${sizeMb} MB)`;
        }
      }
    });
  }

  // Upload handler
  async function handleUpload(e) {
    if (e) e.preventDefault();

    const file = fileInput?.files?.[0];
    if (!file) {
      showError('Please select a file to upload first.');
      return;
    }

    const token = localStorage.getItem('token');
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const formData = new FormData();
    formData.append('file', file);

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '20%';
    if (resultBox) resultBox.classList.add('hidden');
    if (errorMessage) errorMessage.classList.add('hidden');
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
    }

    try {
      if (progressBar) progressBar.style.width = '60%';

      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers,
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        if (progressBar) progressBar.style.width = '100%';
        setTimeout(() => {
          if (progressContainer) progressContainer.classList.add('hidden');
        }, 500);

        if (resultBox) {
          resultBox.classList.remove('hidden');
          if (resCid) resCid.textContent = data.cid;
          if (resKey) resKey.textContent = data.key;

          if (resDownloadLink) {
            resDownloadLink.href = `download.html?cid=${encodeURIComponent(data.cid)}&key=${encodeURIComponent(data.key)}`;
          }

          if (copyCidBtn) {
            copyCidBtn.onclick = () => {
              navigator.clipboard.writeText(data.cid);
              copyCidBtn.textContent = 'Copied!';
              setTimeout(() => { copyCidBtn.textContent = 'Copy'; }, 2000);
            };
          }

          if (copyKeyBtn) {
            copyKeyBtn.onclick = () => {
              navigator.clipboard.writeText(data.key);
              copyKeyBtn.textContent = 'Copied!';
              setTimeout(() => { copyKeyBtn.textContent = 'Copy'; }, 2000);
            };
          }
        }

        // Cache upload locally for easy retrieval
        try {
          const uploads = JSON.parse(localStorage.getItem('myUploads') || '[]');
          uploads.unshift({
            cid: data.cid,
            key: data.key,
            filename: file.name,
            size: file.size,
            time: new Date().toISOString()
          });
          localStorage.setItem('myUploads', JSON.stringify(uploads.slice(0, 50)));
        } catch (err) {}

      } else {
        if (progressContainer) progressContainer.classList.add('hidden');
        showError(data.error || 'Upload failed. Please check server status.');
      }

    } catch (err) {
      if (progressContainer) progressContainer.classList.add('hidden');
      showError('Upload failed: ' + err.message);
    } finally {
      if (uploadBtn) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload File';
      }
    }
  }

  if (uploadForm) {
    uploadForm.addEventListener('submit', handleUpload);
  } else if (uploadBtn) {
    uploadBtn.addEventListener('click', handleUpload);
  }

  function showError(text) {
    if (errorMessage) {
      errorMessage.textContent = text;
      errorMessage.classList.remove('hidden');
    }
    if (resultBox) resultBox.classList.add('hidden');
  }
});
