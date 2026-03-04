/**
 * BoxFlow — Dashboard panel
 *
 * Displays model stats, dataset info, labeling history, and export controls.
 *
 * Note: All rendered content originates from our own backend API.
 * Category names and filenames are escaped via textContent where displayed
 * in user-facing areas.
 */
(function () {
  'use strict';

  var panel = document.getElementById('panel-dashboard');
  var btnOpen = document.getElementById('btn-dashboard');
  var btnClose = document.getElementById('btn-dashboard-close');
  var contentEl = document.getElementById('dashboard-content');

  if (!panel || !btnOpen || !btnClose || !contentEl) return;

  btnOpen.addEventListener('click', openDashboard);
  btnClose.addEventListener('click', closeDashboard);

  panel.addEventListener('click', function (e) {
    if (e.target === panel) closeDashboard();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.style.display !== 'none') {
      closeDashboard();
    }
  });

  /* -- Helpers -- */

  function esc(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function el(tag, cls, children) {
    var node = document.createElement(tag);
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

  /* -- Open / Close -- */

  function openDashboard() {
    panel.style.display = 'flex';
    contentEl.textContent = '';
    var loading = el('div', 'dashboard-loading', 'Loading...');
    contentEl.appendChild(loading);
    fetchDashboardData();
  }

  function closeDashboard() {
    panel.style.display = 'none';
  }

  async function fetchDashboardData() {
    try {
      var responses = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/history'),
      ]);

      if (!responses[0].ok || !responses[1].ok) {
        contentEl.textContent = '';
        contentEl.appendChild(el('div', 'dashboard-error', 'Failed to load data'));
        return;
      }

      var stats = await responses[0].json();
      var history = await responses[1].json();
      renderDashboard(stats, history);
    } catch (err) {
      contentEl.textContent = '';
      contentEl.appendChild(el('div', 'dashboard-error', 'Error: ' + err.message));
    }
  }

  function renderDashboard(stats, history) {
    contentEl.textContent = '';
    contentEl.appendChild(buildModelsSection(stats));
    contentEl.appendChild(buildDatasetSection(stats));
    contentEl.appendChild(buildExportSection());
    contentEl.appendChild(buildHistorySection(history));
  }

  /* -- Models Section -- */

  function buildModelsSection(stats) {
    var detection = stats.detection || {};
    var classification = stats.classification || {};
    var section = el('div', 'dashboard-section');

    var title = el('h3', 'dashboard-section__title', 'Models');
    section.appendChild(title);

    var cards = el('div', 'model-cards');

    // Detection model card
    var detCard = el('div', 'model-card');
    var detHeader = el('div', 'model-card__header');
    detHeader.appendChild(el('span', 'model-card__name', 'Detection'));
    if (detection.weight_size_mb) {
      detHeader.appendChild(el('span', 'model-card__badge', detection.weight_size_mb + ' MB'));
    }
    detCard.appendChild(detHeader);

    detCard.appendChild(buildRow('Model', detection.weight_file || 'N/A'));
    if (detection.input_size) {
      detCard.appendChild(buildRow('Input', detection.input_size + 'px'));
    }
    if (detection.classes) {
      detCard.appendChild(buildRow('Classes', String(detection.classes)));
    }

    if (detection.mAP50) {
      var metricsDiv = el('div', 'model-card__metrics');
      metricsDiv.appendChild(buildMetric('mAP50', detection.mAP50));
      if (detection.precision) metricsDiv.appendChild(buildMetric('Precision', detection.precision));
      if (detection.recall) metricsDiv.appendChild(buildMetric('Recall', detection.recall));
      detCard.appendChild(metricsDiv);
    }
    cards.appendChild(detCard);

    // Classification model card
    var clsCard = el('div', 'model-card');
    var clsHeader = el('div', 'model-card__header');
    clsHeader.appendChild(el('span', 'model-card__name', 'Classification'));
    clsHeader.appendChild(el('span', 'model-card__badge', classification.ready ? 'Ready' : 'Not loaded'));
    clsCard.appendChild(clsHeader);

    clsCard.appendChild(buildRow('Model', classification.model || 'N/A'));
    if (classification.gallery_images !== undefined) {
      clsCard.appendChild(buildRow('Gallery', classification.gallery_images + ' images'));
    }
    if (classification.categories !== undefined) {
      clsCard.appendChild(buildRow('Categories', String(classification.categories)));
    }

    var actionsDiv = el('div', 'model-card__actions');
    var reencodeBtn = document.createElement('button');
    reencodeBtn.id = 'btn-reencode';
    reencodeBtn.className = 'btn btn--sm btn--accent';
    reencodeBtn.textContent = 'Re-encode';
    reencodeBtn.addEventListener('click', triggerReencode);
    actionsDiv.appendChild(reencodeBtn);
    clsCard.appendChild(actionsDiv);

    cards.appendChild(clsCard);
    section.appendChild(cards);
    return section;
  }

  function buildRow(label, value) {
    var row = el('div', 'model-card__row');
    row.appendChild(el('span', 'model-card__label', label));
    row.appendChild(el('span', null, String(value)));
    return row;
  }

  function buildMetric(label, value) {
    var div = el('div', 'model-card__metric');
    div.appendChild(el('span', 'model-card__metric-value', String(value)));
    div.appendChild(el('span', 'model-card__metric-label', label));
    return div;
  }

  /* -- Dataset Section -- */

  function buildDatasetSection(stats) {
    var section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Dataset'));

    // Summary badges
    var summary = el('div', 'dataset-summary');
    summary.appendChild(buildStatBadge(stats.labeled_images, 'labeled'));
    summary.appendChild(buildStatBadge(stats.total_crops, 'crops'));
    summary.appendChild(buildStatBadge(stats.total_refs, 'references'));
    section.appendChild(summary);

    // Per-category bars
    var refs = stats.refs_per_category || stats.refs_per_brand || {};
    var crops = stats.crops_per_category || stats.crops_per_brand || {};
    var categoryNames = Object.keys(refs);
    categoryNames.sort(function (a, b) { return (refs[b] || 0) - (refs[a] || 0); });

    var maxCount = 0;
    categoryNames.forEach(function (b) { if (refs[b] > maxCount) maxCount = refs[b]; });

    var barsContainer = el('div', 'dataset-bars');
    categoryNames.forEach(function (name) {
      var refCount = refs[name] || 0;
      var cropCount = crops[name] || 0;
      var pct = maxCount > 0 ? Math.round(refCount / maxCount * 100) : 0;
      var displayName = name.replace(/_/g, ' ');

      var bar = el('div', 'dataset-bar');

      bar.appendChild(el('div', 'dataset-bar__label', displayName));

      var track = el('div', 'dataset-bar__track');
      var fill = el('div', 'dataset-bar__fill');
      fill.style.width = pct + '%';
      track.appendChild(fill);
      bar.appendChild(track);

      var countEl = el('div', 'dataset-bar__count', String(refCount));
      if (cropCount > 0) {
        countEl.appendChild(el('span', 'dataset-bar__crops', ' +' + cropCount));
      }
      bar.appendChild(countEl);

      barsContainer.appendChild(bar);
    });

    section.appendChild(barsContainer);
    return section;
  }

  function buildStatBadge(value, label) {
    var badge = el('div', 'stat-badge');
    badge.appendChild(el('span', 'stat-badge__value', String(value || 0)));
    badge.appendChild(el('span', 'stat-badge__label', label));
    return badge;
  }

  /* -- Export Section -- */

  function buildExportSection() {
    var section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Export Labels'));

    var row = el('div', 'export-row');

    var select = document.createElement('select');
    select.id = 'export-format';
    select.className = 'export-select';

    var formats = [
      { value: 'yolo', label: 'YOLO (txt)' },
      { value: 'coco', label: 'COCO JSON' },
      { value: 'voc', label: 'Pascal VOC (xml)' },
      { value: 'csv', label: 'CSV' },
    ];

    formats.forEach(function (fmt) {
      var opt = document.createElement('option');
      opt.value = fmt.value;
      opt.textContent = fmt.label;
      select.appendChild(opt);
    });

    row.appendChild(select);

    var exportBtn = document.createElement('button');
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
      var response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: format }),
      });

      if (!response.ok) {
        var errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'Export failed');
      }

      // Trigger download from response blob
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;

      // Determine file extension from format
      var extensions = { yolo: 'zip', coco: 'json', voc: 'zip', csv: 'csv' };
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

  /* -- History Section -- */

  function buildHistorySection(history) {
    var section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Labeling History'));

    if (!history || history.length === 0) {
      section.appendChild(el('p', 'dashboard-empty', 'No labeled images yet'));
      return section;
    }

    var list = el('div', 'history-list');

    history.forEach(function (item) {
      var card = el('div', 'history-card');

      // Header: filename + date
      var header = el('div', 'history-card__header');
      header.appendChild(el('span', 'history-card__file', item.source_file || item.image_id));

      var dateStr = '';
      if (item.labeled_at) {
        try {
          dateStr = new Date(item.labeled_at).toLocaleDateString('en-US', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        } catch (_) { dateStr = item.labeled_at; }
      }
      header.appendChild(el('span', 'history-card__date', dateStr));
      card.appendChild(header);

      // Meta: box count + resolution
      card.appendChild(el('div', 'history-card__meta',
        item.boxes_count + ' boxes \u00b7 ' + (item.width || 0) + '\u00d7' + (item.height || 0)));

      // Category tags
      var tagsDiv = el('div', 'history-card__tags');
      var summary = item.brand_summary || item.category_summary || {};
      Object.keys(summary).forEach(function (category) {
        var count = summary[category];
        var cls = 'brand-tag';
        if (category === 'unknown' || category === 'not_product') cls += ' brand-tag--muted';

        var tag = el('span', cls, category + (count > 1 ? ' \u00d7' + count : ''));
        tagsDiv.appendChild(tag);
      });
      card.appendChild(tagsDiv);

      list.appendChild(card);
    });

    section.appendChild(list);
    return section;
  }

  /* -- Re-encode -- */

  async function triggerReencode() {
    var btn = document.getElementById('btn-reencode');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    var origText = btn.textContent;
    btn.textContent = 'Encoding...';
    btn.classList.add('btn--loading');

    try {
      var response = await fetch('/api/reencode', { method: 'POST' });
      var data = await response.json();

      if (response.ok) {
        var secs = Math.round((data.duration_ms || 0) / 1000);
        window.showToast(
          'Re-encode: ' + (data.images || 0) + ' images, ' +
          (data.categories || data.brands || 0) + ' categories (' + secs + 's)',
          'success'
        );
        fetchDashboardData();
      } else {
        window.showToast('Re-encode failed: ' + (data.detail || 'unknown error'), 'error');
      }
    } catch (err) {
      window.showToast('Re-encode error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
      btn.classList.remove('btn--loading');
    }
  }

})();
