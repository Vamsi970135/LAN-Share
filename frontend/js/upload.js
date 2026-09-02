document.addEventListener('DOMContentLoaded', () => {
  const fileInput       = document.getElementById('file-input');
  const fileDropZone    = document.getElementById('file-drop-zone');
  const fileLabel       = document.getElementById('file-label');
  const uploadBtn       = document.getElementById('upload-btn');
  const progressContainer = document.getElementById('progress-container');
  const progressBar     = document.getElementById('progress-bar');
  const message         = document.getElementById('message');
  const successMessage  = document.getElementById('successMessage');
  const errorMessage    = document.getElementById('errorMessage');

  // Click on drop zone → open file picker
  fileDropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // Show selected filename
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      fileLabel.textContent = `Selected: ${file.name}`;
      fileDropZone.style.borderColor = '#4f46e5';
      fileDropZone.style.background  = '#eef2ff';
    }
  });

  // Drag and drop
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
      fileLabel.textContent = `Selected: ${files[0].name}`;
      fileDropZone.style.borderColor = '#4f46e5';
      fileDropZone.style.background  = '#eef2ff';
    }
  });

  // Upload button
  uploadBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    const file = fileInput.files[0];
    if (!file) {
      showError('Please select a file first.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      showError('Please login first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');

    // Remove any old share button
    const oldBtn = message.querySelector('button');
    if (oldBtn) oldBtn.remove();

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        progressBar.style.width = '100%';
        showSuccess(`File uploaded successfully!\nCID: ${data.cid}`);

        // Cache upload info for CID sharing in chat
        try {
          const uploads = JSON.parse(localStorage.getItem('myUploads') || '[]');
          uploads.unshift({ cid: data.cid, key: data.key, filename: file.name, size: file.size });
          localStorage.setItem('myUploads', JSON.stringify(uploads.slice(0, 50)));
        } catch(err) {}

        // Share CID button
        setTimeout(() => {
          const shareBtn = document.createElement('button');
          shareBtn.textContent = '📋 Copy CID';
          shareBtn.style.cssText = 'margin-top:12px;background:#4f46e5;color:white;font-weight:700;padding:8px 20px;border-radius:8px;border:none;cursor:pointer;width:100%';
          shareBtn.onclick = () => {
            navigator.clipboard.writeText(data.cid);
            shareBtn.textContent = '✅ CID Copied!';
            setTimeout(() => { shareBtn.textContent = '📋 Copy CID'; }, 2000);
          };
          message.appendChild(shareBtn);
        }, 500);

      } else {
        progressContainer.classList.add('hidden');
        showError(data.error || 'Upload failed. Please try again.');
      }

    } catch (err) {
      progressContainer.classList.add('hidden');
      showError('Upload failed: ' + err.message);
    }
  });

  function showSuccess(text) {
    successMessage.textContent = text;
    successMessage.classList.remove('hidden');
    errorMessage.classList.add('hidden');
  }

  function showError(text) {
    errorMessage.textContent = text;
    errorMessage.classList.remove('hidden');
    successMessage.classList.add('hidden');
  }
});
