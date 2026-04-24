// Main app.js - v2.2

// ===== RENDERER ERROR BOUNDARY =====
window.onerror = function (message, source, lineno, colno, error) {
  const detail = { message, source, lineno, colno, stack: error?.stack };
  console.error('[renderer] Uncaught error', JSON.stringify(detail));
  // Surface non-fatal notice without crashing UI
  const banner = document.getElementById('errorBanner');
  if (banner) {
    banner.textContent = 'An unexpected error occurred. Check the log for details.';
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 8000);
  }
  return false; // Let default handler propagate
};

window.addEventListener('unhandledrejection', (event) => {
  const detail = { reason: String(event.reason), stack: event.reason?.stack };
  console.error('[renderer] Unhandled promise rejection', JSON.stringify(detail));
});

// State
let currentMode = 'single';
let currentImage = null;
let currentImageData = null;         // base64 data URL — used for IPC only
let currentImageBlobUrl = null;      // blob URL — used for <img> display, revoked on replace
let currentImageDimensions = { width: 0, height: 0 };
let sessionCost = 0;
let tokensUsed = 0;
let imagesProcessed = 0;
let historyItems = [];
let templates = [];
let settings = {};
let batchQueue = [];
let batchProcessing = false;
let apiProvider = null;
let activeProviders = [];
let compareImageData = null;
let compareImageBlobUrl = null;

// ===== IMPROVEMENT 4: Dimension-aware cost estimator =====

/** Estimate vision input tokens based on provider and actual image dimensions. */
function estimateVisionTokens(provider, width, height, maxSize) {
  maxSize = maxSize || settings.maxImageSize || 1536;

  // Apply the same compression the app will apply
  let w = width, h = height;
  if (w > maxSize || h > maxSize) {
    if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
    else        { w = Math.round(w * maxSize / h); h = maxSize; }
  }

  if (provider === 'openai') {
    // OpenAI tile-based: 512×512 tiles, 170 tokens each + 85 base
    if (w === 0 || h === 0) return 800;
    const tilesW = Math.ceil(w / 512);
    const tilesH = Math.ceil(h / 512);
    return 85 + 170 * tilesW * tilesH;
  }
  if (provider === 'anthropic') {
    // Anthropic: ~750 pixels per token, minimum ~500
    if (w === 0 || h === 0) return 1600;
    return Math.max(500, Math.round((w * h) / 750));
  }
  if (provider === 'google') {
    // Gemini: 258 tokens per 768×768 tile
    if (w === 0 || h === 0) return 800;
    const tilesW = Math.ceil(w / 768);
    const tilesH = Math.ceil(h / 768);
    return Math.max(258, 258 * tilesW * tilesH);
  }
  return 800;
}

function updateCostEstimator() {
  const estimator = document.getElementById('costEstimator');
  const estimatedEl = document.getElementById('estimatedCost');
  if (!estimator || !estimatedEl) return;

  const select = document.getElementById('modelSelect');
  const detail = parseInt(document.getElementById('detailLevel')?.value || 2);
  const option = select?.options[select.selectedIndex];
  const inputPrice = parseFloat(option?.dataset.inputPrice);
  const outputPrice = parseFloat(option?.dataset.outputPrice);
  const modelProvider = option?.dataset.provider || apiProvider;

  if (!option || isNaN(inputPrice) || isNaN(outputPrice) || !currentImageData) {
    estimator.classList.add('hidden');
    return;
  }

  const outputTokens = { 1: 150, 2: 300, 3: 500 }[detail] || 300;
  const inputTokens = estimateVisionTokens(
    modelProvider,
    currentImageDimensions.width,
    currentImageDimensions.height
  );
  const cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;

  estimatedEl.textContent = `~$${cost.toFixed(4)}`;
  estimator.classList.remove('hidden');
}

// ===== MODAL FOCUS MANAGEMENT =====

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const modalFocusState = new Map();

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modalFocusState.set(id, document.activeElement);
  modal.classList.remove('hidden');
  modal.classList.add('modal-open');
  requestAnimationFrame(() => {
    const focusable = modal.querySelectorAll(FOCUSABLE);
    if (focusable.length) focusable[0].focus();
    modal._trapHandler = createFocusTrapHandler(modal);
    modal.addEventListener('keydown', modal._trapHandler);
  });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('modal-open');
  if (modal._trapHandler) {
    modal.removeEventListener('keydown', modal._trapHandler);
    modal._trapHandler = null;
  }
  const previous = modalFocusState.get(id);
  modalFocusState.delete(id);
  if (previous && typeof previous.focus === 'function') previous.focus();
}

function createFocusTrapHandler(modal) {
  return function (e) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(FOCUSABLE));
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  };
}

function handleGlobalKeydown(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    const open = Array.from(document.querySelectorAll('.modal')).filter(m => m.classList.contains('modal-open'));
    if (open.length > 0) {
      e.preventDefault();
      const top = open[open.length - 1];
      switch (top.id) {
        case 'settingsModal':   closeSettings(); break;
        case 'dashboardModal':  closeDashboard(); break;
        case 'templateModal':   closeTemplateModal(); break;
        case 'onboardingModal': closeOnboarding(); break;
        case 'shortcutsModal':  closeShortcuts(); break;
      }
      return;
    }
    // Cancel active request
    const activeReq = window._activeRequestId;
    if (activeReq) window.electronAPI.cancelRequest(activeReq);
    return;
  }
  if (ctrl && e.key === '/') { e.preventDefault(); openShortcuts(); return; }
  if (ctrl && e.key === 'v' && currentMode === 'single') { e.preventDefault(); pasteImageFromClipboard(); return; }
  if (ctrl && e.key === 'Enter') {
    e.preventDefault();
    if (currentMode === 'single' && !document.getElementById('generateBtn').disabled) generateDescription();
    return;
  }
  if (ctrl && e.key === 'g') {
    if (currentMode === 'single' && !document.getElementById('generateBtn').disabled) {
      e.preventDefault(); generateDescription();
    }
    return;
  }
  if (ctrl && e.shiftKey && e.key === 'C') { e.preventDefault(); copyToClipboard(); return; }
  if (ctrl && e.key === ',') { e.preventDefault(); document.getElementById('settingsBtn')?.click(); return; }
  if (ctrl && e.key === 'h') { e.preventDefault(); document.getElementById('historyBtn')?.click(); return; }
}

// ===== SIDEBAR RESIZE =====

function setupSidebarResize() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('historySidebar');
  if (!handle || !sidebar) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const delta = startX - e.clientX;
    const newWidth = Math.min(600, Math.max(200, startWidth + delta));
    sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ===== INIT =====

async function init() {
  try { setupEventListeners(); } catch (e) { console.error('[init] setupEventListeners failed:', e); }
  try { setupSidebarResize(); } catch (e) { console.error('[init] setupSidebarResize failed:', e); }
  document.addEventListener('keydown', handleGlobalKeydown);

  try { await loadSettings(); } catch (e) { console.error('[init] loadSettings failed:', e); }
  try { await loadHistory(); } catch (e) { console.error('[init] loadHistory failed:', e); }
  try { await loadTemplates(); } catch (e) { console.error('[init] loadTemplates failed:', e); }
  try { await detectApiProvider(); } catch (e) { console.error('[init] detectApiProvider failed:', e); }
  try { updateCostDisplay(); } catch (e) { console.error('[init] updateCostDisplay failed:', e); }
  try { populateTemplates(); } catch (e) { console.error('[init] populateTemplates failed:', e); }
  try { checkOnboarding(); } catch (e) { console.error('[init] checkOnboarding failed:', e); }
  try { setupAutoUpdater(); } catch (e) { console.error('[init] setupAutoUpdater failed:', e); }
  try { await checkSavedBatchQueue(); } catch (e) { console.error('[init] checkSavedBatchQueue failed:', e); }
}

async function detectApiProvider() {
  const result = await window.electronAPI.getApiProvider();
  apiProvider = result.provider;
  activeProviders = result.providers || (result.provider ? [result.provider] : []);
  await loadAvailableModels();
}

async function loadAvailableModels() {
  const result = await window.electronAPI.getAvailableModels();
  const select = document.getElementById('modelSelect');
  select.innerHTML = '';

  if (result.models && result.models.length > 0) {
    // Group by provider for optgroup display
    const byProvider = {};
    result.models.forEach(model => {
      if (!byProvider[model.provider]) byProvider[model.provider] = [];
      byProvider[model.provider].push(model);
    });

    const providerLabels = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };

    Object.entries(byProvider).forEach(([provider, models]) => {
      const group = document.createElement('optgroup');
      group.label = providerLabels[provider] || provider;
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        option.dataset.pricing  = model.pricing;
        option.dataset.inputPrice  = model.inputPrice;
        option.dataset.outputPrice = model.outputPrice;
        option.dataset.provider    = model.provider;
        group.appendChild(option);
      });
      select.appendChild(group);
    });

    if (settings.defaultModel) {
      const exists = Array.from(select.options).some(opt => opt.value === settings.defaultModel);
      if (exists) select.value = settings.defaultModel;
    }

    updateModelPricing();
    updateSettingsSummary();
  }
}

async function loadSettings() {
  settings = await window.electronAPI.getSettings();

  if (document.getElementById('autoCompressCheck')) {
    document.getElementById('autoCompressCheck').checked = settings.autoCompress !== false;
  }
  if (document.getElementById('compressionQuality')) {
    const quality = settings.compressionQuality || 0.8;
    document.getElementById('compressionQuality').value = Math.round(quality * 100);
    document.getElementById('compressionValue').textContent = Math.round(quality * 100);
  }
  if (document.getElementById('exportFormat')) {
    document.getElementById('exportFormat').value = settings.exportFormat || 'txt';
  }
  if (document.getElementById('concurrencySelect')) {
    document.getElementById('concurrencySelect').value = settings.concurrency || 2;
  }
  if (document.getElementById('monthlyBudget')) {
    document.getElementById('monthlyBudget').value = settings.monthlyBudget || 0;
  }
  applyTheme(settings.theme || 'dark');
}

async function loadHistory() {
  historyItems = await window.electronAPI.getHistory();
  updateHistoryCount();
}

async function loadTemplates() {
  templates = await window.electronAPI.getTemplates();
}

// IMPROVEMENT 6: Batch queue persistence restore
async function checkSavedBatchQueue() {
  try {
    const saved = await window.electronAPI.getBatchQueue();
    if (!saved.items || saved.items.length === 0) return;

    const savedAt = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : 'previously';
    const result = await window.electronAPI.showMessageBox({
      type: 'question',
      buttons: ['Restore Queue', 'Discard'],
      defaultId: 0,
      title: 'Restore Batch Queue',
      message: `You have ${saved.items.length} unprocessed image(s) from ${savedAt}. Restore the batch queue?`
    });

    if (result.response === 0) {
      // Restore items into batchQueue
      for (const item of saved.items) {
        if (!item.dataUrl) continue;
        batchQueue.push({
          id: item.id,
          file: { name: item.filename },
          filename: item.filename,
          dataUrl: item.dataUrl,
          status: 'pending',
          result: null
        });
      }
      if (batchQueue.length > 0) {
        switchMode('batch');
        renderBatchQueue();
        showStatus(`Restored ${batchQueue.length} image(s) from previous session.`, 'success');
      }
    }
    // Clear from store regardless
    await window.electronAPI.clearBatchQueue();
  } catch (err) {
    console.error('Failed to restore batch queue:', err);
  }
}

// ===== THEME =====

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  settings.theme = theme;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  window.electronAPI.saveSettings(settings);
}

// ===== BUDGET =====

// Fix #3: use persistent totalCost from stats, not session-only cost
async function checkBudget() {
  const budget = settings.monthlyBudget || 0;
  if (budget <= 0) return true;
  const stats = await window.electronAPI.getStats();
  const totalCost = stats.totalCost || 0;
  const pct = (totalCost / budget) * 100;
  if (pct >= 100) {
    showStatus('Monthly budget of $' + budget.toFixed(2) + ' reached. Generation blocked.', 'error');
    return false;
  }
  if (pct >= 80) {
    showStatus('Warning: ' + pct.toFixed(0) + '% of monthly budget used ($' + totalCost.toFixed(4) + ' / $' + budget.toFixed(2) + ').', 'warning');
  }
  return true;
}

// ===== EVENT LISTENERS =====

function setupEventListeners() {
  // Mode switching
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  // Single mode
  document.getElementById('browseBtn').addEventListener('click', async () => {
    try {
      const fileData = await window.electronAPI.selectImageFile();
      if (!fileData) return;
      const file = dataUrlToFile(fileData.dataUrl, fileData.name, fileData.type);
      validateImageFile(file);
      loadImage(file);
    } catch (error) {
      showNotification(error.message || 'Failed to open file', 'error');
    }
  });
  setupDropZone('dropZone', handleImageDrop);
  document.getElementById('clearBtn').addEventListener('click', clearImage);
  document.getElementById('generateBtn').addEventListener('click', generateDescription);
  document.getElementById('copyBtn').addEventListener('click', copyToClipboard);
  document.getElementById('exportBtn').addEventListener('click', exportDescription);
  document.getElementById('regenerateBtn').addEventListener('click', regenerateDescription);
  document.getElementById('templateSelect').addEventListener('change', applyTemplate);
  document.getElementById('saveTemplateBtn').addEventListener('click', saveCurrentTemplate);
  document.getElementById('modelSelect').addEventListener('change', async (e) => {
    settings.defaultModel = e.target.value;
    await window.electronAPI.saveSettings(settings);
    updateModelPricing();
    updateSettingsSummary();
    updateCostEstimator();
  });
  document.getElementById('styleSelect')?.addEventListener('change', updateSettingsSummary);
  document.getElementById('detailLevel').addEventListener('input', () => {
    updateDetailLabel();
    updateSettingsSummary();
    updateCostEstimator();
  });
  document.getElementById('editModeBtn').addEventListener('click', toggleEditMode);

  document.getElementById('enableMidjourneyParams').addEventListener('change', (e) => {
    document.getElementById('midjourneyParams').classList.toggle('hidden', !e.target.checked);
  });

  // Batch mode
  document.getElementById('batchBrowseBtn').addEventListener('click', async () => {
    try {
      const filesData = await window.electronAPI.selectImageFile({ multiple: true });
      if (!filesData) return;
      const fileArray = Array.isArray(filesData) ? filesData : [filesData];
      addToBatchQueue(fileArray.map(fd => dataUrlToFile(fd.dataUrl, fd.name, fd.type)));
    } catch (error) {
      showNotification(error.message || 'Failed to open files', 'error');
    }
  });
  document.getElementById('batchFileInput').addEventListener('change', handleBatchFileSelect);
  setupDropZone('batchDropZone', handleBatchDrop);
  document.getElementById('batchStartBtn')?.addEventListener('click', startBatchProcessing);
  document.getElementById('batchClearBtn')?.addEventListener('click', clearBatchQueue);
  document.getElementById('batchCancelBtn')?.addEventListener('click', cancelBatchProcessing);
  document.getElementById('exportBatchTxt')?.addEventListener('click', () => exportBatch('txt'));
  document.getElementById('exportBatchCsv')?.addEventListener('click', () => exportBatch('csv'));
  document.getElementById('exportBatchJson')?.addEventListener('click', () => exportBatch('json'));
  document.getElementById('exportBatchMd')?.addEventListener('click', () => exportBatch('md'));

  // Compare mode
  document.getElementById('compareBrowseBtn').addEventListener('click', async () => {
    try {
      const fileData = await window.electronAPI.selectImageFile();
      if (!fileData) return;
      const file = dataUrlToFile(fileData.dataUrl, fileData.name, fileData.type);
      validateImageFile(file);
      loadCompareImage(file);
    } catch (error) {
      showNotification(error.message || 'Failed to open file', 'error');
    }
  });
  document.getElementById('compareFileInput').addEventListener('change', handleCompareFileSelect);
  setupDropZone('compareDropZone', handleCompareDrop);
  document.getElementById('compareGenerateBtn')?.addEventListener('click', generateComparisons);

  // Header buttons
  document.getElementById('historyBtn').addEventListener('click', toggleHistory);
  document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('shortcutsBtn')?.addEventListener('click', openShortcuts);
  document.getElementById('closeShortcutsModal')?.addEventListener('click', closeShortcuts);

  // History sidebar
  document.getElementById('closeHistoryBtn')?.addEventListener('click', () => toggleHistory());
  document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory);
  document.getElementById('exportHistoryBtn')?.addEventListener('click', exportHistory);
  document.getElementById('importHistoryBtn')?.addEventListener('click', importHistory);
  document.getElementById('historySearch')?.addEventListener('input', debounce(filterHistory, 250));

  // Settings modal
  document.getElementById('closeSettingsModal').addEventListener('click', closeSettings);
  document.getElementById('changeKeyBtn').addEventListener('click', changeApiKey);
  document.getElementById('deleteKeyBtn').addEventListener('click', deleteApiKey);
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchSettingsTab(btn.dataset.tab));
  });
  document.getElementById('autoCompressCheck')?.addEventListener('change', async (e) => {
    settings.autoCompress = e.target.checked;
    await window.electronAPI.saveSettings(settings);
  });
  document.getElementById('compressionQuality')?.addEventListener('input', (e) => {
    document.getElementById('compressionValue').textContent = e.target.value;
  });
  document.getElementById('compressionQuality')?.addEventListener('change', async (e) => {
    settings.compressionQuality = parseInt(e.target.value) / 100;
    await window.electronAPI.saveSettings(settings);
  });
  document.getElementById('exportFormat')?.addEventListener('change', async (e) => {
    settings.exportFormat = e.target.value;
    await window.electronAPI.saveSettings(settings);
  });
  document.getElementById('concurrencySelect')?.addEventListener('change', async (e) => {
    settings.concurrency = parseInt(e.target.value);
    await window.electronAPI.saveSettings(settings);
  });
  document.getElementById('monthlyBudget')?.addEventListener('change', async (e) => {
    settings.monthlyBudget = parseFloat(e.target.value) || 0;
    await window.electronAPI.saveSettings(settings);
  });

  // Dashboard modal
  document.getElementById('closeDashboardModal').addEventListener('click', closeDashboard);

  // Onboarding
  document.getElementById('closeOnboardingBtn')?.addEventListener('click', closeOnboarding);

  // Outside-click to close modals
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettings();
  });
  document.getElementById('dashboardModal').addEventListener('click', (e) => {
    if (e.target.id === 'dashboardModal') closeDashboard();
  });
  document.getElementById('templateModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'templateModal') closeTemplateModal();
  });
  document.getElementById('shortcutsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'shortcutsModal') closeShortcuts();
  });

  // Template modal
  document.getElementById('cancelTemplateBtn')?.addEventListener('click', closeTemplateModal);
  document.getElementById('saveTemplateConfirmBtn')?.addEventListener('click', confirmSaveTemplate);

  // IMPROVEMENT 1: Per-provider key management buttons in settings
  document.querySelectorAll('.provider-add-btn').forEach(btn => {
    btn.addEventListener('click', () => showAddProviderKeyPrompt(btn.dataset.provider));
  });
  document.querySelectorAll('.provider-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteProviderKey(btn.dataset.provider));
  });
  document.getElementById('redbubblePitchBtn').addEventListener('click', generateRedbubblePitch);
  document.getElementById('closeRedbubbleBtn')?.addEventListener('click', closeRedbubbleSection);
  document.getElementById('redbubbleCopyBtn')?.addEventListener('click', copyRedbubblePitch);
  document.getElementById('redbubbleExportBtn')?.addEventListener('click', exportRedbubblePitch);
  document.getElementById('etsyListingBtn')?.addEventListener('click', generateEtsyListing);
  document.getElementById('closeEtsyBtn')?.addEventListener('click', closeEtsySection);
  document.getElementById('etsyCopyBtn')?.addEventListener('click', copyEtsyListing);
  document.getElementById('etsyExportBtn')?.addEventListener('click', exportEtsyListing);
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
  document.getElementById('compareProvidersBtn')?.addEventListener('click', generateProviderComparison);
  document.addEventListener('paste', (e) => {
    if (currentMode !== 'single') return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (!imageItem) return;
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (file) loadImage(file);
  });
}

// ===== CLIPBOARD =====

async function pasteImageFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const file = new File([blob], 'pasted-image.png', { type });
          loadImage(file);
          return;
        }
      }
    }
    showStatus('No image found in clipboard', 'error');
  } catch {
    showStatus('Failed to paste from clipboard', 'error');
  }
}

// ===== MODE SWITCHING =====

function switchMode(mode) {
  if (currentMode === 'compare' && mode !== 'compare') {
    if (compareImageBlobUrl) { URL.revokeObjectURL(compareImageBlobUrl); compareImageBlobUrl = null; }
    compareImageData = null;
  }
  currentMode = mode;

  document.querySelectorAll('.mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === mode;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.mode-panel').forEach(panel => {
    panel.classList.add('hidden');
  });

  const panels = { single: 'singleMode', batch: 'batchMode', compare: 'compareMode' };
  document.getElementById(panels[mode]).classList.remove('hidden');

  if (mode === 'batch' || mode === 'compare') updateSettingsSummary();
}

function updateSettingsSummary() {
  const style     = document.getElementById('styleSelect')?.value || 'photorealistic';
  const detailIdx = parseInt(document.getElementById('detailLevel')?.value || 2) - 1;
  const detail    = ['Concise', 'Standard', 'Detailed'][detailIdx];
  const model     = document.getElementById('modelSelect')?.selectedOptions[0]?.text || 'GPT-4o Mini';
  const summary   = `${style} • ${detail} • ${model}`;
  const batchSummary   = document.getElementById('batchSettingsSummary');
  const compareSummary = document.getElementById('compareSettingsSummary');
  if (batchSummary)   batchSummary.textContent   = summary;
  if (compareSummary) compareSummary.textContent = summary;
}

// ===== DROP ZONES =====

function setupDropZone(zoneId, handler) {
  const zone = document.getElementById(zoneId);

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handler(e);
  });

  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (zoneId === 'dropZone')        document.getElementById('fileInput').click();
      else if (zoneId === 'batchDropZone')   document.getElementById('batchFileInput').click();
      else if (zoneId === 'compareDropZone') document.getElementById('compareFileInput').click();
    }
  });
}

// ===== SINGLE IMAGE MODE =====

function handleFileSelect(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    validateImageFile(file);
    loadImage(file);
  } catch (error) {
    showNotification(error.message, 'error');
  }
}

function handleImageDrop(e) {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    validateImageFile(file);
    loadImage(file);
  } catch (error) {
    showStatus(error.message || 'Please drop a valid image file', 'error');
  }
}

async function loadImage(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    currentImage = file;
    let imageData = e.target.result;

    if (settings.autoCompress !== false) {
      imageData = await compressImage(imageData, settings.maxImageSize || 1536, settings.compressionQuality || 0.8);
    }

    // Capture dimensions after compression so cost estimator uses the actual sent size
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        currentImageDimensions = { width: img.naturalWidth, height: img.naturalHeight };
        resolve();
      };
      img.onerror = resolve;
      img.src = imageData;
    });

    // Keep base64 for IPC; use blob URL for display to reduce memory pressure
    currentImageData = imageData;
    if (currentImageBlobUrl) { URL.revokeObjectURL(currentImageBlobUrl); currentImageBlobUrl = null; }
    const blob = dataUrlToBlob(imageData);
    currentImageBlobUrl = URL.createObjectURL(blob);

    document.getElementById('previewImg').src = currentImageBlobUrl;
    document.getElementById('dropZone').classList.add('hidden');
    document.getElementById('imagePreview').classList.remove('hidden');
    document.getElementById('generateBtn').disabled = false;
    document.getElementById('outputText').value = '';
    document.getElementById('copyBtn').disabled = true;
    document.getElementById('exportBtn').disabled = true;
    document.getElementById('regenerateBtn').disabled = true;
    document.getElementById('imageCost').textContent = '$0.00';
    updateCostEstimator();
    announce('Image loaded. Ready to generate description.');
  };
  reader.readAsDataURL(file);
}

/** Convert a base64 data URL to a Blob for use with URL.createObjectURL. */
function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mimeType = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
  return new Blob([bytes], { type: mimeType });
}

async function compressImage(dataUrl, maxSize, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = (height / width) * maxSize; width = maxSize; }
        else                { width = (width / height) * maxSize; height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function clearImage() {
  // Fix #2: clearImage must not revoke the compare image — that belongs to compare mode
  currentImage = null;
  currentImageData = null;
  currentImageDimensions = { width: 0, height: 0 };
  if (currentImageBlobUrl) { URL.revokeObjectURL(currentImageBlobUrl); currentImageBlobUrl = null; }
  document.getElementById('fileInput').value = '';
  document.getElementById('dropZone').classList.remove('hidden');
  document.getElementById('imagePreview').classList.add('hidden');
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('outputText').value = '';
  document.getElementById('copyBtn').disabled = true;
  document.getElementById('exportBtn').disabled = true;
  document.getElementById('regenerateBtn').disabled = true;
  document.getElementById('redbubblePitchBtn').disabled = true;
  document.getElementById('etsyListingBtn').disabled = true;
  closeRedbubbleSection();
  closeEtsySection();
  document.getElementById('statusMsg').classList.add('hidden');
  document.getElementById('costEstimator').classList.add('hidden');
}

function updateDetailLabel() {
  const levels = ['Concise', 'Standard', 'Detailed'];
  const value = document.getElementById('detailLevel').value;
  const label = levels[value - 1];
  document.getElementById('detailValue').textContent = label;
  document.getElementById('detailLevel').setAttribute('aria-valuetext', label);
}

function updateModelPricing() {
  const select = document.getElementById('modelSelect');
  const option = select.options[select.selectedIndex];
  if (option?.dataset.pricing) {
    document.getElementById('modelPricing').textContent = option.dataset.pricing;
  }
}

function getMidjourneyParams() {
  if (!document.getElementById('enableMidjourneyParams').checked) return {};
  const params = { enabled: true };
  const ar      = document.getElementById('mjAspectRatio').value;
  const stylize = document.getElementById('mjStylize').value;
  const chaos   = document.getElementById('mjChaos').value;
  const seed    = document.getElementById('mjSeed').value;
  const quality = document.getElementById('mjQuality').value;
  if (ar)      params.ar      = ar;
  if (stylize) params.stylize = stylize;
  if (chaos)   params.chaos   = chaos;
  if (seed)    params.seed    = seed;
  if (quality) params.quality = quality;
  return params;
}

async function generateDescription() {
  if (!currentImageData) return;

  const generateBtn = document.getElementById('generateBtn');
  const btnText     = document.getElementById('genBtnText');
  const btnLoader   = document.getElementById('genBtnLoader');

  generateBtn.disabled = true;
  generateBtn.setAttribute('aria-busy', 'true');
  btnText.style.display  = 'none';
  btnLoader.style.display = 'inline-block';
  showStatus('Analyzing image...', 'info');

  let unsubStream = null;
  try {
    const style           = document.getElementById('styleSelect').value;
    const detail          = parseInt(document.getElementById('detailLevel').value);
    const model           = document.getElementById('modelSelect').value;
    const midjourneyParams = getMidjourneyParams();

    const requestId = `single-${Date.now()}`;
    const outputText = document.getElementById('outputText');
    outputText.value = '';
    outputText.readOnly = false;
    unsubStream = window.electronAPI.onStreamChunk((data) => {
      if (data.requestId === requestId) {
        outputText.value += data.chunk;
        outputText.scrollTop = outputText.scrollHeight;
      }
    });
    const result = await window.electronAPI.generateDescription({
      requestId, imageDataUrl: currentImageData, style, detail, model, midjourneyParams
    });

    if (result.success) {
      document.getElementById('outputText').value = result.description;
      document.getElementById('outputText').readOnly = true;
      document.getElementById('copyBtn').disabled      = false;
      document.getElementById('exportBtn').disabled    = false;
      document.getElementById('regenerateBtn').disabled = false;
      document.getElementById('redbubblePitchBtn').disabled = false;
      document.getElementById('etsyListingBtn').disabled = false;

      const cost = result.usage.cost;
      sessionCost    += cost;
      tokensUsed     += result.usage.totalTokens;
      imagesProcessed++;

      document.getElementById('imageCost').textContent = '$' + cost.toFixed(4);
      updateCostDisplay();

      await saveToHistory(result.description, style, detail, model, result.provider, cost);
      await window.electronAPI.updateStats({ images: 1, cost, tokens: result.usage.totalTokens, provider: result.provider });
      showStatus('Description generated successfully!', 'success');
      announce('Description generated successfully.');
    } else if (result.cancelled) {
      showStatus('Generation cancelled.', 'info');
    } else {
      handleApiError(result);
    }
  } catch (error) {
    showStatus('Error: ' + error.message, 'error');
  } finally {
    unsubStream?.();
    window._activeRequestId = null;
    generateBtn.disabled = false;
    generateBtn.setAttribute('aria-busy', 'false');
    btnText.style.display  = 'inline';
    btnLoader.style.display = 'none';
  }
}

async function regenerateDescription() {
  await generateDescription();
}

function handleApiError(result) {
  const model    = document.getElementById('modelSelect')?.selectedOptions[0]?.text || 'Unknown model';
  const providerDisplay = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
  const provider = providerDisplay[apiProvider] || apiProvider;
  let message = result.error;

  if (result.errorCode === 401)  message = `Invalid ${provider} API key. Please update in Settings.`;
  else if (result.errorCode === 429)  message = `${provider} rate limit exceeded. Please wait and try again.`;
  else if (result.errorCode === 402)  message = `Insufficient ${provider} credits. Please add credits.`;
  else if (result.errorCode === 'TIMEOUT') message = `Request timeout (${model}). Please try again.`;
  else if (typeof result.errorCode === 'number' && result.errorCode >= 500) {
    message = `${provider} server error (${result.errorCode}). Retried automatically, still failed.`;
  }

  showStatus('Error: ' + message, 'error');
  console.error('API Error:', { provider, model, ...result });
}


async function copyToClipboard() {
  const text = document.getElementById('outputText').value;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('copyBtn');
    const original = btn.innerHTML;
    btn.innerHTML = `${icon('check')} Copied!`;
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch {
    showStatus('Failed to copy to clipboard', 'error');
  }
}

// IMPROVEMENT 10: Markdown export for single image
function buildMarkdownExport(description) {
  const style  = document.getElementById('styleSelect').value;
  const detail = parseInt(document.getElementById('detailLevel').value);
  const model  = document.getElementById('modelSelect').selectedOptions[0]?.text || '';
  const detailLabel = ['Concise', 'Standard', 'Detailed'][detail - 1] || 'Standard';
  const date   = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

  return `# Image Description\n\n**Style:** ${style}\n**Detail:** ${detailLabel}\n**Model:** ${model}\n**Generated:** ${date}\n\n---\n\n${description}\n`;
}

async function exportDescription() {
  const description = document.getElementById('outputText').value;
  if (!description) return;

  const filename    = generateSmartFilename(description, 'txt');
  const formatChoice = await window.electronAPI.showMessageBox({
    type: 'question',
    buttons: ['Text (.txt)', 'Markdown (.md)', 'JSON (.json)', 'Cancel'],
    defaultId: 0,
    title: 'Export Format',
    message: 'Choose export format:'
  });

  if (formatChoice.response === 3) return;

  let result;
  if (formatChoice.response === 0) {
    result = await window.electronAPI.exportText({ content: description, defaultName: filename });
  } else if (formatChoice.response === 1) {
    const mdContent = buildMarkdownExport(description);
    result = await window.electronAPI.exportMarkdown({ content: mdContent, defaultName: filename.replace(/\.txt$/, '.md') });
  } else {
    const content = JSON.stringify({
      description,
      style:     document.getElementById('styleSelect').value,
      detail:    document.getElementById('detailLevel').value,
      model:     document.getElementById('modelSelect').value,
      timestamp: Date.now()
    }, null, 2);
    result = await window.electronAPI.exportJson({ content, defaultName: filename.replace(/\.txt$/, '.json') });
  }

  if (result.success) showStatus('Exported successfully!', 'success');
  else if (!result.canceled) showStatus('Export failed: ' + result.error, 'error');
}

function toggleEditMode() {
  const textarea  = document.getElementById('outputText');
  const isReadOnly = textarea.readOnly;
  textarea.readOnly = !isReadOnly;
  const btn = document.getElementById('editModeBtn');
  btn.setAttribute('aria-label', isReadOnly ? 'Save edits' : 'Edit description');
  btn.title = isReadOnly ? 'Save edits' : 'Edit description';
  btn.innerHTML = isReadOnly
    ? `${icon('check')} Save`
    : `${icon('edit')}`;
  if (!isReadOnly) showStatus('Edit saved', 'success');
}

// ===== TEMPLATES =====

function populateTemplates() {
  const select = document.getElementById('templateSelect');
  select.innerHTML = '<option value="">Custom Settings</option>';
  templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name + (template.custom ? ' ★' : '');
    select.appendChild(option);
  });
}

function applyTemplate() {
  const templateId = document.getElementById('templateSelect').value;
  if (!templateId) return;
  const template = templates.find(t => t.id === templateId);
  if (template) {
    document.getElementById('styleSelect').value = template.style;
    document.getElementById('detailLevel').value = template.detail;
    updateDetailLabel();
  }
}

async function saveCurrentTemplate() {
  openModal('templateModal');
  document.getElementById('templateNameInput').value = '';
  const input = document.getElementById('templateNameInput');
  const enterHandler = (e) => {
    if (e.key === 'Enter') { confirmSaveTemplate(); input.removeEventListener('keydown', enterHandler); }
  };
  input.addEventListener('keydown', enterHandler);
}

function closeTemplateModal() { closeModal('templateModal'); }

async function confirmSaveTemplate() {
  const name = document.getElementById('templateNameInput').value.trim();
  if (!name)            { showStatus('Please enter a template name', 'error'); return; }
  if (name.length > 50) { showStatus('Template name too long (max 50 characters)', 'error'); return; }

  const template = {
    id: 'custom-' + Date.now(),
    name,
    style:  document.getElementById('styleSelect').value,
    detail: parseInt(document.getElementById('detailLevel').value),
    custom: true
  };

  const result = await window.electronAPI.saveTemplate(template);
  if (result.success) {
    templates.push(template);
    populateTemplates();
    closeTemplateModal();
    showStatus('Template saved!', 'success');
  } else {
    showStatus('Failed to save template: ' + result.error, 'error');
  }
}

// ===== COMPARE MODE =====

function handleCompareFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadCompareImage(file);
}

function handleCompareDrop(e) {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadCompareImage(file);
}

async function loadCompareImage(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    let imageData = e.target.result;
    if (settings.autoCompress !== false) {
      imageData = await compressImage(imageData, settings.maxImageSize || 1536, settings.compressionQuality || 0.8);
    }
    compareImageData = imageData;
    if (compareImageBlobUrl) { URL.revokeObjectURL(compareImageBlobUrl); compareImageBlobUrl = null; }
    compareImageBlobUrl = URL.createObjectURL(dataUrlToBlob(imageData));
    document.getElementById('compareDropZone').classList.add('hidden');
    document.getElementById('compareControls').classList.remove('hidden');
    document.getElementById('providerCompareSection').classList.remove('hidden');
    document.getElementById('compareProvidersBtn').disabled = (activeProviders.length < 2);
  };
  reader.readAsDataURL(file);
}

async function generateComparisons() {
  if (!compareImageData) return;

  const btn = document.getElementById('compareGenerateBtn');
  btn.disabled = true;
  btn.innerHTML = `<span class="loader" aria-hidden="true"></span> Generating variations...`;

  document.getElementById('compareResults').classList.remove('hidden');
  const grid = document.getElementById('comparisonGrid');
  grid.innerHTML = '';

  const style           = document.getElementById('styleSelect').value;
  const model           = document.getElementById('modelSelect').value;
  const midjourneyParams = getMidjourneyParams();
  const variations      = [{ detail: 1, label: 'Concise' }, { detail: 2, label: 'Standard' }, { detail: 3, label: 'Detailed' }];

  // Fix #6: build all cards first, then fire requests in parallel
  const cardRefs = variations.map(variation => {
    const card = document.createElement('div');
    card.className = 'comparison-card';

    const header = document.createElement('div');
    header.className = 'comparison-card-header';
    const title = document.createElement('h3');
    title.textContent = variation.label;
    const modelBadge = document.createElement('span');
    modelBadge.className = 'compare-model-badge';
    modelBadge.textContent = model;
    const loader = document.createElement('span');
    loader.className = 'loader';
    loader.setAttribute('aria-hidden', 'true');
    header.appendChild(title);
    header.appendChild(modelBadge);
    header.appendChild(loader);

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.setAttribute('aria-label', `${variation.label} description`);

    const actions = document.createElement('div');
    actions.className = 'comparison-card-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary';
    copyBtn.innerHTML = `${icon('copy')} Copy`;
    copyBtn.disabled = true;

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn-secondary';
    exportBtn.innerHTML = `${icon('download')} Export`;
    exportBtn.disabled = true;

    actions.appendChild(copyBtn);
    actions.appendChild(exportBtn);
    card.appendChild(header);
    card.appendChild(textarea);
    card.appendChild(actions);
    grid.appendChild(card);

    return { textarea, loader, copyBtn, exportBtn };
  });

  await Promise.all(variations.map(async (variation, i) => {
    const { textarea, loader, copyBtn, exportBtn } = cardRefs[i];
    try {
      const result = await window.electronAPI.generateDescription({
        imageDataUrl: compareImageData, style, detail: variation.detail, model, midjourneyParams
      });

      if (result.success) {
        textarea.value = result.description;
        loader.style.display = 'none';
        copyBtn.disabled  = false;
        exportBtn.disabled = false;

        copyBtn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(result.description);
          const orig = copyBtn.innerHTML;
          copyBtn.innerHTML = `${icon('check')} Copied!`;
          setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
        });

        exportBtn.addEventListener('click', async () => {
          const filename    = generateSmartFilename(result.description, 'txt');
          const exportResult = await window.electronAPI.exportText({ content: result.description, defaultName: filename });
          if (exportResult.success) showStatus('Exported!', 'success');
          else if (!exportResult.canceled) showStatus('Export failed: ' + exportResult.error, 'error');
        });

        sessionCost    += result.usage.cost;
        tokensUsed     += result.usage.totalTokens;
        imagesProcessed++;
        await window.electronAPI.updateStats({ images: 1, cost: result.usage.cost, tokens: result.usage.totalTokens, provider: result.provider });
      } else {
        textarea.value = 'Error: ' + result.error;
        loader.style.display = 'none';
      }
    } catch (err) {
      textarea.value = 'Error: ' + err.message;
      loader.style.display = 'none';
    }
  }));

  btn.disabled = false;
  btn.innerHTML = `${icon('compare')} Generate Variations`;
  updateCostDisplay();
}

// ===== IMPROVEMENT 7: Per-provider stats dashboard =====

async function openDashboard() {
  const stats = await window.electronAPI.getStats();
  document.getElementById('statTotalImages').textContent = stats.totalImages;
  document.getElementById('statTotalCost').textContent   = '$' + stats.totalCost.toFixed(4);
  document.getElementById('statTotalTokens').textContent = stats.totalTokens.toLocaleString();
  document.getElementById('statAvgCost').textContent = stats.totalImages > 0
    ? '$' + (stats.totalCost / stats.totalImages).toFixed(4)
    : '$0.00';

  // Per-provider breakdown
  const byProvider = stats.byProvider || {};
  const container  = document.getElementById('providerStats');
  if (container) {
    container.innerHTML = '';
    const providerLabels = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
    Object.entries(byProvider).forEach(([provider, data]) => {
      if (data.images === 0) return;
      const row = document.createElement('div');
      row.className = 'provider-stat-row';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'provider-stat-name';
      nameSpan.textContent = providerLabels[provider] || provider;

      const imagesSpan = document.createElement('span');
      imagesSpan.className = 'provider-stat-images';
      imagesSpan.textContent = `${data.images} images`;

      const costSpan = document.createElement('span');
      costSpan.className = 'provider-stat-cost';
      costSpan.textContent = `$${data.cost.toFixed(4)}`;

      const tokensSpan = document.createElement('span');
      tokensSpan.className = 'provider-stat-tokens';
      tokensSpan.textContent = `${data.tokens.toLocaleString()} tokens`;

      row.appendChild(nameSpan);
      row.appendChild(imagesSpan);
      row.appendChild(costSpan);
      row.appendChild(tokensSpan);
      container.appendChild(row);
    });
    if (container.children.length === 0) {
      container.innerHTML = '<p class="empty-state">No per-provider data yet.</p>';
    }
  }

  openModal('dashboardModal');
}

function closeDashboard() { closeModal('dashboardModal'); }

function openSettings() {
  loadProviderStatus();
  openModal('settingsModal');
}

function closeSettings() { closeModal('settingsModal'); }

// IMPROVEMENT 1: Load and display provider status in settings
async function loadProviderStatus() {
  const status = await window.electronAPI.getProviderStatus();
  const providerLabels = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };

  document.querySelectorAll('.provider-status-indicator').forEach(el => {
    const provider = el.dataset.provider;
    if (status[provider]) {
      el.textContent = '✓ Connected';
      el.className = 'provider-status-indicator connected';
    } else {
      el.textContent = '✗ Not configured';
      el.className = 'provider-status-indicator disconnected';
    }
  });

  document.querySelectorAll('.provider-delete-btn').forEach(btn => {
    btn.disabled = !status[btn.dataset.provider];
  });
}

async function showAddProviderKeyPrompt(provider) {
  // Use a simple input approach via showMessageBox isn't ideal, but
  // for security we navigate back to setup or handle inline.
  // We'll show a native dialog-free approach via a small inline form toggle.
  const row = document.querySelector(`.provider-key-row[data-provider="${provider}"]`);
  if (!row) return;

  let inputRow = row.querySelector('.provider-key-input-row');
  if (inputRow) {
    inputRow.remove();
    return;
  }

  inputRow = document.createElement('div');
  inputRow.className = 'provider-key-input-row';
  inputRow.innerHTML = `
    <input type="password" placeholder="Paste your ${provider} API key here" class="provider-key-input" autocomplete="off">
    <button class="btn-primary btn-sm provider-key-save-btn">Save</button>
    <button class="btn-secondary btn-sm provider-key-cancel-btn">Cancel</button>
    <div class="provider-key-status"></div>
  `;
  row.appendChild(inputRow);

  const input     = inputRow.querySelector('.provider-key-input');
  const saveBtn   = inputRow.querySelector('.provider-key-save-btn');
  const cancelBtn = inputRow.querySelector('.provider-key-cancel-btn');
  const statusEl  = inputRow.querySelector('.provider-key-status');

  cancelBtn.addEventListener('click', () => inputRow.remove());

  saveBtn.addEventListener('click', async () => {
    const apiKey = input.value.trim();
    if (!apiKey) { statusEl.textContent = 'Please enter a key.'; return; }
    statusEl.textContent = 'Testing...';
    saveBtn.disabled = true;

    const testResult = await window.electronAPI.testApiKey(apiKey);
    if (!testResult.success) {
      statusEl.textContent = 'Invalid key: ' + testResult.error;
      saveBtn.disabled = false;
      return;
    }

    const saveResult = await window.electronAPI.setApiKeyForProvider(provider, apiKey);
    if (saveResult.success) {
      statusEl.textContent = 'Saved!';
      setTimeout(async () => {
        inputRow.remove();
        await loadProviderStatus();
        await loadAvailableModels();
      }, 800);
    } else {
      statusEl.textContent = 'Failed: ' + (saveResult.error || 'Unknown error');
      saveBtn.disabled = false;
    }
  });

  input.focus();
}

async function deleteProviderKey(provider) {
  const result = await window.electronAPI.showMessageBox({
    type: 'question',
    buttons: [`Remove ${provider} Key`, 'Cancel'],
    defaultId: 1,
    title: 'Remove API Key',
    message: `Remove the ${provider} API key? Models for this provider will no longer be available.`
  });
  if (result.response === 0) {
    await window.electronAPI.deleteApiKeyForProvider(provider);
    await loadProviderStatus();
    await loadAvailableModels();
    showStatus(`${provider} API key removed.`, 'success');
  }
}

function switchSettingsTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tab + 'Tab');
  });
}

async function changeApiKey() {
  await window.electronAPI.loadSetup();
}

async function deleteApiKey() {
  const result = await window.electronAPI.showMessageBox({
    type: 'question',
    buttons: ['Delete All Keys', 'Cancel'],
    defaultId: 1,
    title: 'Delete All API Keys',
    message: 'Delete ALL API keys and reset the app? You will need to re-enter your keys.'
  });
  if (result.response === 0) {
    await window.electronAPI.deleteApiKey();
    await window.electronAPI.loadSetup();
  }
}

async function checkOnboarding() {
  if (settings.showOnboarding !== false) openModal('onboardingModal');
}

function openShortcuts()  { openModal('shortcutsModal'); }
function closeShortcuts() { closeModal('shortcutsModal'); }

function closeOnboarding() {
  settings.showOnboarding = false;
  window.electronAPI.saveSettings(settings);
  closeModal('onboardingModal');
}

function setupAutoUpdater() {
  window.electronAPI.onProviderCooldown((info) => {
    if (!info?.provider) return;
    const secs = Math.ceil((info.until - Date.now()) / 1000);
    showStatus(`${info.provider} rate limit hit — wait ${secs}s before retrying.`, 'error');
  });

  // Fix #10: use CSS classes instead of hardcoded hex colors so light theme works
  window.electronAPI.onUpdateError((info) => {
    const updateInfo = document.getElementById('updateInfo');
    updateInfo.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'error-msg';
    p.textContent = `Update failed: ${info?.message || 'Unknown error'}. Please update manually.`;
    updateInfo.appendChild(p);
  });

  window.electronAPI.onUpdateAvailable((info) => {
    const updateInfo = document.getElementById('updateInfo');
    updateInfo.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'status-msg';
    p.textContent = info?.version ? `Update v${info.version} available! Downloading...` : 'Update available! Downloading...';
    updateInfo.appendChild(p);
  });

  window.electronAPI.onUpdateDownloaded((info) => {
    const updateInfo = document.getElementById('updateInfo');
    updateInfo.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'success-msg';
    p.textContent = info?.version ? `v${info.version} ready. ` : 'Update downloaded. ';
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.style.marginLeft = '10px';
    btn.textContent = 'Install & Restart';
    btn.addEventListener('click', () => window.electronAPI.installUpdate());
    p.appendChild(btn);
    updateInfo.appendChild(p);
  });
}

function updateCostDisplay() {
  document.getElementById('sessionCost').textContent = '$' + sessionCost.toFixed(4);
  document.getElementById('tokensUsed').textContent  = tokensUsed.toLocaleString();
}


// ===== PROVIDER COMPARISON =====

async function generateProviderComparison() {
  if (!compareImageData) return;
  const btn = document.getElementById('compareProvidersBtn');
  const resultsDiv = document.getElementById('providerCompareResults');
  const style  = document.getElementById('styleSelect').value;
  const detail = parseInt(document.getElementById('detailLevel').value);
  const model  = document.getElementById('modelSelect').value;

  btn.disabled = true;
  btn.textContent = 'Generating...';
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<p class="redbubble-loading">Generating descriptions from all providers\u2026</p>';

  const providerModels = {
    openai:    'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-20241022',
    google:    'gemini-1.5-flash',
  };

  const jobs = activeProviders.map(async (provider) => {
    const providerModel = providerModels[provider] || model;
    const requestId = `compare-${provider}-${Date.now()}`;
    try {
      const result = await window.electronAPI.generateDescription({
        requestId, imageDataUrl: compareImageData, style, detail,
        model: providerModel, midjourneyParams: {},
      });
      return { provider, result };
    } catch (err) {
      return { provider, result: { success: false, error: err.message } };
    }
  });

  const results = await Promise.all(jobs);

  const providerNames = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google' };
  resultsDiv.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'provider-compare-grid';

  results.forEach(({ provider, result }) => {
    const card = document.createElement('div');
    card.className = 'provider-compare-card';
    const header = document.createElement('div');
    header.className = 'provider-compare-header';
    header.appendChild(document.createTextNode(providerNames[provider] || provider));
    const modelBadge = document.createElement('span');
    modelBadge.className = 'compare-model-badge';
    modelBadge.textContent = providerModels[provider] || model;
    header.appendChild(modelBadge);
    const body = document.createElement('div');
    body.className = 'provider-compare-body';
    if (result.success) {
      body.textContent = result.description;
      const cost = result.usage?.cost ?? 0;
      const costSpan = document.createElement('span');
      costSpan.className = 'cost-badge';
      costSpan.textContent = '$' + cost.toFixed(4);
      header.appendChild(costSpan);
      sessionCost += cost;
      tokensUsed += result.usage?.totalTokens || 0;
      updateCostDisplay();
    } else {
      body.textContent = 'Error: ' + (result.error || 'Unknown error');
      body.classList.add('redbubble-error');
    }
    card.appendChild(header);
    card.appendChild(body);
    grid.appendChild(card);
  });

  resultsDiv.appendChild(grid);
  btn.disabled = false;
  btn.innerHTML = icon('compare') + ' Compare All Providers';
}

// ===== REDBUBBLE SALES PITCH =====

let _lastRedbubblePitch = '';
let _lastEtsyListing = '';

/**
 * Convert a simple markdown string (bold, bullets, line breaks) to safe HTML.
 * Input is HTML-escaped first so no injection is possible.
 */
function renderMarkdown(text) {
  // Escape HTML entities first
  let s = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold: **text**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Bullet lines: lines starting with "- " become <li>
  s = s.replace(/^- (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> blocks in <ul>
  s = s.replace(/(<li>[\s\S]*?<\/li>(\n|$))+/g, (match) => `<ul>${match}</ul>`);

  // Blank lines → paragraph breaks
  s = s.replace(/\n{2,}/g, '</p><p>');

  // Remaining single newlines → <br>
  s = s.replace(/\n/g, '<br>');

  return `<p>${s}</p>`;
}

async function generateRedbubblePitch() {
  const description = document.getElementById('outputText').value.trim();
  if (!description) return;
  if (!await checkBudget()) return;

  const btn = document.getElementById('redbubblePitchBtn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="loader" aria-hidden="true"></span> Generating...`;

  const section = document.getElementById('redbubbleSection');
  const output  = document.getElementById('redbubbleOutput');
  section.classList.remove('hidden');
  output.innerHTML = '<p class="redbubble-loading">Generating Redbubble listing…</p>';
  output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let unsubRbStream = null;
  try {
    const model     = document.getElementById('modelSelect').value;
    const requestId = `redbubble-${Date.now()}`;
    // Fix #9: simple accumulator avoids repeated DOM serialisation
    let streamBuffer = '';
    unsubRbStream = window.electronAPI.onStreamChunk((data) => {
      if (data.requestId !== requestId) return;
      streamBuffer += data.chunk;
      let pre = output.querySelector('pre.stream-preview');
      if (!pre) {
        pre = document.createElement('pre');
        pre.className = 'stream-preview';
        pre.style.cssText = 'white-space:pre-wrap;font-family:inherit;margin:0';
        output.innerHTML = '';
        output.appendChild(pre);
      }
      pre.textContent = streamBuffer;
    });
    const result    = await window.electronAPI.generateRedbubblePitch({ requestId, description, model });

    if (result.success) {
      _lastRedbubblePitch = result.pitch;
      output.innerHTML = renderMarkdown(result.pitch);

      const cost = result.usage?.cost ?? 0;
      document.getElementById('redbubbleCost').textContent = '$' + cost.toFixed(4);
      sessionCost  += cost;
      tokensUsed   += result.usage?.totalTokens || 0;
      updateCostDisplay();
      announce('Redbubble listing generated.');
    } else if (result.cancelled) {
      output.innerHTML = '<p class="redbubble-error">Generation cancelled.</p>';
    } else {
      output.innerHTML = `<p class="redbubble-error">Error: ${
        document.createElement('span').appendChild(document.createTextNode(result.error || 'Unknown error')).parentNode.innerHTML
      }</p>`;
    }
  } catch (err) {
    output.innerHTML = `<p class="redbubble-error">Error: ${
      document.createElement('span').appendChild(document.createTextNode(err.message)).parentNode.innerHTML
    }</p>`;
  } finally {
    unsubRbStream?.();
    btn.disabled  = false;
    btn.innerHTML = originalHTML;
  }
}

function closeRedbubbleSection() {
  document.getElementById('redbubbleSection')?.classList.add('hidden');
  _lastRedbubblePitch = '';
}

async function copyRedbubblePitch() {
  if (!_lastRedbubblePitch) return;
  try {
    await navigator.clipboard.writeText(_lastRedbubblePitch);
    const btn = document.getElementById('redbubbleCopyBtn');
    const original = btn.innerHTML;
    btn.innerHTML = `${icon('check')} Copied!`;
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch {
    showNotification('Failed to copy to clipboard', 'error');
  }
}

async function exportRedbubblePitch() {
  if (!_lastRedbubblePitch) return;
  const filename = 'redbubble-listing-' + Date.now() + '.md';
  const result = await window.electronAPI.exportMarkdown({ content: _lastRedbubblePitch, defaultName: filename });
  if (result.success) showStatus('Listing exported!', 'success');
  else if (!result.canceled) showStatus('Export failed: ' + result.error, 'error');
}

// ===== ETSY LISTING =====

async function generateEtsyListing() {
  const description = document.getElementById('outputText').value.trim();
  if (!description) return;
  if (!await checkBudget()) return;

  const btn = document.getElementById('etsyListingBtn');
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="loader" aria-hidden="true"></span> Generating...';

  const section = document.getElementById('etsySection');
  const output  = document.getElementById('etsyOutput');
  section.classList.remove('hidden');
  output.innerHTML = '<p class="redbubble-loading">Generating Etsy listing\u2026</p>';
  output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let unsubEtsyStream = null;
  try {
    const model     = document.getElementById('modelSelect').value;
    const requestId = `etsy-${Date.now()}`;
    // Fix #9: simple accumulator avoids repeated DOM serialisation
    let streamBuffer = '';
    unsubEtsyStream = window.electronAPI.onStreamChunk((data) => {
      if (data.requestId !== requestId) return;
      streamBuffer += data.chunk;
      let pre = output.querySelector('pre.stream-preview');
      if (!pre) {
        pre = document.createElement('pre');
        pre.className = 'stream-preview';
        pre.style.cssText = 'white-space:pre-wrap;font-family:inherit;margin:0';
        output.innerHTML = '';
        output.appendChild(pre);
      }
      pre.textContent = streamBuffer;
    });
    const result    = await window.electronAPI.generateEtsyListing({ requestId, description, model });

    if (result.success) {
      _lastEtsyListing = result.listing;
      output.innerHTML = renderMarkdown(result.listing);

      const cost = result.usage?.cost ?? 0;
      document.getElementById('etsyCost').textContent = '$' + cost.toFixed(4);
      sessionCost  += cost;
      tokensUsed   += result.usage?.totalTokens || 0;
      updateCostDisplay();
      announce('Etsy listing generated.');
    } else if (result.cancelled) {
      output.innerHTML = '<p class="redbubble-error">Generation cancelled.</p>';
    } else {
      output.innerHTML = '<p class="redbubble-error">Error: ' +
        document.createElement('span').appendChild(document.createTextNode(result.error || 'Unknown error')).parentNode.innerHTML +
        '</p>';
    }
  } catch (err) {
    output.innerHTML = '<p class="redbubble-error">Error: ' +
      document.createElement('span').appendChild(document.createTextNode(err.message)).parentNode.innerHTML +
      '</p>';
  } finally {
    unsubEtsyStream?.();
    btn.disabled  = false;
    btn.innerHTML = originalHTML;
  }
}

function closeEtsySection() {
  document.getElementById('etsySection')?.classList.add('hidden');
  _lastEtsyListing = '';
}

async function copyEtsyListing() {
  if (!_lastEtsyListing) return;
  try {
    await navigator.clipboard.writeText(_lastEtsyListing);
    const btn = document.getElementById('etsyCopyBtn');
    const original = btn.innerHTML;
    btn.innerHTML = icon('check') + ' Copied!';
    setTimeout(() => { btn.innerHTML = original; }, 2000);
  } catch {
    showNotification('Failed to copy to clipboard', 'error');
  }
}

async function exportEtsyListing() {
  if (!_lastEtsyListing) return;
  const filename = 'etsy-listing-' + Date.now() + '.md';
  const result = await window.electronAPI.exportMarkdown({ content: _lastEtsyListing, defaultName: filename });
  if (result.success) showStatus('Listing exported!', 'success');
  else if (!result.canceled) showStatus('Export failed: ' + result.error, 'error');
}

// ===== BOOTSTRAP =====

document.addEventListener('DOMContentLoaded', async () => {
  setUiEnabled(false);
  await init();
  setUiEnabled(true);
});
