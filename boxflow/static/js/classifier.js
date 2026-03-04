/**
 * BoxFlow — Category Classifier
 *
 * Step 3 of the labeling workflow: classify each detected crop
 * with a category from the catalog fetched from the backend.
 *
 * Lifecycle:
 *   1. init(imageId, boxes) -- fetches categories, builds crops, renders UI
 *   2. User clicks category buttons (or hotkeys 1-9) per crop
 *   3. Auto-advance to next crop; after last crop, show summary
 *   4. save() -- POST labels to backend
 *
 * Depends on globals from app.js:
 *   - window.showToast(message, type)
 *   - window.onLabelingDone()
 *   - window.loadQueue()
 *   - clearChildren(el)  (defined in app.js)
 *
 * Exports global: classifier
 */

const classifier = (function () {

  /* ================================================================
     Constants
     ================================================================ */

  const FADE_DURATION_MS = 200;
  const SPECIAL_BRANDS = [
    { name: 'unknown', display: 'Unknown', cssClass: 'category-card--unknown' },
    { name: 'not_product', display: 'Not an Object', cssClass: 'category-card--not-product' },
  ];

  /* ================================================================
     State
     ================================================================ */

  let imageId = null;
  let crops = [];       // [{bbox: [x1,y1,x2,y2], confidence, cropUrl}]
  let brands = [];      // [{name, dir_name, icon_url}]
  let labels = [];      // [{bbox: [x1,y1,x2,y2], brand: string|null}]
  let currentIdx = 0;
  let isSummaryView = false;
  let boundKeyHandler = null;

  /* ================================================================
     DOM references
     ================================================================ */

  function getCropDisplay() {
    return document.getElementById('crop-display');
  }

  function getCropCounter() {
    return document.getElementById('crop-counter');
  }

  function getCategoryGrid() {
    return document.getElementById('category-grid');
  }

  function getSaveButton() {
    return document.getElementById('btn-save-labels');
  }

  /* ================================================================
     Init
     ================================================================ */

  async function init(imgId, boxes) {
    imageId = imgId;
    currentIdx = 0;
    isSummaryView = false;

    // Build crops from boxes
    const validBoxes = Array.isArray(boxes) ? boxes : [];
    crops = validBoxes.map(function (box) {
      const bbox = box.bbox || [0, 0, 0, 0];
      return {
        bbox: bbox,
        confidence: typeof box.confidence === 'number' ? box.confidence : 1.0,
        cropUrl: buildCropUrl(imgId, bbox),
      };
    });

    // Initialize labels (all null)
    labels = crops.map(function (crop) {
      return { bbox: crop.bbox.slice(), brand: null };
    });

    // Fetch categories from backend
    try {
      brands = await fetchCategories();
    } catch (err) {
      window.showToast('Failed to load categories: ' + err.message, 'error');
      brands = [];
    }

    // Bind keyboard handler
    unbindKeyboard();
    boundKeyHandler = onKeyDown;
    document.addEventListener('keydown', boundKeyHandler);

    // Render UI
    renderBrands();
    updateSaveButton(false);

    if (crops.length === 0) {
      renderEmptyCrops();
    } else {
      renderCropStrip();
      renderCrop();

      // Fire auto-classification in background (non-blocking)
      fetchClassifySuggestions(imgId, validBoxes);
    }
  }

  /* ================================================================
     Auto-Classification
     ================================================================ */

  let clipSuggestions = []; // [{bbox, brand, confidence}]

  async function fetchClassifySuggestions(imgId, boxes) {
    try {
      const body = {
        boxes: boxes.map(function (b) {
          return {
            bbox: b.bbox || [0, 0, 0, 0],
            confidence: typeof b.confidence === 'number' ? b.confidence : 1.0,
          };
        }),
      };

      const response = await fetch('/api/classify/' + encodeURIComponent(imgId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (data.status !== 'ok' || !data.suggestions || data.suggestions.length === 0) {
        return;
      }

      clipSuggestions = data.suggestions;

      // Apply suggestions as pre-selected labels (only for unlabeled crops)
      // Validate category names against known categories to prevent mismatches
      const knownNames = brands.map(function (b) { return b.name; });
      let appliedCount = 0;
      clipSuggestions.forEach(function (suggestion, idx) {
        if (idx < labels.length && labels[idx].brand === null
            && suggestion.confidence > 0.3
            && knownNames.indexOf(suggestion.label) !== -1) {
          labels[idx] = {
            bbox: labels[idx].bbox.slice(),
            brand: suggestion.label,
          };
          appliedCount++;
        }
      });

      if (appliedCount > 0) {
        window.showToast(
          'Auto-classified ' + appliedCount + '/' + crops.length + ' regions',
          'info'
        );
        renderCropStrip();
        highlightSelectedBrand();

        // If all labeled, show summary
        const allDone = labels.every(function (l) { return l.brand !== null; });
        if (allDone) {
          showSummary();
        }
      }
    } catch (_err) {
      // Auto-classification is non-critical; silently ignore errors
    }
  }

  /* ================================================================
     API Calls
     ================================================================ */

  async function fetchCategories() {
    const response = await fetch('/api/categories');

    if (!response.ok) {
      const errData = await response.json().catch(function () { return {}; });
      throw new Error(errData.detail || 'HTTP ' + response.status);
    }

    const data = await response.json();
    return sortCategories(data);
  }

  /**
   * Sort categories alphabetically.
   * Special entries (unknown, not_product) are appended by renderBrands().
   */
  function sortCategories(categoryList) {
    const sorted = categoryList.slice();
    sorted.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }

  function buildCropUrl(imgId, bbox) {
    return '/api/crop/' + encodeURIComponent(imgId) +
      '?x1=' + bbox[0] +
      '&y1=' + bbox[1] +
      '&x2=' + bbox[2] +
      '&y2=' + bbox[3];
  }

  /* ================================================================
     Crop Strip (mini thumbnails at top of crop display)
     ================================================================ */

  function renderCropStrip() {
    const display = getCropDisplay();
    if (!display) {
      return;
    }

    // Remove any existing strip
    const existingStrip = display.parentElement.querySelector('.crop-strip');
    if (existingStrip) {
      existingStrip.parentElement.removeChild(existingStrip);
    }

    if (crops.length <= 1) {
      return;
    }

    const strip = document.createElement('div');
    strip.className = 'crop-strip';

    crops.forEach(function (crop, idx) {
      const thumb = document.createElement('div');
      thumb.className = 'crop-strip__item';
      if (idx === currentIdx) {
        thumb.classList.add('crop-strip__item--active');
      }

      // Show a checkmark if labeled
      if (labels[idx] && labels[idx].brand !== null) {
        thumb.classList.add('crop-strip__item--done');
      }

      const img = document.createElement('img');
      img.src = crop.cropUrl;
      img.alt = 'Region ' + (idx + 1);
      img.loading = 'lazy';
      thumb.appendChild(img);

      const number = document.createElement('span');
      number.className = 'crop-strip__number';
      number.textContent = String(idx + 1);
      thumb.appendChild(number);

      thumb.addEventListener('click', function () {
        if (isSummaryView) {
          // In summary, clicking a crop goes back to labeling it
          isSummaryView = false;
          currentIdx = idx;
          renderCropStrip();
          renderCrop();
          highlightSelectedBrand();
          updateSaveButton(false);
        } else {
          currentIdx = idx;
          renderCropStrip();
          renderCrop();
          highlightSelectedBrand();
        }
      });

      strip.appendChild(thumb);
    });

    // Insert strip before the crop display
    display.parentElement.insertBefore(strip, display);
  }

  /* ================================================================
     Crop Display
     ================================================================ */

  function renderCrop() {
    const display = getCropDisplay();
    const counter = getCropCounter();

    if (!display) {
      return;
    }

    clearChildren(display);

    if (crops.length === 0 || currentIdx < 0 || currentIdx >= crops.length) {
      return;
    }

    // Counter
    if (counter) {
      counter.textContent = (currentIdx + 1) + ' / ' + crops.length;
    }

    // Create crop image with fade-in
    const img = document.createElement('img');
    img.src = crops[currentIdx].cropUrl;
    img.alt = 'Region ' + (currentIdx + 1);
    img.className = 'crop-display__image crop-display__image--fade-in';
    display.appendChild(img);

    // Remove animation class after transition completes
    img.addEventListener('animationend', function () {
      img.classList.remove('crop-display__image--fade-in');
    });
  }

  function renderEmptyCrops() {
    const display = getCropDisplay();
    const counter = getCropCounter();

    if (display) {
      clearChildren(display);

      const placeholder = document.createElement('div');
      placeholder.className = 'crop-display__placeholder';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '48');
      svg.setAttribute('height', '48');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.5');

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', '3');
      rect.setAttribute('y', '3');
      rect.setAttribute('width', '18');
      rect.setAttribute('height', '18');
      rect.setAttribute('rx', '2');
      svg.appendChild(rect);

      placeholder.appendChild(svg);

      const msg = document.createElement('p');
      msg.textContent = 'No regions to classify';
      placeholder.appendChild(msg);

      display.appendChild(placeholder);
    }

    if (counter) {
      counter.textContent = '0 / 0';
    }
  }

  /* ================================================================
     Category Grid
     ================================================================ */

  function renderBrands() {
    const grid = getCategoryGrid();
    if (!grid) {
      return;
    }

    clearChildren(grid);

    // Render catalog categories
    brands.forEach(function (brand, idx) {
      const btn = createBrandButton(brand.name, brand.name, brand.icon_url, idx);
      grid.appendChild(btn);
    });

    // Render special category buttons at end
    SPECIAL_BRANDS.forEach(function (special, sIdx) {
      const btn = document.createElement('button');
      btn.className = 'category-card ' + special.cssClass;
      btn.setAttribute('data-brand', special.name);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'category-card__name';
      nameSpan.textContent = special.display;
      btn.appendChild(nameSpan);

      // Hotkey number for special categories (continues from catalog)
      const hotkeyNum = brands.length + sIdx + 1;
      if (hotkeyNum <= 9) {
        const hotkeySpan = document.createElement('span');
        hotkeySpan.className = 'category-card__hotkey';
        hotkeySpan.textContent = String(hotkeyNum);
        btn.appendChild(hotkeySpan);
      }

      btn.addEventListener('click', function () {
        selectBrand(special.name);
      });

      grid.appendChild(btn);
    });

    // Add custom category button
    const addBtn = document.createElement('button');
    addBtn.className = 'category-card category-card--add-new';
    addBtn.setAttribute('data-brand', '__add_new__');

    const addIcon = document.createElement('span');
    addIcon.className = 'category-card__add-icon';
    addIcon.textContent = '+';
    addBtn.appendChild(addIcon);

    const addLabel = document.createElement('span');
    addLabel.className = 'category-card__name';
    addLabel.textContent = 'New Category';
    addBtn.appendChild(addLabel);

    addBtn.addEventListener('click', function () {
      showCustomBrandInput(grid, addBtn);
    });

    grid.appendChild(addBtn);
  }

  /**
   * Show inline text input to type a new category name.
   */
  function showCustomBrandInput(grid, addBtn) {
    // Replace the add button with an input form
    const inputWrap = document.createElement('div');
    inputWrap.className = 'category-card category-card--input-wrap';

    const input = document.createElement('input');
    input.className = 'category-card__input';
    input.type = 'text';
    input.placeholder = 'Category name...';
    input.maxLength = 50;
    inputWrap.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.className = 'category-card__input-actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'category-card__input-ok';
    confirmBtn.textContent = '\u2713';
    confirmBtn.title = 'Add';
    btnRow.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'category-card__input-cancel';
    cancelBtn.textContent = '\u2717';
    cancelBtn.title = 'Cancel';
    btnRow.appendChild(cancelBtn);

    inputWrap.appendChild(btnRow);

    grid.replaceChild(inputWrap, addBtn);
    input.focus();

    function submitNewBrand() {
      const name = input.value.trim();
      if (!name) {
        cancelInput();
        return;
      }
      createCustomCategory(name, grid);
    }

    function cancelInput() {
      grid.replaceChild(addBtn, inputWrap);
    }

    confirmBtn.addEventListener('click', submitNewBrand);
    cancelBtn.addEventListener('click', cancelInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitNewBrand();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelInput();
      }
    });
  }

  /**
   * POST new category to backend, add to local list, re-render + select.
   */
  async function createCustomCategory(name, grid) {
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

      // Add to local categories array
      brands.push({
        name: data.name,
        dir_name: data.dir_name,
        icon_url: data.icon_url,
      });

      // Re-render category grid
      renderBrands();

      // Auto-select the new category for current crop
      selectBrand(data.name);

      window.showToast('Category "' + data.name + '" added', 'success');
    } catch (err) {
      window.showToast('Error: ' + err.message, 'error');
      // Re-render to restore the add button
      renderBrands();
    }
  }

  function createBrandButton(brandName, displayName, iconUrl, idx) {
    const btn = document.createElement('button');
    btn.className = 'category-card';
    btn.setAttribute('data-brand', brandName);

    // Category icon (if available)
    if (iconUrl) {
      const icon = document.createElement('img');
      icon.className = 'category-card__icon';
      icon.src = iconUrl;
      icon.alt = displayName;
      icon.loading = 'lazy';
      // Gracefully handle missing icons
      icon.addEventListener('error', function () {
        icon.style.display = 'none';
      });
      btn.appendChild(icon);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'category-card__name';
    nameSpan.textContent = displayName;
    btn.appendChild(nameSpan);

    // Hotkey indicator (1-9)
    const hotkeyNum = idx + 1;
    if (hotkeyNum <= 9) {
      const hotkeySpan = document.createElement('span');
      hotkeySpan.className = 'category-card__hotkey';
      hotkeySpan.textContent = String(hotkeyNum);
      btn.appendChild(hotkeySpan);
    }

    btn.addEventListener('click', function () {
      selectBrand(brandName);
    });

    return btn;
  }

  function highlightSelectedBrand() {
    const grid = getCategoryGrid();
    if (!grid) {
      return;
    }

    // Remove all selected highlights
    const cards = grid.querySelectorAll('.category-card');
    cards.forEach(function (card) {
      card.classList.remove('category-card--selected');
    });

    // If current crop has a label, highlight that category
    if (currentIdx >= 0 && currentIdx < labels.length && labels[currentIdx].brand !== null) {
      const brandName = labels[currentIdx].brand;
      const matchCard = grid.querySelector('[data-brand="' + CSS.escape(brandName) + '"]');
      if (matchCard) {
        matchCard.classList.add('category-card--selected');
      }
    }
  }

  /* ================================================================
     Category Selection
     ================================================================ */

  function selectBrand(brandName) {
    if (isSummaryView) {
      return;
    }

    if (currentIdx < 0 || currentIdx >= labels.length) {
      return;
    }

    // Store label
    labels[currentIdx] = {
      bbox: labels[currentIdx].bbox.slice(),
      brand: brandName,
    };

    // Highlight the selected button
    highlightSelectedBrand();

    // Update crop strip to show done state
    renderCropStrip();

    // Auto-advance after a short delay for visual feedback
    const nextIdx = currentIdx + 1;

    if (nextIdx >= crops.length) {
      // All crops labeled -- show summary
      setTimeout(function () {
        showSummary();
      }, FADE_DURATION_MS);
    } else {
      // Advance to next crop with fade
      setTimeout(function () {
        currentIdx = nextIdx;
        renderCropStrip();
        renderCropWithFade();
        highlightSelectedBrand();
      }, FADE_DURATION_MS);
    }
  }

  function renderCropWithFade() {
    const display = getCropDisplay();
    if (!display) {
      renderCrop();
      return;
    }

    // Fade out current content
    const currentImg = display.querySelector('.crop-display__image');
    if (currentImg) {
      currentImg.classList.add('crop-display__image--fade-out');
      currentImg.addEventListener('animationend', function () {
        renderCrop();
      });
    } else {
      renderCrop();
    }
  }

  /* ================================================================
     Summary View
     ================================================================ */

  function showSummary() {
    isSummaryView = true;
    const display = getCropDisplay();
    const counter = getCropCounter();

    if (!display) {
      return;
    }

    if (counter) {
      counter.textContent = 'Done';
    }

    clearChildren(display);
    display.classList.add('crop-display--summary');

    // Summary grid
    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'summary-grid';

    labels.forEach(function (label, idx) {
      const card = document.createElement('div');
      card.className = 'summary-card';

      // Crop thumbnail
      const thumb = document.createElement('img');
      thumb.className = 'summary-card__thumb';
      thumb.src = crops[idx].cropUrl;
      thumb.alt = 'Region ' + (idx + 1);
      card.appendChild(thumb);

      // Category label
      const brandText = document.createElement('span');
      brandText.className = 'summary-card__brand';
      brandText.textContent = getBrandDisplayName(label.brand);
      card.appendChild(brandText);

      // Index number
      const numSpan = document.createElement('span');
      numSpan.className = 'summary-card__number';
      numSpan.textContent = String(idx + 1);
      card.appendChild(numSpan);

      // Click to re-classify
      card.addEventListener('click', function () {
        isSummaryView = false;
        display.classList.remove('crop-display--summary');
        currentIdx = idx;
        renderCropStrip();
        renderCrop();
        highlightSelectedBrand();
        updateSaveButton(false);
      });

      summaryGrid.appendChild(card);
    });

    display.appendChild(summaryGrid);

    // Update crop strip
    renderCropStrip();

    // Enable save button
    updateSaveButton(true);
  }

  function getBrandDisplayName(brandName) {
    if (brandName === null) {
      return '?';
    }

    // Check special categories
    for (let i = 0; i < SPECIAL_BRANDS.length; i++) {
      if (SPECIAL_BRANDS[i].name === brandName) {
        return SPECIAL_BRANDS[i].display;
      }
    }

    return brandName;
  }

  function renderSummary() {
    showSummary();
  }

  /* ================================================================
     Save
     ================================================================ */

  function updateSaveButton(enabled) {
    const btn = getSaveButton();
    if (!btn) {
      return;
    }

    btn.disabled = !enabled;

    // Remove old click handler and rebind
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = getSaveButton();
    if (newBtn && enabled) {
      newBtn.disabled = false;
      newBtn.addEventListener('click', function () {
        save();
      });
    }
  }

  async function save() {
    if (!imageId) {
      window.showToast('No image to save', 'error');
      return;
    }

    // Check that all crops are labeled
    const unlabeled = labels.filter(function (l) { return l.brand === null; });
    if (unlabeled.length > 0) {
      window.showToast('Not all regions labeled (' + unlabeled.length + ' remaining)', 'warning');
      return;
    }

    const saveBtn = getSaveButton();
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    const body = {
      boxes: labels.map(function (l) {
        return { bbox: l.bbox, label: l.brand };
      }),
    };

    try {
      const response = await fetch('/api/save/' + encodeURIComponent(imageId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errData = await response.json().catch(function () { return {}; });
        throw new Error(errData.detail || 'HTTP ' + response.status);
      }

      const data = await response.json();

      window.showToast(
        'Labels saved: ' + data.crops_count + ' regions',
        'success'
      );

      // Cleanup
      cleanup();

      // Notify app.js
      if (typeof window.onLabelingDone === 'function') {
        window.onLabelingDone();
      }
      if (typeof window.loadQueue === 'function') {
        window.loadQueue();
      }
    } catch (err) {
      window.showToast('Save error: ' + err.message, 'error');

      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Labels';
      }
    }
  }

  /* ================================================================
     Keyboard Shortcuts
     ================================================================ */

  function onKeyDown(e) {
    // Ignore if typing in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    // Ignore if not on the classify step
    const classifySection = document.getElementById('step-classify');
    if (!classifySection || !classifySection.classList.contains('step--active')) {
      return;
    }

    // Don't process in summary view (except Enter for save)
    if (isSummaryView) {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      return;
    }

    const key = e.key;

    // Number keys 1-9: select category by index
    const num = parseInt(key, 10);
    if (num >= 1 && num <= 9) {
      e.preventDefault();
      const allBrands = brands.concat(
        SPECIAL_BRANDS.map(function (s) { return { name: s.name }; })
      );
      const brandIdx = num - 1;
      if (brandIdx < allBrands.length) {
        selectBrand(allBrands[brandIdx].name);
      }
      return;
    }

    // Arrow left/right: navigate crops
    if (key === 'ArrowLeft') {
      e.preventDefault();
      if (currentIdx > 0) {
        currentIdx = currentIdx - 1;
        renderCropStrip();
        renderCrop();
        highlightSelectedBrand();
      }
      return;
    }

    if (key === 'ArrowRight') {
      e.preventDefault();
      if (currentIdx < crops.length - 1) {
        currentIdx = currentIdx + 1;
        renderCropStrip();
        renderCrop();
        highlightSelectedBrand();
      }
      return;
    }
  }

  /* ================================================================
     Cleanup
     ================================================================ */

  function unbindKeyboard() {
    if (boundKeyHandler) {
      document.removeEventListener('keydown', boundKeyHandler);
      boundKeyHandler = null;
    }
  }

  function cleanup() {
    unbindKeyboard();

    // Remove crop strip
    const display = getCropDisplay();
    if (display) {
      display.classList.remove('crop-display--summary');
      const strip = display.parentElement
        ? display.parentElement.querySelector('.crop-strip')
        : null;
      if (strip) {
        strip.parentElement.removeChild(strip);
      }
    }

    // Reset state
    imageId = null;
    crops = [];
    brands = [];
    labels = [];
    clipSuggestions = [];
    currentIdx = 0;
    isSummaryView = false;
  }

  /* ================================================================
     Public API
     ================================================================ */

  return {
    init: init,
    selectBrand: selectBrand,
    save: save,
    renderSummary: renderSummary,

    // Expose state for app.js interop
    get crops() { return crops; },
    get brands() { return brands; },
    get labels() { return labels; },
    get currentIdx() { return currentIdx; },
  };

})();

// Export as global
window.classifier = classifier;
