/**
 * BoxFlow — App Controller
 *
 * Manages the 3-step labeling workflow:
 *   1. Upload — drag-and-drop / file-select / queue
 *   2. BBox   — canvas editor with detections
 *   3. Classify — category classification per crop
 *
 * Exports globals: goToStep, showToast, onLabelingDone
 */

/* ================================================================
   State
   ================================================================ */

const STEPS = ['upload', 'bbox', 'classify'];

let currentStep = 'upload';
let currentImageId = null;
let detections = [];
let imageWidth = 0;
let imageHeight = 0;

/* ================================================================
   DOM references (cached once on DOMContentLoaded)
   ================================================================ */

let dom = {};

function cacheDom() {
  dom = {
    progressBar: document.getElementById('progress-bar'),
    stepButtons: {
      upload: document.getElementById('step-1'),
      bbox: document.getElementById('step-2'),
      classify: document.getElementById('step-3'),
    },
    stepContainers: {
      upload: document.getElementById('step-upload'),
      bbox: document.getElementById('step-bbox'),
      classify: document.getElementById('step-classify'),
    },
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    queueList: document.getElementById('queue-list'),
    bboxCanvas: document.getElementById('bbox-canvas'),
    bboxCount: document.getElementById('bbox-count'),
    bboxList: document.getElementById('bbox-list'),
    btnBboxDone: document.getElementById('btn-bbox-done'),
    btnBboxNext: document.getElementById('btn-bbox-next'),
    btnSaveLabels: document.getElementById('btn-save-labels'),
    cropCounter: document.getElementById('crop-counter'),
    toastContainer: document.getElementById('toast-container'),
  };
}

/* ================================================================
   Utilities
   ================================================================ */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Create an SVG element from a trusted template string.
 * Only used with hardcoded icon markup defined in this file.
 */
function createSvgIcon(svgMarkup) {
  const wrapper = document.createElement('span');
  wrapper.innerHTML = svgMarkup; // eslint-disable-line -- trusted hardcoded SVG only
  return wrapper.firstElementChild;
}

/**
 * Remove all child nodes from an element.
 */
function clearChildren(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/* ================================================================
   SVG Icon Templates (hardcoded, safe)
   ================================================================ */

const SVG_UPLOAD_ICON =
  '<svg class="drop-zone__icon" viewBox="0 0 24 24" width="64" height="64" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
    '<polyline points="17 8 12 3 7 8"/>' +
    '<line x1="12" y1="3" x2="12" y2="15"/>' +
  '</svg>';

const SVG_CLOSE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="2">' +
    '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>' +
  '</svg>';

const SVG_CLOSE_16 =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="2">' +
    '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>' +
  '</svg>';

const TOAST_ICONS = {
  success:
    '<svg class="toast__icon" viewBox="0 0 24 24" width="20" height="20" ' +
      'fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>' +
      '<polyline points="22 4 12 14.01 9 11.01"/>' +
    '</svg>',
  error:
    '<svg class="toast__icon" viewBox="0 0 24 24" width="20" height="20" ' +
      'fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="15" y1="9" x2="9" y2="15"/>' +
      '<line x1="9" y1="9" x2="15" y2="15"/>' +
    '</svg>',
  warning:
    '<svg class="toast__icon" viewBox="0 0 24 24" width="20" height="20" ' +
      'fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 ' +
        '1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>' +
      '<line x1="12" y1="9" x2="12" y2="13"/>' +
      '<line x1="12" y1="17" x2="12.01" y2="17"/>' +
    '</svg>',
  info:
    '<svg class="toast__icon" viewBox="0 0 24 24" width="20" height="20" ' +
      'fill="none" stroke="currentColor" stroke-width="2">' +
      '<circle cx="12" cy="12" r="10"/>' +
      '<line x1="12" y1="16" x2="12" y2="12"/>' +
      '<line x1="12" y1="8" x2="12.01" y2="8"/>' +
    '</svg>',
};

/* ================================================================
   Step Navigation
   ================================================================ */

function goToStep(step) {
  if (STEPS.indexOf(step) === -1) {
    return;
  }

  const nextIndex = STEPS.indexOf(step);
  currentStep = step;

  // Update step containers: only the active one is visible
  STEPS.forEach(function (s) {
    const container = dom.stepContainers[s];
    if (!container) {
      return;
    }
    if (s === step) {
      container.classList.add('step--active');
    } else {
      container.classList.remove('step--active');
    }
  });

  // Update progress bar buttons
  STEPS.forEach(function (s, idx) {
    const btn = dom.stepButtons[s];
    if (!btn) {
      return;
    }
    btn.classList.remove('progress-bar__step--active', 'progress-bar__step--done');

    if (idx < nextIndex) {
      btn.classList.add('progress-bar__step--done');
    } else if (idx === nextIndex) {
      btn.classList.add('progress-bar__step--active');
    }
  });

  // Step-specific initialization
  if (step === 'bbox' && currentImageId) {
    initBboxStep();
  } else if (step === 'classify') {
    initClassifyStep();
  }
}

function initBboxStep() {
  const imageUrl = '/api/images/' + encodeURIComponent(currentImageId);

  // bboxEditor is defined in bbox-editor.js (loaded after app.js)
  if (typeof bboxEditor !== 'undefined' && bboxEditor.init) {
    bboxEditor.init(dom.bboxCanvas, imageUrl, detections, imageWidth, imageHeight);
    bboxEditor.onBoxesChanged = updateBboxSidebar;
  }

  updateBboxSidebar(detections);
}

function initClassifyStep() {
  let boxes = [];

  // Prefer the latest boxes from bboxEditor if available
  if (typeof bboxEditor !== 'undefined' && bboxEditor.getBoxes) {
    boxes = bboxEditor.getBoxes();
  } else {
    boxes = detections;
  }

  // classifier is defined in classifier.js (loaded after app.js)
  if (typeof classifier !== 'undefined' && classifier.init) {
    classifier.init(currentImageId, boxes);
  }
}

/* ================================================================
   BBox Sidebar Update
   ================================================================ */

const BBOX_COLORS = [
  '#e94560', '#2ecc71', '#3498db', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e74c3c', '#7eb8f7', '#f1c40f',
];

function updateBboxSidebar(boxes) {
  if (!dom.bboxList || !dom.bboxCount) {
    return;
  }

  const validBoxes = Array.isArray(boxes) ? boxes : [];
  dom.bboxCount.textContent = String(validBoxes.length);

  // Enable/disable the "Done" and toolbar "Next" buttons
  const hasBoxes = validBoxes.length > 0;
  if (dom.btnBboxDone) {
    dom.btnBboxDone.disabled = !hasBoxes;
  }
  if (dom.btnBboxNext) {
    dom.btnBboxNext.disabled = !hasBoxes;
  }

  clearChildren(dom.bboxList);

  // Empty state
  if (validBoxes.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'bbox-list__empty';
    emptyLi.textContent = 'Draw a box on the image';
    dom.bboxList.appendChild(emptyLi);
    return;
  }

  validBoxes.forEach(function (box, idx) {
    const color = BBOX_COLORS[idx % BBOX_COLORS.length];
    const bbox = box.bbox || [];
    const coordText = bbox.map(function (v) { return Math.round(v); }).join(', ');

    const li = document.createElement('li');
    li.className = 'bbox-list__item';
    li.setAttribute('data-index', String(idx));

    const colorSpan = document.createElement('span');
    colorSpan.className = 'bbox-list__color';
    colorSpan.style.background = color;
    li.appendChild(colorSpan);

    const coordsSpan = document.createElement('span');
    coordsSpan.className = 'bbox-list__coords';
    coordsSpan.textContent = '[' + coordText + ']';
    li.appendChild(coordsSpan);

    if (typeof box.confidence === 'number') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = (box.confidence * 100).toFixed(0) + '%';
      li.appendChild(badge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'bbox-list__remove';
    removeBtn.title = 'Delete';
    removeBtn.appendChild(createSvgIcon(SVG_CLOSE));
    removeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof bboxEditor !== 'undefined' && bboxEditor.removeBox) {
        bboxEditor.removeBox(idx);
      }
    });
    li.appendChild(removeBtn);

    // Click to select
    li.addEventListener('click', function () {
      if (typeof bboxEditor !== 'undefined' && bboxEditor.selectBox) {
        bboxEditor.selectBox(idx);
      }
    });

    dom.bboxList.appendChild(li);
  });
}

/* ================================================================
   Upload Handling
   ================================================================ */

function initUpload() {
  const dropZone = dom.dropZone;
  const fileInput = dom.fileInput;

  if (!dropZone || !fileInput) {
    return;
  }

  // Clicking the drop zone opens the file dialog
  dropZone.addEventListener('click', function (e) {
    // Don't trigger if the button itself was clicked (handled below)
    if (e.target.closest('.drop-zone__btn')) {
      return;
    }
    fileInput.click();
  });

  // "Browse Files" button within the drop zone
  const selectBtn = dropZone.querySelector('.drop-zone__btn');
  if (selectBtn) {
    selectBtn.addEventListener('click', function () {
      fileInput.click();
    });
  }

  // Drag-and-drop events
  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drop-zone--dragover');
  });

  dropZone.addEventListener('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drop-zone--dragover');
  });

  dropZone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drop-zone--dragover');
  });

  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drop-zone--dragover');

    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  });

  // File input change
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(fileInput.files);
      fileInput.value = '';
    }
  });
}

function handleFiles(fileList) {
  // Upload only the first image file
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (file.type && file.type.startsWith('image/')) {
      uploadFile(file);
      return;
    }
  }

  showToast('Please select an image file', 'error');
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  showToast('Uploading ' + file.name + '...', 'info');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errData = await response.json().catch(function () { return {}; });
      throw new Error(errData.detail || 'HTTP ' + response.status);
    }

    const data = await response.json();
    currentImageId = data.image_id;
    detections = [];
    imageWidth = 0;
    imageHeight = 0;

    showPreview(currentImageId, file.name);
    showToast('Image uploaded', 'success');
    loadQueue();
  } catch (err) {
    showToast('Upload error: ' + err.message, 'error');
  }
}

/**
 * Replace the drop zone content with a preview image and action buttons.
 * All DOM construction uses safe methods (createElement / textContent).
 */
function showPreview(imageId, filename) {
  const dropZone = dom.dropZone;
  if (!dropZone) {
    return;
  }

  clearChildren(dropZone);

  const imageUrl = '/api/images/' + encodeURIComponent(imageId);
  const displayName = filename || imageId;

  // Preview image
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = displayName;
  img.style.cssText = 'max-width:100%;max-height:280px;border-radius:8px;object-fit:contain;';
  dropZone.appendChild(img);

  // Filename label
  const title = document.createElement('p');
  title.className = 'drop-zone__title';
  title.textContent = displayName;
  dropZone.appendChild(title);

  // Button row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';

  const btnDetect = document.createElement('button');
  btnDetect.className = 'btn btn--primary';
  btnDetect.id = 'btn-detect';
  btnDetect.textContent = 'Detect Objects';
  btnDetect.addEventListener('click', function () {
    runDetection();
  });
  btnRow.appendChild(btnDetect);

  const btnNew = document.createElement('button');
  btnNew.className = 'btn btn--secondary';
  btnNew.id = 'btn-new-photo';
  btnNew.textContent = 'New Image';
  btnNew.addEventListener('click', function () {
    resetUpload();
  });
  btnRow.appendChild(btnNew);

  dropZone.appendChild(btnRow);
}

/**
 * Restore the drop zone to its initial upload state.
 * Rebuilds the original HTML structure using safe DOM methods.
 */
function resetUpload() {
  currentImageId = null;
  detections = [];
  imageWidth = 0;
  imageHeight = 0;

  const dropZone = dom.dropZone;
  if (!dropZone) {
    return;
  }

  clearChildren(dropZone);

  // Upload icon
  dropZone.appendChild(createSvgIcon(SVG_UPLOAD_ICON));

  // Title text
  const title = document.createElement('p');
  title.className = 'drop-zone__title';
  title.textContent = 'Drop images here';
  dropZone.appendChild(title);

  // Subtitle
  const subtitle = document.createElement('p');
  subtitle.className = 'drop-zone__subtitle';
  subtitle.textContent = 'or click to browse';
  dropZone.appendChild(subtitle);

  // Hidden file input
  const newInput = document.createElement('input');
  newInput.id = 'file-input';
  newInput.type = 'file';
  newInput.accept = 'image/*';
  newInput.multiple = true;
  newInput.hidden = true;
  dropZone.appendChild(newInput);

  // Browse files button
  const selectBtn = document.createElement('button');
  selectBtn.className = 'drop-zone__btn';
  selectBtn.textContent = 'Browse Files';
  selectBtn.addEventListener('click', function () {
    newInput.click();
  });
  dropZone.appendChild(selectBtn);

  // Re-cache the file input and re-bind events
  dom.fileInput = newInput;
  initUpload();
}

/* ================================================================
   Detection
   ================================================================ */

async function runDetection() {
  if (!currentImageId) {
    showToast('Upload an image first', 'error');
    return;
  }

  const btnDetect = document.getElementById('btn-detect');
  if (btnDetect) {
    btnDetect.disabled = true;
    btnDetect.textContent = 'Detecting...';
  }

  // Show loading spinner overlay
  showLoadingOverlay(true);
  showToast('Running detection...', 'info');

  try {
    const response = await fetch('/api/detect/' + encodeURIComponent(currentImageId), {
      method: 'POST',
    });

    if (!response.ok) {
      const errData = await response.json().catch(function () { return {}; });
      throw new Error(errData.detail || 'HTTP ' + response.status);
    }

    const data = await response.json();
    detections = data.boxes || [];
    imageWidth = data.width || 0;
    imageHeight = data.height || 0;

    showLoadingOverlay(false);
    showToast('Objects found: ' + detections.length, 'success');
    goToStep('bbox');
  } catch (err) {
    showLoadingOverlay(false);
    showToast('Detection error: ' + err.message, 'error');

    if (btnDetect) {
      btnDetect.disabled = false;
      btnDetect.textContent = 'Detect Objects';
    }
  }
}

/* ================================================================
   Queue
   ================================================================ */

async function loadQueue() {
  try {
    const response = await fetch('/api/queue');

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const items = await response.json();
    renderQueue(items);
  } catch (_err) {
    // Queue loading failure is non-critical
    if (dom.queueList) {
      clearChildren(dom.queueList);
      const errLi = document.createElement('li');
      errLi.className = 'queue-list__empty';
      errLi.textContent = 'Failed to load queue';
      dom.queueList.appendChild(errLi);
    }
  }
}

function renderQueue(items) {
  if (!dom.queueList) {
    return;
  }

  clearChildren(dom.queueList);

  if (!items || items.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'queue-list__empty';
    emptyLi.textContent = 'No images in queue';
    dom.queueList.appendChild(emptyLi);
    return;
  }

  items.forEach(function (item) {
    const isActive = item.image_id === currentImageId;

    const li = document.createElement('li');
    li.className = 'queue-list__item' + (isActive ? ' queue-list__item--active' : '');
    li.setAttribute('data-image-id', item.image_id);

    const thumb = document.createElement('img');
    thumb.className = 'queue-list__thumb';
    thumb.src = item.thumbnail_url;
    thumb.alt = item.filename;
    thumb.loading = 'lazy';
    li.appendChild(thumb);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'queue-list__info';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'queue-list__name';
    nameDiv.textContent = item.filename;
    infoDiv.appendChild(nameDiv);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'queue-list__meta';
    metaDiv.textContent = item.image_id.slice(0, 8);
    infoDiv.appendChild(metaDiv);

    li.appendChild(infoDiv);

    const statusSpan = document.createElement('span');
    statusSpan.className = 'queue-list__status' + (isActive ? ' queue-list__status--active' : '');
    li.appendChild(statusSpan);

    // Click handler: select image from queue
    li.addEventListener('click', function () {
      selectFromQueue(item.image_id, li);
    });

    dom.queueList.appendChild(li);
  });
}

function selectFromQueue(imageId, liElement) {
  currentImageId = imageId;
  detections = [];
  imageWidth = 0;
  imageHeight = 0;

  // Highlight the selected queue item
  dom.queueList.querySelectorAll('.queue-list__item').forEach(function (item) {
    item.classList.remove('queue-list__item--active');
    const dot = item.querySelector('.queue-list__status');
    if (dot) {
      dot.classList.remove('queue-list__status--active');
    }
  });

  if (liElement) {
    liElement.classList.add('queue-list__item--active');
    const statusDot = liElement.querySelector('.queue-list__status');
    if (statusDot) {
      statusDot.classList.add('queue-list__status--active');
    }
  }

  // Resolve filename from the queue item
  const nameEl = liElement ? liElement.querySelector('.queue-list__name') : null;
  const filename = nameEl ? nameEl.textContent : imageId;

  showPreview(imageId, filename);
  goToStep('upload');
}

/* ================================================================
   BBox Done -> Classify
   ================================================================ */

function initBboxDoneButton() {
  if (dom.btnBboxDone) {
    dom.btnBboxDone.addEventListener('click', function () {
      goToStep('classify');
    });
  }

  if (dom.btnBboxNext) {
    dom.btnBboxNext.addEventListener('click', function () {
      goToStep('classify');
    });
  }
}

/* ================================================================
   Progress Bar Click Navigation
   ================================================================ */

function initProgressNavigation() {
  STEPS.forEach(function (step) {
    const btn = dom.stepButtons[step];
    if (!btn) {
      return;
    }

    btn.addEventListener('click', function () {
      // Only allow backward navigation (to completed steps) or to current step
      const targetIdx = STEPS.indexOf(step);
      const currentIdx = STEPS.indexOf(currentStep);

      if (targetIdx <= currentIdx) {
        goToStep(step);
      }
    });
  });
}

/* ================================================================
   Labeling Done Callback
   ================================================================ */

function onLabelingDone() {
  showToast('Labels saved!', 'success');

  // Reset state for next image
  currentImageId = null;
  detections = [];
  imageWidth = 0;
  imageHeight = 0;

  resetUpload();
  goToStep('upload');
  loadQueue();
}

/* ================================================================
   Toast Notifications
   ================================================================ */

function showToast(message, type) {
  const toastType = type || 'info';
  const container = dom.toastContainer;

  if (!container) {
    return;
  }

  const iconMarkup = TOAST_ICONS[toastType] || TOAST_ICONS.info;

  const toastEl = document.createElement('div');
  toastEl.className = 'toast toast--' + toastType;

  // Icon (from trusted hardcoded SVG)
  toastEl.appendChild(createSvgIcon(iconMarkup));

  // Message (safe textContent)
  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast__message';
  msgSpan.textContent = message;
  toastEl.appendChild(msgSpan);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast__close';
  closeBtn.title = 'Close';
  closeBtn.appendChild(createSvgIcon(SVG_CLOSE_16));
  closeBtn.addEventListener('click', function () {
    dismissToast(toastEl);
  });
  toastEl.appendChild(closeBtn);

  container.appendChild(toastEl);

  // Auto-dismiss after 4 seconds
  setTimeout(function () {
    dismissToast(toastEl);
  }, 4000);
}

function dismissToast(toastEl) {
  if (!toastEl || toastEl.classList.contains('toast--removing')) {
    return;
  }

  toastEl.classList.add('toast--removing');

  toastEl.addEventListener('animationend', function () {
    if (toastEl.parentNode) {
      toastEl.parentNode.removeChild(toastEl);
    }
  });
}

/* ================================================================
   Loading Overlay
   ================================================================ */

function showLoadingOverlay(visible) {
  const existing = document.getElementById('loading-overlay');

  if (!visible) {
    if (existing) {
      existing.classList.add('loading-overlay--hidden');
      existing.addEventListener('transitionend', function () {
        if (existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }
      });
    }
    return;
  }

  if (existing) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'loading-overlay';
  overlay.className = 'loading-overlay';

  const spinner = document.createElement('div');
  spinner.className = 'loading-overlay__spinner';
  overlay.appendChild(spinner);

  const label = document.createElement('span');
  label.className = 'loading-overlay__label';
  label.textContent = 'Detecting objects...';
  overlay.appendChild(label);

  document.body.appendChild(overlay);
}

/* ================================================================
   Global Exports
   ================================================================ */

window.goToStep = goToStep;
window.showToast = showToast;
window.onLabelingDone = onLabelingDone;
window.loadQueue = loadQueue;
window.updateBboxSidebar = updateBboxSidebar;
window.clearChildren = clearChildren;

/* ================================================================
   Init
   ================================================================ */

document.addEventListener('DOMContentLoaded', function () {
  cacheDom();
  initUpload();
  initBboxDoneButton();
  initProgressNavigation();
  loadQueue();
});
