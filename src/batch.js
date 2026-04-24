// src/batch.js — Batch processing module
// Depends on globals: batchQueue, batchProcessing, settings,
//                     sessionCost, tokensUsed, imagesProcessed
// Depends on functions from utils.js, app.js (compressImage, getMidjourneyParams, updateCostDisplay)

'use strict';

// IMPROVEMENT 6: Restore saved batch queue on startup
async function checkSavedBatchQueue() {
  try {
    const saved = await window.electronAPI.getBatchQueue();
    if (!saved || saved.length === 0) return;

    const result = await window.electronAPI.showMessageBox({
      type: 'question',
      buttons: ['Restore', 'Discard'],
      defaultId: 0,
      title: 'Restore Batch Queue',
      message: `Found ${saved.length} pending item(s) from a previous session. Restore them?`
    });

    if (result.response === 0) {
      for (const item of saved) {
        if (item.dataUrl) {
          batchQueue.push({
            id: item.id || crypto.randomUUID(),
            filename: item.filename,
            dataUrl: item.dataUrl,
            status: 'pending',
            result: null
          });
        }
      }
      renderBatchQueue();
      showStatus(`Restored ${batchQueue.length} item(s) from previous session.`, 'info');
    } else {
      await window.electronAPI.clearBatchQueue();
    }
  } catch (_) { /* Non-fatal */ }
}

function handleBatchFileSelect(e) {
  const valid = Array.from(e.target.files).filter(file => {
    try { validateImageFile(file); return true; } catch { return false; }
  });
  addToBatchQueue(valid);
}

function handleBatchDrop(e) {
  addToBatchQueue(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
}

function addToBatchQueue(files) {
  const available = 20 - batchQueue.length;
  if (files.length > available) {
    showStatus(`Batch limit is 20 images. ${files.length - available} file(s) were not added.`, 'error');
  }
  files.slice(0, available).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      batchQueue.push({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        dataUrl: e.target.result,
        status: 'pending',
        result: null
      });
      renderBatchQueue();
      savePendingBatchQueue();
    };
    reader.readAsDataURL(file);
  });
}

function renderBatchQueue() {
  if (batchQueue.length === 0) {
    document.getElementById('batchQueue').classList.add('hidden');
    return;
  }

  document.getElementById('batchQueue').classList.remove('hidden');
  document.getElementById('batchCount').textContent = batchQueue.length;

  const list = document.getElementById('batchList');
  list.innerHTML = '';

  batchQueue.forEach(item => {
    const div = document.createElement('div');
    div.className = 'batch-item';
    div.classList.toggle('batch-item-active', item.status === 'processing');

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.className = 'batch-item-image';
    img.alt = item.file?.name || item.filename;

    const name = document.createElement('div');
    name.className = 'batch-item-name';
    name.textContent = item.file?.name || item.filename;

    const status = document.createElement('div');
    status.className = 'batch-item-status ' + item.status;
    status.textContent = item.status;
    if (item.status === 'error' && item.errorMsg) {
      status.title = item.errorMsg;
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'batch-item-delete';
    deleteBtn.innerHTML = icon('close', 'Remove from queue');
    deleteBtn.addEventListener('click', () => {
      batchQueue = batchQueue.filter(b => b.id !== item.id);
      renderBatchQueue();
    });

    div.appendChild(img);
    div.appendChild(name);
    div.appendChild(status);
    if (item.status === 'error' && item.errorMsg) {
      const errDetail = document.createElement('div');
      errDetail.className = 'batch-item-error-detail';
      errDetail.textContent = item.errorMsg;
      div.appendChild(errDetail);
    }
    div.appendChild(deleteBtn);
    list.appendChild(div);
  });
}

async function startBatchProcessing() {
  if (batchProcessing || batchQueue.length === 0) return;

  batchProcessing = true;
  document.getElementById('batchProgress').classList.remove('hidden');
  document.getElementById('batchStartBtn').disabled = true;

  const total            = batchQueue.length;
  const style            = document.getElementById('styleSelect').value;
  const detail           = parseInt(document.getElementById('detailLevel').value);
  const model            = document.getElementById('modelSelect').value;
  const midjourneyParams = getMidjourneyParams();
  const concurrency      = settings.concurrency || 2;

  let completed        = 0;
  let queueIndex       = 0;
  let authErrorReported = false;
  const batchStartTime = Date.now();

  function updateProgress() {
    document.getElementById('batchCurrent').textContent = completed;
    document.getElementById('batchTotal').textContent   = total;
    const pct = (completed / total) * 100;
    document.getElementById('batchProgressFill').style.width = pct + '%';
    document.querySelector('#batchProgress [role="progressbar"]')?.setAttribute('aria-valuenow', Math.round(pct));
    const elapsed = Math.round((Date.now() - batchStartTime) / 1000);
    const elapsedEl = document.getElementById('batchElapsed');
    if (elapsedEl) elapsedEl.textContent = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`;
  }

  async function processItem(item) {
    // Another worker may have already triggered a halt (auth error, cancel).
    if (!batchProcessing) {
      item.status = 'cancelled';
      return;
    }
    item.status    = 'processing';
    item.requestId = `batch-${Date.now()}-${Math.random()}`;
    const activeLabel = document.getElementById('batchActiveFile');
    if (activeLabel) activeLabel.textContent = item.filename;
    renderBatchQueue();

    try {
      const imageForModel = (settings.autoCompress === false)
        ? item.dataUrl
        : await compressImage(item.dataUrl, settings.maxImageSize || 1536, settings.compressionQuality || 0.8);

      const result = await window.electronAPI.generateDescription({
        requestId: item.requestId, imageDataUrl: imageForModel, style, detail, model, midjourneyParams
      });

      if (result.success) {
        item.status = 'completed';
        item.result = result.description;
        sessionCost    += result.usage.cost || 0;
        tokensUsed     += result.usage.totalTokens;
        imagesProcessed++;
        await window.electronAPI.updateStats({ images: 1, cost: result.usage.cost || 0, tokens: result.usage.totalTokens, provider: result.provider });

        // Post-process: generate marketplace listings if requested
        const genRedbubble = document.getElementById('batchGenRedbubble')?.checked;
        const genEtsy      = document.getElementById('batchGenEtsy')?.checked;
        if (genRedbubble) {
          try {
            const rbResult = await window.electronAPI.generateRedbubblePitch({
              requestId: `batch-rb-${item.id}`,
              description: result.description,
              model,
            });
            if (rbResult.success) item.redbubblePitch = rbResult.pitch;
          } catch { /* non-fatal */ }
        }
        if (genEtsy) {
          try {
            const etsyResult = await window.electronAPI.generateEtsyListing({
              requestId: `batch-etsy-${item.id}`,
              description: result.description,
              model,
            });
            if (etsyResult.success) item.etsyListing = etsyResult.listing;
          } catch { /* non-fatal */ }
        }
      } else if (result.cancelled) {
        item.status = 'cancelled';
      } else {
        item.status  = 'error';
        item.errorMsg = result.error || 'Unknown error';
        const isAuthError = result.error && (
          result.error.includes('401') ||
          result.error.includes('403') ||
          result.error.toLowerCase().includes('invalid api key') ||
          result.error.toLowerCase().includes('authentication') ||
          result.error.toLowerCase().includes('unauthorized')
        );
        if (isAuthError && !authErrorReported) {
          authErrorReported = true;
          batchProcessing   = false;
          showStatus(`Batch paused: API authentication failed — ${result.error}. Fix your API key in Settings, then restart.`, 'error');
        }
      }
    } catch (error) {
      item.status = 'error';
      item.errorMsg = error?.message || 'Unexpected error';
    }

    item.requestId = null;
    completed++;
    updateProgress();
    renderBatchQueue();
    savePendingBatchQueue();
  }

  async function worker() {
    while (batchProcessing) {
      const idx = queueIndex++;
      if (idx >= batchQueue.length) break;
      await processItem(batchQueue[idx]);
    }
  }

  updateProgress();
  const workers = Array.from({ length: Math.min(concurrency, total) }, worker);
  await Promise.all(workers);

  document.getElementById('batchProgressFill').style.width = '100%';
  document.getElementById('batchProgress').classList.add('hidden');
  document.getElementById('batchExport').classList.remove('hidden');
  document.getElementById('batchStartBtn').disabled       = false;
  batchProcessing = false;
  updateCostDisplay();

  await window.electronAPI.clearBatchQueue();

  const successCount = batchQueue.filter(item => item.status === 'completed').length;
  showStatus(`Batch complete! ${successCount}/${total} images processed.`, 'success');
  announce(`Batch complete. ${successCount} of ${total} images processed successfully.`);
}

function cancelBatchProcessing() {
  batchProcessing = false;
  batchQueue.forEach(item => {
    if (item.requestId) {
      window.electronAPI.cancelRequest(item.requestId);
      item.requestId = null;
    }
    if (item.status === 'pending' || item.status === 'processing') item.status = 'cancelled';
  });
  renderBatchQueue();
  document.getElementById('batchProgress').classList.add('hidden');
  document.getElementById('batchStartBtn').disabled      = false;
  showStatus('Batch processing cancelled', 'info');
}

function clearBatchQueue() {
  batchQueue = [];
  renderBatchQueue();
  document.getElementById('batchExport').classList.add('hidden');
  window.electronAPI.clearBatchQueue();
}

async function savePendingBatchQueue() {
  const pending = batchQueue.filter(i => i.status === 'pending');
  if (pending.length > 0) {
    await window.electronAPI.saveBatchQueue(pending.map(i => ({
      id: i.id,
      filename: i.file?.name || i.filename || 'image',
      dataUrl: i.dataUrl,
      status: 'pending'
    })));
  }
}

// Batch queue is saved proactively on item add (addToBatchQueue) and after
// each item completes (processItem), so no beforeunload handler is needed.

async function exportBatch(format) {
  const completed = batchQueue.filter(item => item.status === 'completed' && item.result);
  if (completed.length === 0) { showStatus('No completed results to export', 'error'); return; }

  const defaultName = `batch-export-${Date.now()}.${format}`;
  let content = '';

  const hasRedbubble = completed.some(item => item.redbubblePitch);
  const hasEtsy      = completed.some(item => item.etsyListing);

  if (format === 'txt') {
    content = completed.map((item, i) => `=== Image ${i + 1}: ${item.file?.name || item.filename} ===\n${item.result}\n\n`).join('');
  } else if (format === 'md') {
    const date  = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const model = document.getElementById('modelSelect').selectedOptions[0]?.text || '';
    const style = document.getElementById('styleSelect').value;
    content = `# Batch Image Descriptions\n\n**Generated:** ${date}  \n**Style:** ${style}  \n**Model:** ${model}  \n**Images:** ${completed.length}\n\n---\n\n`;
    content += completed.map((item, i) => {
      let section = `## Image ${i + 1}: ${item.file?.name || item.filename}\n\n${item.result}\n\n`;
      if (item.redbubblePitch) section += `### Redbubble Pitch\n\n${item.redbubblePitch}\n\n`;
      if (item.etsyListing)    section += `### Etsy Listing\n\n${item.etsyListing}\n\n`;
      return section + '---\n\n';
    }).join('');
  } else if (format === 'csv') {
    const headers = ['Filename', 'Description'];
    if (hasRedbubble) headers.push('RedbubblePitch');
    if (hasEtsy)      headers.push('EtsyListing');
    const rows = completed.map(item => {
      const cols = [
        `"${(item.file?.name || item.filename).replace(/"/g, '""')}"`,
        `"${item.result.replace(/"/g, '""')}"`,
      ];
      if (hasRedbubble) cols.push(`"${(item.redbubblePitch || '').replace(/"/g, '""')}"`);
      if (hasEtsy)      cols.push(`"${(item.etsyListing    || '').replace(/"/g, '""')}"`);
      return cols.join(',');
    });
    content = headers.join(',') + '\n' + rows.join('\n');
  } else if (format === 'json') {
    content = JSON.stringify(completed.map(item => {
      const obj = {
        filename: item.file?.name || item.filename,
        description: item.result,
        timestamp: Date.now(),
      };
      if (item.redbubblePitch) obj.redbubblePitch = item.redbubblePitch;
      if (item.etsyListing)    obj.etsyListing    = item.etsyListing;
      return obj;
    }), null, 2);
  }

  let result;
  if (format === 'txt')       result = await window.electronAPI.exportText({ content, defaultName });
  else if (format === 'md')   result = await window.electronAPI.exportMarkdown({ content, defaultName });
  else if (format === 'csv')  result = await window.electronAPI.exportCsv({ content, defaultName });
  else                        result = await window.electronAPI.exportJson({ content, defaultName });

  if (result.success) showStatus(`Exported ${completed.length} results as ${format.toUpperCase()}!`, 'success');
  else if (!result.canceled) showStatus('Export failed: ' + result.error, 'error');
}
