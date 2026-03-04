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

  const panel = document.getElementById('panel-dashboard');
  const btnOpen = document.getElementById('btn-dashboard');
  const btnClose = document.getElementById('btn-dashboard-close');
  const contentEl = document.getElementById('dashboard-content');

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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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

  /* -- Open / Close -- */

  function openDashboard() {
    panel.style.display = 'flex';
    contentEl.textContent = '';
    const loading = el('div', 'dashboard-loading', 'Loading...');
    contentEl.appendChild(loading);
    fetchDashboardData();
  }

  function closeDashboard() {
    panel.style.display = 'none';
  }

  async function fetchDashboardData() {
    try {
      const responses = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/history'),
      ]);

      if (!responses[0].ok || !responses[1].ok) {
        contentEl.textContent = '';
        contentEl.appendChild(el('div', 'dashboard-error', 'Failed to load data'));
        return;
      }

      const stats = await responses[0].json();
      const history = await responses[1].json();
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
    const detection = stats.detection || {};
    const classification = stats.classification || {};
    const section = el('div', 'dashboard-section');

    const title = el('h3', 'dashboard-section__title', 'Models');
    section.appendChild(title);

    const cards = el('div', 'model-cards');

    // Detection model card
    const detCard = el('div', 'model-card');
    const detHeader = el('div', 'model-card__header');
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
      const metricsDiv = el('div', 'model-card__metrics');
      metricsDiv.appendChild(buildMetric('mAP50', detection.mAP50));
      if (detection.precision) metricsDiv.appendChild(buildMetric('Precision', detection.precision));
      if (detection.recall) metricsDiv.appendChild(buildMetric('Recall', detection.recall));
      detCard.appendChild(metricsDiv);
    }
    cards.appendChild(detCard);

    // Classification model card
    const clsCard = el('div', 'model-card');
    const clsHeader = el('div', 'model-card__header');
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

    const actionsDiv = el('div', 'model-card__actions');
    const reencodeBtn = document.createElement('button');
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
    const row = el('div', 'model-card__row');
    row.appendChild(el('span', 'model-card__label', label));
    row.appendChild(el('span', null, String(value)));
    return row;
  }

  function buildMetric(label, value) {
    const div = el('div', 'model-card__metric');
    div.appendChild(el('span', 'model-card__metric-value', String(value)));
    div.appendChild(el('span', 'model-card__metric-label', label));
    return div;
  }

  /* -- Dataset Section -- */

  function buildDatasetSection(stats) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Dataset'));

    // Summary badges
    const summary = el('div', 'dataset-summary');
    summary.appendChild(buildStatBadge(stats.labeled_images, 'labeled'));
    summary.appendChild(buildStatBadge(stats.total_crops, 'crops'));
    summary.appendChild(buildStatBadge(stats.total_refs, 'references'));
    section.appendChild(summary);

    // Per-category bars
    const refs = stats.refs_per_category || stats.refs_per_brand || {};
    const crops = stats.crops_per_category || stats.crops_per_brand || {};
    const categoryNames = Object.keys(refs);
    categoryNames.sort(function (a, b) { return (refs[b] || 0) - (refs[a] || 0); });

    let maxCount = 0;
    categoryNames.forEach(function (b) { if (refs[b] > maxCount) maxCount = refs[b]; });

    const barsContainer = el('div', 'dataset-bars');
    categoryNames.forEach(function (name) {
      const refCount = refs[name] || 0;
      const cropCount = crops[name] || 0;
      const pct = maxCount > 0 ? Math.round(refCount / maxCount * 100) : 0;
      const displayName = name.replace(/_/g, ' ');

      const bar = el('div', 'dataset-bar');

      bar.appendChild(el('div', 'dataset-bar__label', displayName));

      const track = el('div', 'dataset-bar__track');
      const fill = el('div', 'dataset-bar__fill');
      fill.style.width = pct + '%';
      track.appendChild(fill);
      bar.appendChild(track);

      const countEl = el('div', 'dataset-bar__count', String(refCount));
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
    const badge = el('div', 'stat-badge');
    badge.appendChild(el('span', 'stat-badge__value', String(value || 0)));
    badge.appendChild(el('span', 'stat-badge__label', label));
    return badge;
  }

  /* -- Export Section -- */

  function buildExportSection() {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Export Labels'));

    const row = el('div', 'export-row');

    const select = document.createElement('select');
    select.id = 'export-format';
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

      // Trigger download from response blob
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Determine file extension from format
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

  /* -- History Section -- */

  function buildHistorySection(history) {
    const section = el('div', 'dashboard-section');
    section.appendChild(el('h3', 'dashboard-section__title', 'Labeling History'));

    if (!history || history.length === 0) {
      section.appendChild(el('p', 'dashboard-empty', 'No labeled images yet'));
      return section;
    }

    const list = el('div', 'history-list');

    history.forEach(function (item) {
      const card = el('div', 'history-card');

      // Header: filename + date
      const header = el('div', 'history-card__header');
      header.appendChild(el('span', 'history-card__file', item.source_file || item.image_id));

      let dateStr = '';
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
      const tagsDiv = el('div', 'history-card__tags');
      const summary = item.brand_summary || item.category_summary || {};
      Object.keys(summary).forEach(function (category) {
        const count = summary[category];
        let cls = 'label-tag';
        if (category === 'unknown' || category === 'not_product') cls += ' label-tag--muted';

        const tag = el('span', cls, category + (count > 1 ? ' \u00d7' + count : ''));
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
    const btn = document.getElementById('btn-reencode');
    if (!btn || btn.disabled) return;

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = 'Encoding...';
    btn.classList.add('btn--loading');

    try {
      const response = await fetch('/api/reencode', { method: 'POST' });
      const data = await response.json();

      if (response.ok) {
        const secs = Math.round((data.duration_ms || 0) / 1000);
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
