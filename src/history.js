// src/history.js — History panel UI
// Depends on globals: historyItems, currentImageData, currentImageBlobUrl,
//                     currentImageDimensions, sessionCost (via updateCostDisplay)
// Depends on functions from utils.js, cost.js, app.js

'use strict';

// Fix #7: single shared observer — disconnected and recreated on each render
let _historyObserver = null;

function toggleHistory() {
  const sidebar = document.getElementById('historySidebar');
  const isVisible = !sidebar.classList.contains('hidden');
  sidebar.classList.toggle('hidden', isVisible);
  if (!isVisible) renderHistory();
}

function updateHistoryCount() {
  document.getElementById('historyCount').textContent = historyItems.length;
}

async function renderHistory() {
  const list = document.getElementById('historyList');

  // Fix #7: tear down previous observer before creating a new one
  if (_historyObserver) { _historyObserver.disconnect(); _historyObserver = null; }

  if (historyItems.length === 0) {
    list.innerHTML = '<p class="empty-state">No history yet. Generate your first description!</p>';
    return;
  }

  list.innerHTML = '';

  _historyObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (img.dataset.imagePath) {
        window.electronAPI.getHistoryImage(img.dataset.imagePath).then(dataUrl => {
          if (dataUrl) {
            img.src = dataUrl;
            img.classList.add('loaded');
          } else {
            img.classList.add('image-unavailable');
            img.setAttribute('aria-label', 'Image unavailable');
          }
        });
      } else if (img.dataset.src) {
        img.src = img.dataset.src;
        img.classList.add('loaded');
      } else {
        img.classList.add('image-unavailable');
      }
      _historyObserver.unobserve(img);
    });
  }, { rootMargin: '150px' });

  for (const item of historyItems) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.id = item.id; // Fix #5: used by filterHistory for reliable lookup

    const header = document.createElement('div');
    header.className = 'history-item-header';

    const date = document.createElement('span');
    date.className = 'history-item-date';
    date.textContent = new Date(item.timestamp).toLocaleDateString();

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'history-item-delete';
    deleteBtn.innerHTML = icon('close', 'Delete history item');
    deleteBtn.setAttribute('aria-label', `Delete history item from ${date.textContent}`);
    deleteBtn.dataset.id = item.id;
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteHistoryItem(item.id); });

    header.appendChild(date);
    header.appendChild(deleteBtn);

    const img = document.createElement('img');
    img.className = 'history-item-thumbnail lazy';
    img.alt = 'History thumbnail';

    if (item.imagePath) {
      img.dataset.imagePath = item.imagePath;
      _historyObserver.observe(img);
    } else if (item.image) {
      img.dataset.src = item.image;
      _historyObserver.observe(img);
    } else {
      img.classList.add('image-unavailable');
    }

    const desc = document.createElement('div');
    desc.className = 'history-item-description';
    desc.textContent = item.description;

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';
    const styleSpan = document.createElement('span');
    styleSpan.textContent = item.style;
    const costSpan = document.createElement('span');
    costSpan.textContent = '$' + (item.cost || 0).toFixed(4);
    meta.appendChild(styleSpan);
    meta.appendChild(costSpan);

    // Tags area
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'history-item-tags';

    (item.tags || []).forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'history-tag-badge';
      badge.textContent = tag;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('historySearch').value = tag;
        filterHistory();
      });
      tagsDiv.appendChild(badge);
    });

    const addTagBtn = document.createElement('button');
    addTagBtn.className = 'history-tag-add';
    addTagBtn.textContent = '+';
    addTagBtn.title = 'Add tag';
    addTagBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tag = prompt('Enter tag (e.g. approved, client-x, needs-edit):');
      if (!tag || !tag.trim()) return;
      const newTags = [...new Set([...(item.tags || []), tag.trim().toLowerCase()])];
      await window.electronAPI.tagHistoryItem(item.id, newTags);
      item.tags = newTags;
      renderHistory();
    });
    tagsDiv.appendChild(addTagBtn);

    div.appendChild(header);
    div.appendChild(img);
    div.appendChild(desc);
    div.appendChild(meta);
    div.appendChild(tagsDiv);
    div.addEventListener('click', () => loadHistoryItem(item));
    list.appendChild(div);
  }
}

async function loadHistoryItem(item) {
  if (item.imagePath) {
    currentImageData = await window.electronAPI.getHistoryImage(item.imagePath);
  } else {
    currentImageData = item.image;
  }

  if (!currentImageData) {
    showNotification('Image data is no longer available for this history item.', 'info');
  }

  currentImageDimensions = { width: 0, height: 0 };

  if (currentImageBlobUrl) { URL.revokeObjectURL(currentImageBlobUrl); currentImageBlobUrl = null; }
  if (currentImageData) {
    currentImageBlobUrl = URL.createObjectURL(dataUrlToBlob(currentImageData));
  }
  if (currentImageBlobUrl) {
    document.getElementById('previewImg').src = currentImageBlobUrl;
  } else {
    document.getElementById('previewImg').removeAttribute('src');
  }
  // Fix #1: use class-based hiding so clearImage() can correctly toggle them back
  document.getElementById('dropZone').classList.add('hidden');
  document.getElementById('imagePreview').classList.remove('hidden');
  document.getElementById('generateBtn').disabled = !currentImageData;
  document.getElementById('outputText').value = item.description;
  document.getElementById('copyBtn').disabled  = false;
  document.getElementById('exportBtn').disabled = false;
  document.getElementById('styleSelect').value = item.style;
  document.getElementById('detailLevel').value = item.detail;
  updateDetailLabel();
  if (item.model) {
    document.getElementById('modelSelect').value = item.model;
    updateModelPricing();
  }
  updateCostEstimator();
  toggleHistory();
}

async function deleteHistoryItem(id) {
  await window.electronAPI.deleteHistoryItem(id);
  historyItems = historyItems.filter(item => item.id !== id);
  updateHistoryCount();
  renderHistory();
}

async function clearHistory() {
  const result = await window.electronAPI.showMessageBox({
    type: 'question',
    buttons: ['Clear History', 'Cancel'],
    defaultId: 1,
    title: 'Clear History',
    message: 'Clear all history? This cannot be undone.'
  });
  if (result.response === 0) {
    await window.electronAPI.clearHistory();
    historyItems = [];
    updateHistoryCount();
    renderHistory();
  }
}

// Fix #5: look up items by data-id — immune to DOM/array order diverging
function filterHistory() {
  const query = document.getElementById('historySearch').value.toLowerCase();
  document.querySelectorAll('.history-item').forEach(el => {
    const item = historyItems.find(i => i.id === el.dataset.id);
    const searchText = [
      el.textContent,
      ...(item?.tags || [])
    ].join(' ').toLowerCase();
    el.style.display = searchText.includes(query) ? '' : 'none';
  });
}

async function saveToHistory(description, style, detail, model, provider, cost) {
  const thumbnailData = await compressImage(currentImageData, 400, 0.7);
  const historyItem = {
    id: Date.now().toString(),
    timestamp: Date.now(),
    image: thumbnailData,
    description,
    style,
    detail,
    model,
    provider: provider || null,
    cost
  };

  await window.electronAPI.saveHistoryItem(historyItem);
  // Fix #4: keep thumbnail in-memory so the item renders immediately without
  // waiting for the next app launch (it's a small compressed thumbnail).
  historyItems.unshift({ ...historyItem });
  updateHistoryCount();
  renderHistory();
}

async function exportHistory() {
  const result = await window.electronAPI.exportHistory();
  if (result.success) showStatus('History exported successfully.', 'success');
  else if (!result.canceled) showStatus('Export failed: ' + result.error, 'error');
}

async function importHistory() {
  const result = await window.electronAPI.importHistory();
  if (result.success) {
    showStatus(`Imported ${result.count} new history item(s).`, 'success');
    const updated = await window.electronAPI.getHistory();
    historyItems = updated;
    updateHistoryCount();
    renderHistory();
  } else if (!result.canceled) {
    showStatus('Import failed: ' + result.error, 'error');
  }
}
