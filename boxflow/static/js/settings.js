/**
 * BoxFlow — Settings Panel
 *
 * Manages application settings:
 *   - Detection model selection and download
 *   - Classification model selection
 *   - Category management (add/remove)
 *   - Export format preferences
 *   - Save/load settings from backend
 *
 * API endpoints:
 *   GET  /api/settings              - current settings
 *   PUT  /api/settings              - update settings
 *   GET  /api/models/detection      - available detection models
 *   GET  /api/models/classification - available classification models
 *   POST /api/export                - export labels
 */
(function () {
  'use strict';

  const panel = document.getElementById('panel-settings');
  const btnOpen = document.getElementById('btn-settings');

  if (!panel || !btnOpen) return;

  let isOpen = false;

  btnOpen.addEventListener('click', function () {
    if (isOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      closeSettings();
    }
  });

  /* -- Helpers -- */

  function el(tag, cls, children) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (typeof children === 'string') node.textContent = children;
    if (Array.isArray(children)) children.forEach(function (c) {
      if (typeof c === 'string') {
        node.appendChild(document.createTextNode(c));
      } else if (c) {
        node.appendChild(c);
      }
    });
    return node;
  }

  function clearChildren(parentEl) {
    while (parentEl.firstChild) {
      parentEl.removeChild(parentEl.firstChild);
    }
  }

  /* -- Open / Close -- */

  function openSettings() {
    isOpen = true;
    panel.style.display = 'flex';
    buildSettingsPanel();
    loadAllData();
  }

  function closeSettings() {
    isOpen = false;
    panel.style.display = 'none';
  }

  function buildSettingsPanel() {
    clearChildren(panel);

    const inner = el('div', 'settings-panel__inner');

    // Header
    const header = el('div', 'dashboard-header');
    header.appendChild(el('h2', 'dashboard-header__title', 'Settings'));
    const closeBtn = document.createElement('button');
    closeBtn.className = 'dashboard-header__close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', closeSettings);
    header.appendChild(closeBtn);
    inner.appendChild(header);

    // Content area
    const content = el('div', 'dashboard-content');
    content.id = 'settings-content';
    content.appendChild(el('div', 'dashboard-loading', 'Loading...'));
    inner.appendChild(content);

    panel.appendChild(inner);

    // Click outside to close
    panel.addEventListener('click', function (e) {
      if (e.target === panel) closeSettings();
    });
  }

  /* -- Data Loading -- */

  async function loadAllData() {
    const content = document.getElementById('settings-content');
    if (!content) return;

    try {
      const results = await Promise.all([
        fetch('/api/settings').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
        fetch('/api/models/detection').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
        fetch('/api/models/classification').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
        fetch('/api/categories').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
      ]);

      const settings = results[0];
      const detectionModels = results[1];
      const classificationModels = results[2];
      const categories = results[3];

      renderSettings(content, settings, detectionModels, classificationModels, categories);
    } catch (err) {
      content.textContent = '';
      content.appendChild(el('div', 'dashboard-error', 'Failed to load settings: ' + err.message));
    }
  }

  function renderSettings(content, settings, detectionModels, classificationModels, categories) {
    clearChildren(content);

    content.appendChild(buildDetectionSection(settings, detectionModels));
    content.appendChild(buildClassificationSection(settings, classificationModels));
    content.appendChild(buildCategorySection(categories));
    content.appendChild(buildExportSection(settings));
    content.appendChild(buildSaveSection(settings));
  }

  /* -- Detection Models Section -- */

  function buildDetectionSection(settings, models) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Detection Model'));

    var allModels = [];
    if (Array.isArray(models)) {
      models.forEach(function (provider) {
        if (provider.models) {
          provider.models.forEach(function (m) { allModels.push(m); });
        }
      });
    }

    if (allModels.length === 0) {
      section.appendChild(el('p', 'dashboard-empty', 'No detection models available'));
      return section;
    }

    const list = el('div', 'model-list');

    allModels.forEach(function (model) {
      const item = el('div', 'model-item');
      const isActive = settings.detection_model === model.name;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'detection-model';
      radio.value = model.name;
      radio.checked = isActive;
      radio.disabled = !model.installed;
      radio.addEventListener('change', function () {
        settings.detection_model = model.name;
      });
      item.appendChild(radio);

      const info = el('div', 'model-item__info');
      info.appendChild(el('span', 'model-item__name', model.name));
      if (model.size_mb) {
        info.appendChild(el('span', 'model-item__size', model.size_mb + ' MB'));
      }
      item.appendChild(info);

      if (model.installed) {
        item.appendChild(el('span', 'model-item__badge model-item__badge--ready', 'Downloaded'));
      } else {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn--sm btn--secondary';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', function () {
          downloadModel('detection', model.name, item);
        });
        item.appendChild(dlBtn);
      }

      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  /* -- Classification Models Section -- */

  function buildClassificationSection(settings, models) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Classification Model'));

    var allModels = [];
    if (Array.isArray(models)) {
      models.forEach(function (provider) {
        if (provider.models) {
          provider.models.forEach(function (m) { allModels.push(m); });
        }
      });
    }

    const list = el('div', 'model-list');

    const noneItem = el('div', 'model-item');
    const noneRadio = document.createElement('input');
    noneRadio.type = 'radio';
    noneRadio.name = 'classification-model';
    noneRadio.value = 'none';
    noneRadio.checked = !settings.classifier_model || settings.classifier_model === 'none';
    noneRadio.addEventListener('change', function () {
      settings.classifier_model = 'none';
    });
    noneItem.appendChild(noneRadio);
    noneItem.appendChild(el('div', 'model-item__info', [
      el('span', 'model-item__name', 'None (manual only)'),
    ]));
    list.appendChild(noneItem);

    allModels.forEach(function (model) {
      const item = el('div', 'model-item');
      const isActive = settings.classifier_model === model.name;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'classification-model';
      radio.value = model.name;
      radio.checked = isActive;
      radio.disabled = !model.installed;
      radio.addEventListener('change', function () {
        settings.classifier_model = model.name;
      });
      item.appendChild(radio);

      const info = el('div', 'model-item__info');
      info.appendChild(el('span', 'model-item__name', model.name));
      if (model.size_mb) {
        info.appendChild(el('span', 'model-item__size', model.size_mb + ' MB'));
      }
      item.appendChild(info);

      if (model.installed) {
        item.appendChild(el('span', 'model-item__badge model-item__badge--ready', 'Downloaded'));
      } else {
        const dlBtn = document.createElement('button');
        dlBtn.className = 'btn btn--sm btn--secondary';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', function () {
          downloadModel('classification', model.name, item);
        });
        item.appendChild(dlBtn);
      }

      list.appendChild(item);
    });

    section.appendChild(list);
    return section;
  }

  /* -- Category Manager Section -- */

  function buildCategorySection(categories) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Categories'));

    const manager = el('div', 'category-manager');

    // Category list
    const catList = el('div', 'category-manager__list');
    catList.id = 'category-list';

    if (Array.isArray(categories)) {
      categories.forEach(function (cat) {
        const catName = typeof cat === 'string' ? cat : cat.name;
        catList.appendChild(buildCategoryItem(catName));
      });
    }

    manager.appendChild(catList);

    // Add category row
    const addRow = el('div', 'category-manager__add');
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'category-manager__input';
    addInput.placeholder = 'New category name...';
    addInput.maxLength = 50;
    addRow.appendChild(addInput);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn--sm btn--primary';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', function () {
      const name = addInput.value.trim();
      if (name) {
        addCategory(name, addInput);
      }
    });
    addRow.appendChild(addBtn);

    addInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = addInput.value.trim();
        if (name) {
          addCategory(name, addInput);
        }
      }
    });

    manager.appendChild(addRow);
    section.appendChild(manager);
    return section;
  }

  function buildCategoryItem(name) {
    const item = el('div', 'category-manager__item');
    item.appendChild(el('span', 'category-manager__name', name));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'category-manager__remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove category';
    removeBtn.addEventListener('click', function () {
      removeCategory(name, item);
    });
    item.appendChild(removeBtn);

    return item;
  }

  async function addCategory(name, inputEl) {
    try {
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'HTTP ' + response.status);
      }

      const data = await response.json();
      const catList = document.getElementById('category-list');
      if (catList) {
        catList.appendChild(buildCategoryItem(data.name));
      }
      inputEl.value = '';
      window.showToast('Category "' + data.name + '" added', 'success');
    } catch (err) {
      window.showToast('Error adding category: ' + err.message, 'error');
    }
  }

  async function removeCategory(name, itemEl) {
    try {
      const response = await fetch('/api/categories/' + encodeURIComponent(name), {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'HTTP ' + response.status);
      }

      if (itemEl && itemEl.parentNode) {
        itemEl.parentNode.removeChild(itemEl);
      }
      window.showToast('Category "' + name + '" removed', 'success');
    } catch (err) {
      window.showToast('Error removing category: ' + err.message, 'error');
    }
  }

  /* -- Export Section -- */

  function buildExportSection(settings) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Export Labels'));

    const row = el('div', 'export-row');

    const select = document.createElement('select');
    select.id = 'settings-export-format';
    select.className = 'export-select';

    const formats = [
      { value: 'yolo', label: 'YOLO (txt)' },
      { value: 'coco', label: 'COCO JSON' },
      { value: 'voc', label: 'Pascal VOC (xml)' },
      { value: 'csv', label: 'CSV' },
    ];

    formats.forEach(function (fmt) {
      const opt = document.createElement('option');
      opt.value = fmt.value;
      opt.textContent = fmt.label;
      if (settings.export_format === fmt.value) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    row.appendChild(select);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'btn btn--sm btn--primary';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', function () {
      triggerExport(select.value);
    });
    row.appendChild(exportBtn);

    section.appendChild(row);
    return section;
  }

  async function triggerExport(format) {
    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: format }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const extensions = { yolo: 'zip', coco: 'json', voc: 'zip', csv: 'csv' };
      a.download = 'labels.' + (extensions[format] || 'zip');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.showToast('Labels exported as ' + format.toUpperCase(), 'success');
    } catch (err) {
      window.showToast('Export error: ' + err.message, 'error');
    }
  }

  /* -- Save Settings Section -- */

  function buildSaveSection(settings) {
    const section = el('div', 'dashboard-section');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn--primary btn--block';
    saveBtn.textContent = 'Save Settings';
    saveBtn.addEventListener('click', function () {
      saveSettings(settings);
    });
    section.appendChild(saveBtn);

    return section;
  }

  async function saveSettings(settings) {
    // Collect current selections from the form
    const detRadio = document.querySelector('input[name="detection-model"]:checked');
    const clsRadio = document.querySelector('input[name="classification-model"]:checked');
    const formatSelect = document.getElementById('settings-export-format');

    const payload = {
      detection_model: detRadio ? detRadio.value : settings.detection_model,
      classification_model: clsRadio ? clsRadio.value : settings.classification_model,
      export_format: formatSelect ? formatSelect.value : settings.export_format,
    };

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'HTTP ' + response.status);
      }

      window.showToast('Settings saved', 'success');
    } catch (err) {
      window.showToast('Error saving settings: ' + err.message, 'error');
    }
  }

  /* -- Model Download -- */

  async function downloadModel(modelType, modelName, itemEl) {
    // Show progress bar
    const progressWrap = el('div', 'progress-bar-download');
    const progressFill = el('div', 'progress-bar-download__fill');
    progressWrap.appendChild(progressFill);
    itemEl.appendChild(progressWrap);

    // Disable the download button
    const dlBtn = itemEl.querySelector('.btn');
    if (dlBtn) {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Downloading...';
    }

    try {
      const response = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: modelType, model_name: modelName }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'Download failed');
      }

      // Simulate progress (real progress would require SSE/WebSocket)
      progressFill.style.width = '100%';

      window.showToast('Model "' + modelName + '" downloaded', 'success');

      // Refresh settings panel
      setTimeout(function () {
        loadAllData();
      }, 500);
    } catch (err) {
      window.showToast('Download error: ' + err.message, 'error');

      if (dlBtn) {
        dlBtn.disabled = false;
        dlBtn.textContent = 'Download';
      }
      if (progressWrap.parentNode) {
        progressWrap.parentNode.removeChild(progressWrap);
      }
    }
  }

})();
