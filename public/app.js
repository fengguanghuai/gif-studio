const state = {
  models: [],
  presets: [],
  selectedModelId: '',
  selectedPresetId: '',
  mode: 'auto', // 'auto' | 'custom'
  refFile: null,
  refPreviewUrl: null,
  usePreset: true,
  customTemplateEdited: false,
  customTemplate: '',
  history: [],
  activeItem: null,
  generating: false
};

const els = {
  apiStatusDot: document.getElementById('apiStatusDot'),
  apiAlert: document.getElementById('apiAlert'),
  modelSelect: document.getElementById('modelSelect'),
  modeAutoBtn: document.getElementById('modeAutoBtn'),
  modeCustomBtn: document.getElementById('modeCustomBtn'),
  presetPills: document.getElementById('presetPills'),
  uploadZone: document.getElementById('uploadZone'),
  refFileInput: document.getElementById('refFileInput'),
  uploadEmpty: document.getElementById('uploadEmpty'),
  uploadPreview: document.getElementById('uploadPreview'),
  refThumbImg: document.getElementById('refThumbImg'),
  refFileName: document.getElementById('refFileName'),
  refFileSize: document.getElementById('refFileSize'),
  clearRefBtn: document.getElementById('clearRefBtn'),
  promptInput: document.getElementById('promptInput'),
  inspirationsRow: document.getElementById('inspirationsRow'),
  autoPresetBar: document.getElementById('autoPresetBar'),
  autoPresetSummary: document.getElementById('autoPresetSummary'),
  togglePreviewPromptBtn: document.getElementById('togglePreviewPromptBtn'),
  presetPreviewDrawer: document.getElementById('presetPreviewDrawer'),
  presetSourceNote: document.getElementById('presetSourceNote'),
  presetVariantBadge: document.getElementById('presetVariantBadge'),
  assembledPromptPreview: document.getElementById('assembledPromptPreview'),
  advancedPanel: document.getElementById('advancedPanel'),
  resetAdvBtn: document.getElementById('resetAdvBtn'),
  frameCountInput: document.getElementById('frameCountInput'),
  frameCountVal: document.getElementById('frameCountVal'),
  frameDurationInput: document.getElementById('frameDurationInput'),
  frameDurationVal: document.getElementById('frameDurationVal'),
  backgroundSelect: document.getElementById('backgroundSelect'),
  qualitySelect: document.getElementById('qualitySelect'),
  complexitySelect: document.getElementById('complexitySelect'),
  usePresetToggle: document.getElementById('usePresetToggle'),
  usePresetLabel: document.getElementById('usePresetLabel'),
  templateEditorWrap: document.getElementById('templateEditorWrap'),
  customTemplateInput: document.getElementById('customTemplateInput'),
  resetTemplateBtn: document.getElementById('resetTemplateBtn'),
  generateBtn: document.getElementById('generateBtn'),
  btnSpinner: document.getElementById('btnSpinner'),
  btnText: document.getElementById('btnText'),
  previewMeta: document.getElementById('previewMeta'),
  stageEmpty: document.getElementById('stageEmpty'),
  stageLoading: document.getElementById('stageLoading'),
  loadingTimer: document.getElementById('loadingTimer'),
  resultGif: document.getElementById('resultGif'),
  previewActions: document.getElementById('previewActions'),
  downloadBtn: document.getElementById('downloadBtn'),
  inspectResultPromptBtn: document.getElementById('inspectResultPromptBtn'),
  reusePromptBtn: document.getElementById('reusePromptBtn'),
  resultPromptBox: document.getElementById('resultPromptBox'),
  resultPromptText: document.getElementById('resultPromptText'),
  closeResultPromptBtn: document.getElementById('closeResultPromptBtn'),
  galleryCount: document.getElementById('galleryCount'),
  galleryGrid: document.getElementById('galleryGrid')
};

function currentPreset() {
  return state.presets.find((p) => p.id === state.selectedPresetId) || state.presets[0];
}

function defaultTemplateForCurrentState() {
  const preset = currentPreset();
  if (!preset) return '';
  return state.refFile ? preset.templateWithRef : preset.templateTextOnly;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function showAlert(msg) {
  if (!msg) {
    els.apiAlert.classList.add('hidden');
    els.apiAlert.textContent = '';
    return;
  }
  els.apiAlert.textContent = msg;
  els.apiAlert.classList.remove('hidden');
}

function renderModels() {
  els.modelSelect.innerHTML = '';
  for (const m of state.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.badge ? `${m.label} · ${m.badge}` : m.label;
    if (m.id === state.selectedModelId) opt.selected = true;
    els.modelSelect.appendChild(opt);
  }
}

function renderPresets() {
  els.presetPills.innerHTML = '';
  for (const p of state.presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `preset-pill${p.id === state.selectedPresetId ? ' active' : ''}`;
    btn.textContent = p.name;
    btn.addEventListener('click', () => selectPreset(p.id));
    els.presetPills.appendChild(btn);
  }
}

function renderInspirations() {
  const preset = currentPreset();
  els.inspirationsRow.innerHTML = '';
  if (!preset?.inspirations?.length) return;
  for (const text of preset.inspirations) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'insp-chip';
    chip.textContent = text;
    chip.addEventListener('click', () => {
      els.promptInput.value = text;
      els.promptInput.focus();
      updatePromptPreview();
    });
    els.inspirationsRow.appendChild(chip);
  }
}

function applyPresetDefaultsToAdvanced() {
  const preset = currentPreset();
  if (!preset) return;
  const d = preset.defaults;
  els.frameCountInput.value = String(d.frameCount);
  els.frameCountVal.textContent = `${d.frameCount} 帧`;
  els.frameDurationInput.value = String(d.frameDurationMs);
  els.frameDurationVal.textContent = `${d.frameDurationMs} ms`;
  els.backgroundSelect.value = d.background;
  els.qualitySelect.value = d.quality;
  els.complexitySelect.value = d.complexity;
  state.customTemplateEdited = false;
  state.customTemplate = defaultTemplateForCurrentState();
  els.customTemplateInput.value = state.customTemplate;
}

function selectPreset(presetId) {
  state.selectedPresetId = presetId;
  const preset = currentPreset();
  els.promptInput.placeholder = preset.placeholder;
  renderPresets();
  renderInspirations();
  applyPresetDefaultsToAdvanced();
  updatePromptPreview();
}

function updatePromptPreview() {
  const preset = currentPreset();
  if (!preset) return;
  const userText = els.promptInput.value.trim() || '（这里会填入你上面的输入）';
  const baseTpl = defaultTemplateForCurrentState();
  const assembled = baseTpl.includes('{{prompt}}')
    ? baseTpl.replaceAll('{{prompt}}', userText)
    : `${baseTpl}\n\n主题与动作：${userText}`;

  els.autoPresetSummary.textContent = `${preset.shortName} · ${preset.summary}`;
  els.presetSourceNote.textContent = preset.sourceNote || '';
  els.presetVariantBadge.textContent = state.refFile ? '图生 GIF 模板（锁角色）' : '文生 GIF 模板';
  els.assembledPromptPreview.textContent = assembled;

  if (!state.customTemplateEdited) {
    state.customTemplate = baseTpl;
    els.customTemplateInput.value = baseTpl;
  }
}

function setMode(nextMode) {
  state.mode = nextMode;
  const isCustom = nextMode === 'custom';
  els.modeAutoBtn.classList.toggle('active', !isCustom);
  els.modeAutoBtn.setAttribute('aria-selected', String(!isCustom));
  els.modeCustomBtn.classList.toggle('active', isCustom);
  els.modeCustomBtn.setAttribute('aria-selected', String(isCustom));

  els.autoPresetBar.classList.toggle('hidden', isCustom);
  els.advancedPanel.classList.toggle('hidden', !isCustom);
}

function setReferenceFile(file) {
  if (!file) {
    clearReferenceFile();
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showAlert('参考图仅支持 PNG / JPG / WebP 格式。');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showAlert('参考图大小不能超过 20 MB。');
    return;
  }
  showAlert('');
  if (state.refPreviewUrl) URL.revokeObjectURL(state.refPreviewUrl);
  state.refFile = file;
  state.refPreviewUrl = URL.createObjectURL(file);

  els.refThumbImg.src = state.refPreviewUrl;
  els.refFileName.textContent = file.name || 'pasted-image.png';
  els.refFileSize.textContent = `${formatBytes(file.size)} · 图生 GIF 模式已激活`;
  els.uploadEmpty.classList.add('hidden');
  els.uploadPreview.classList.remove('hidden');
  updatePromptPreview();
}

function clearReferenceFile() {
  if (state.refPreviewUrl) URL.revokeObjectURL(state.refPreviewUrl);
  state.refFile = null;
  state.refPreviewUrl = null;
  els.refFileInput.value = '';
  els.uploadPreview.classList.add('hidden');
  els.uploadEmpty.classList.remove('hidden');
  updatePromptPreview();
}

function showActiveItem(item) {
  state.activeItem = item;
  if (!item) {
    els.stageEmpty.classList.remove('hidden');
    els.resultGif.classList.add('hidden');
    els.previewActions.classList.add('hidden');
    els.resultPromptBox.classList.add('hidden');
    els.previewMeta.textContent = '等待生成';
    renderGallery();
    return;
  }
  els.stageEmpty.classList.add('hidden');
  els.stageLoading.classList.add('hidden');
  els.resultGif.src = item.url;
  els.resultGif.classList.remove('hidden');
  els.previewActions.classList.remove('hidden');

  const dim = item.width && item.height ? `${item.width}×${item.height}` : 'GIF';
  els.previewMeta.textContent = `${dim} · ${item.frameCount} 帧 · ${formatBytes(item.bytes)} · ${item.elapsedSeconds}s`;
  els.downloadBtn.href = `${item.url}?download=1`;
  els.downloadBtn.download = item.filename;
  els.resultPromptText.textContent = item.finalPrompt;
  renderGallery();
}

function renderGallery() {
  els.galleryCount.textContent = `${state.history.length} 个动图`;
  els.galleryGrid.innerHTML = '';
  if (!state.history.length) {
    const empty = document.createElement('div');
    empty.className = 'gallery-empty';
    empty.textContent = '还没有生成记录，在上方输入一句话试试吧。';
    els.galleryGrid.appendChild(empty);
    return;
  }
  for (const item of state.history) {
    const card = document.createElement('div');
    card.className = `gallery-item${state.activeItem?.id === item.id ? ' active' : ''}`;
    card.innerHTML = `
      <div class="gallery-thumb">
        <img src="${item.url}" alt="${escapeHtml(item.userPrompt)}" loading="lazy" />
      </div>
      <div class="gallery-info">
        <div class="gallery-prompt" title="${escapeHtml(item.userPrompt)}">${escapeHtml(item.userPrompt)}</div>
        <div class="gallery-sub">
          <span>${escapeHtml(item.presetName)} · ${formatBytes(item.bytes)}</span>
          <button type="button" class="gallery-del" data-del="${item.id}">删除</button>
        </div>
      </div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      showActiveItem(item);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    card.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteHistoryItem(item.id);
    });
    els.galleryGrid.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function deleteHistoryItem(id) {
  const resp = await fetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok) return;
  state.history = state.history.filter((x) => x.id !== id);
  if (state.activeItem?.id === id) {
    showActiveItem(state.history[0] || null);
  } else {
    renderGallery();
  }
}

async function handleGenerate() {
  if (state.generating) return;
  const prompt = els.promptInput.value.trim();
  if (!prompt) {
    showAlert('请先输入想生成的动作或表情包梗。');
    els.promptInput.focus();
    return;
  }
  showAlert('');
  state.generating = true;
  els.generateBtn.disabled = true;
  els.btnSpinner.classList.remove('hidden');
  els.btnText.textContent = '生成中…';
  els.stageEmpty.classList.add('hidden');
  els.resultGif.classList.add('hidden');
  els.previewActions.classList.add('hidden');
  els.resultPromptBox.classList.add('hidden');
  els.stageLoading.classList.remove('hidden');

  const t0 = performance.now();
  const timerId = setInterval(() => {
    const sec = ((performance.now() - t0) / 1000).toFixed(1);
    els.loadingTimer.textContent = `已耗时 ${sec} 秒（通常 12–25 秒）`;
  }, 150);

  try {
    const fd = new FormData();
    fd.append('prompt', prompt);
    fd.append('model', state.selectedModelId);
    fd.append('presetId', state.selectedPresetId);
    fd.append('mode', state.mode);

    if (state.mode === 'custom') {
      fd.append('frameCount', els.frameCountInput.value);
      fd.append('frameDurationMs', els.frameDurationInput.value);
      fd.append('background', els.backgroundSelect.value);
      fd.append('quality', els.qualitySelect.value);
      fd.append('complexity', els.complexitySelect.value);
      fd.append('usePreset', String(els.usePresetToggle.checked));
      if (els.usePresetToggle.checked) {
        fd.append('customTemplate', els.customTemplateInput.value);
      }
    }
    if (state.refFile) {
      fd.append('image', state.refFile, state.refFile.name || 'reference.png');
    }

    const resp = await fetch('/api/generate', { method: 'POST', body: fd });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data.error || `请求失败（HTTP ${resp.status}）`);
    }

    const item = data.item;
    state.history = [item, ...state.history];
    showActiveItem(item);
  } catch (err) {
    showAlert(err instanceof Error ? err.message : String(err));
    els.stageLoading.classList.add('hidden');
    if (state.activeItem) {
      showActiveItem(state.activeItem);
    } else {
      els.stageEmpty.classList.remove('hidden');
    }
  } finally {
    clearInterval(timerId);
    state.generating = false;
    els.generateBtn.disabled = false;
    els.btnSpinner.classList.add('hidden');
    els.btnText.textContent = '生成 GIF';
  }
}

function bindEvents() {
  els.modelSelect.addEventListener('change', (e) => {
    state.selectedModelId = e.target.value;
  });

  els.modeAutoBtn.addEventListener('click', () => setMode('auto'));
  els.modeCustomBtn.addEventListener('click', () => setMode('custom'));

  els.uploadZone.addEventListener('click', (e) => {
    if (e.target.closest('#clearRefBtn')) return;
    els.refFileInput.click();
  });
  els.uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.refFileInput.click();
    }
  });
  els.refFileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) setReferenceFile(e.target.files[0]);
  });
  els.clearRefBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearReferenceFile();
  });

  // Drag & Drop
  ['dragenter', 'dragover'].forEach((ev) => {
    els.uploadZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.uploadZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.uploadZone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove('dragover');
    });
  });
  els.uploadZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) setReferenceFile(file);
  });

  // Clipboard paste image anywhere
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          setReferenceFile(file);
          break;
        }
      }
    }
  });

  els.promptInput.addEventListener('input', updatePromptPreview);
  els.promptInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleGenerate();
    }
  });

  els.togglePreviewPromptBtn.addEventListener('click', () => {
    const open = els.presetPreviewDrawer.classList.toggle('hidden');
    els.togglePreviewPromptBtn.textContent = open ? '查看预制词' : '收起预制词';
  });

  els.frameCountInput.addEventListener('input', () => {
    els.frameCountVal.textContent = `${els.frameCountInput.value} 帧`;
  });
  els.frameDurationInput.addEventListener('input', () => {
    els.frameDurationVal.textContent = `${els.frameDurationInput.value} ms`;
  });

  els.usePresetToggle.addEventListener('change', () => {
    const enabled = els.usePresetToggle.checked;
    els.usePresetLabel.textContent = enabled ? '开启（自动包裹无缝循环模板）' : '关闭（纯按上方输入原文发送）';
    els.templateEditorWrap.classList.toggle('hidden', !enabled);
  });

  els.customTemplateInput.addEventListener('input', () => {
    state.customTemplateEdited = true;
    state.customTemplate = els.customTemplateInput.value;
  });

  els.resetTemplateBtn.addEventListener('click', () => {
    state.customTemplateEdited = false;
    state.customTemplate = defaultTemplateForCurrentState();
    els.customTemplateInput.value = state.customTemplate;
  });

  els.resetAdvBtn.addEventListener('click', () => {
    els.usePresetToggle.checked = true;
    els.usePresetLabel.textContent = '开启（自动包裹无缝循环模板）';
    els.templateEditorWrap.classList.remove('hidden');
    applyPresetDefaultsToAdvanced();
  });

  els.generateBtn.addEventListener('click', handleGenerate);

  els.inspectResultPromptBtn.addEventListener('click', () => {
    els.resultPromptBox.classList.toggle('hidden');
  });
  els.closeResultPromptBtn.addEventListener('click', () => {
    els.resultPromptBox.classList.add('hidden');
  });
  els.reusePromptBtn.addEventListener('click', () => {
    if (!state.activeItem) return;
    els.promptInput.value = state.activeItem.userPrompt;
    els.promptInput.focus();
    updatePromptPreview();
  });
}

async function init() {
  bindEvents();
  try {
    const [cfgResp, histResp] = await Promise.all([fetch('/api/config'), fetch('/api/history')]);
    const cfg = await cfgResp.json();
    const hist = await histResp.json();

    state.models = cfg.models || [];
    state.presets = cfg.presets || [];
    state.selectedModelId = cfg.defaultModelId || state.models[0]?.id || '';
    state.selectedPresetId = cfg.defaultPresetId || state.presets[0]?.id || '';
    state.history = hist.items || [];

    if (!cfg.apiReady) {
      els.apiStatusDot.classList.add('offline');
      showAlert('服务端尚未检测到 OPENAI_API_KEY，请通过环境变量注入后重启服务。');
    }

    renderModels();
    selectPreset(state.selectedPresetId);
    if (state.history.length) {
      showActiveItem(state.history[0]);
    } else {
      renderGallery();
    }
  } catch (err) {
    showAlert(`初始化失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

init();
