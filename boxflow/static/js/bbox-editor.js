/**
 * BoxFlow — BBox Canvas Editor
 *
 * A Canvas-based bounding box editor for reviewing and editing
 * detection results. Supports draw, select, move, resize,
 * zoom, pan, and keyboard shortcuts.
 *
 * Coordinates:
 *   Canvas space = screen pixels (what the user sees)
 *   Image space  = original image pixels (what the model uses)
 *
 *   Canvas -> Image:  imgX = (canvasX - offsetX) / scale
 *   Image -> Canvas:  canvasX = imgX * scale + offsetX
 *
 * Exports global: bboxEditor
 */

const bboxEditor = (function () {

  /* ================================================================
     Constants
     ================================================================ */

  const HANDLE_RADIUS = 8;         // px in canvas space for hit detection
  const HANDLE_DRAW_SIZE = 5;      // px half-size for rendering handles
  const MIN_BOX_SIZE = 20;         // minimum box dimension in image space
  const SCALE_MIN = 0.1;
  const SCALE_MAX = 10.0;
  const ZOOM_FACTOR = 1.15;        // per wheel tick

  const COLOR_UNSELECTED_FILL = 'rgba(15, 52, 96, 0.30)';
  const COLOR_UNSELECTED_STROKE = '#0f3460';
  const COLOR_SELECTED_FILL = 'rgba(233, 69, 96, 0.30)';
  const COLOR_SELECTED_STROKE = '#e94560';
  const COLOR_HANDLE_FILL = '#e94560';
  const COLOR_HANDLE_STROKE = '#ffffff';
  const COLOR_DRAW_PREVIEW = 'rgba(126, 184, 247, 0.35)';
  const COLOR_DRAW_STROKE = '#7eb8f7';
  const COLOR_LABEL_BG = 'rgba(15, 52, 96, 0.85)';
  const COLOR_LABEL_TEXT = '#e0e0e0';

  /* ================================================================
     Handle layout
     ================================================================ */

  // Handle identifiers: corners + edge midpoints
  // Each returns {x, y} in image coords given a box
  const HANDLE_DEFS = [
    { id: 'nw', cursor: 'nw-resize', pos: function (b) { return { x: b.x1, y: b.y1 }; } },
    { id: 'ne', cursor: 'ne-resize', pos: function (b) { return { x: b.x2, y: b.y1 }; } },
    { id: 'sw', cursor: 'sw-resize', pos: function (b) { return { x: b.x1, y: b.y2 }; } },
    { id: 'se', cursor: 'se-resize', pos: function (b) { return { x: b.x2, y: b.y2 }; } },
    { id: 'n',  cursor: 'n-resize',  pos: function (b) { return { x: (b.x1 + b.x2) / 2, y: b.y1 }; } },
    { id: 's',  cursor: 's-resize',  pos: function (b) { return { x: (b.x1 + b.x2) / 2, y: b.y2 }; } },
    { id: 'w',  cursor: 'w-resize',  pos: function (b) { return { x: b.x1, y: (b.y1 + b.y2) / 2 }; } },
    { id: 'e',  cursor: 'e-resize',  pos: function (b) { return { x: b.x2, y: (b.y1 + b.y2) / 2 }; } },
  ];

  /* ================================================================
     State
     ================================================================ */

  let canvas = null;
  let ctx = null;
  let image = null;            // HTMLImageElement (loaded)
  let imgNaturalW = 0;         // original image width
  let imgNaturalH = 0;         // original image height
  let boxes = [];              // [{x1, y1, x2, y2, confidence, selected}]
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let mode = 'select';         // 'select' | 'draw' | 'resize' | 'move'
  let selectedIdx = -1;
  let dragHandle = null;       // handle def currently being dragged
  let drawStart = null;        // {imgX, imgY} start point for new bbox
  let drawCurrent = null;      // {imgX, imgY} current mouse in draw mode

  // Drag state for move/resize
  let dragStartImgX = 0;
  let dragStartImgY = 0;
  let dragBoxSnapshot = null;  // snapshot of box at drag start

  // Pan state (middle-click or space+drag)
  let isPanning = false;
  let panStartCanvasX = 0;
  let panStartCanvasY = 0;
  let panStartOffsetX = 0;
  let panStartOffsetY = 0;
  let spaceHeld = false;

  // ResizeObserver reference for cleanup
  let resizeObserver = null;

  // Callback set by app.js
  let onBoxesChangedCb = null;

  // Bound event handler references for cleanup
  let boundOnMouseDown = null;
  let boundOnMouseMove = null;
  let boundOnMouseUp = null;
  let boundOnWheel = null;
  let boundOnKeyDown = null;
  let boundOnKeyUp = null;
  let boundOnContextMenu = null;

  /* ================================================================
     Coordinate conversion
     ================================================================ */

  function canvasToImg(cx, cy) {
    return {
      x: (cx - offsetX) / scale,
      y: (cy - offsetY) / scale,
    };
  }

  function imgToCanvas(ix, iy) {
    return {
      x: ix * scale + offsetX,
      y: iy * scale + offsetY,
    };
  }

  /* ================================================================
     Canvas sizing
     ================================================================ */

  function resizeCanvas() {
    if (!canvas || !canvas.parentElement) {
      return;
    }

    const parent = canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  function fitImageToCanvas() {
    if (!canvas || !image) {
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }

    const canvasW = parent.getBoundingClientRect().width;
    const canvasH = parent.getBoundingClientRect().height;

    const scaleX = canvasW / imgNaturalW;
    const scaleY = canvasH / imgNaturalH;
    scale = Math.min(scaleX, scaleY) * 0.95; // 5% padding

    offsetX = (canvasW - imgNaturalW * scale) / 2;
    offsetY = (canvasH - imgNaturalH * scale) / 2;
  }

  /* ================================================================
     Rendering
     ================================================================ */

  function render() {
    if (!ctx || !canvas) {
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }

    const canvasW = parent.getBoundingClientRect().width;
    const canvasH = parent.getBoundingClientRect().height;

    // Clear
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Draw image
    if (image) {
      ctx.drawImage(
        image,
        offsetX, offsetY,
        imgNaturalW * scale,
        imgNaturalH * scale
      );
    }

    // Draw boxes (unselected first, then selected on top)
    boxes.forEach(function (box, idx) {
      if (idx !== selectedIdx) {
        drawBox(box, idx, false);
      }
    });

    // Draw the selected box on top
    if (selectedIdx >= 0 && selectedIdx < boxes.length) {
      drawBox(boxes[selectedIdx], selectedIdx, true);
    }

    // Draw preview for new bbox being drawn
    if (mode === 'draw' && drawStart && drawCurrent) {
      drawPreviewBox(drawStart, drawCurrent);
    }
  }

  function drawBox(box, idx, isSelected) {
    const tl = imgToCanvas(box.x1, box.y1);
    const br = imgToCanvas(box.x2, box.y2);
    const w = br.x - tl.x;
    const h = br.y - tl.y;

    // Fill
    ctx.fillStyle = isSelected ? COLOR_SELECTED_FILL : COLOR_UNSELECTED_FILL;
    ctx.fillRect(tl.x, tl.y, w, h);

    // Stroke
    ctx.strokeStyle = isSelected ? COLOR_SELECTED_STROKE : COLOR_UNSELECTED_STROKE;
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(tl.x, tl.y, w, h);

    // Index label (1-based)
    const label = String(idx + 1);
    let confText = '';
    if (typeof box.confidence === 'number') {
      confText = ' ' + (box.confidence * 100).toFixed(0) + '%';
    }

    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
    const labelMetrics = ctx.measureText(label + confText);
    const labelPadX = 5;
    const labelPadY = 3;
    const labelH = 16;
    const labelW = labelMetrics.width + labelPadX * 2;

    // Label background
    ctx.fillStyle = COLOR_LABEL_BG;
    ctx.fillRect(tl.x, tl.y, labelW, labelH);

    // Label text
    ctx.fillStyle = COLOR_LABEL_TEXT;
    ctx.textBaseline = 'middle';
    ctx.fillText(label + confText, tl.x + labelPadX, tl.y + labelH / 2);

    // Handles for selected box
    if (isSelected) {
      drawHandles(box);
    }
  }

  function drawHandles(box) {
    HANDLE_DEFS.forEach(function (hd) {
      const imgPos = hd.pos(box);
      const cPos = imgToCanvas(imgPos.x, imgPos.y);

      ctx.fillStyle = COLOR_HANDLE_FILL;
      ctx.strokeStyle = COLOR_HANDLE_STROKE;
      ctx.lineWidth = 1.5;

      ctx.beginPath();
      ctx.rect(
        cPos.x - HANDLE_DRAW_SIZE,
        cPos.y - HANDLE_DRAW_SIZE,
        HANDLE_DRAW_SIZE * 2,
        HANDLE_DRAW_SIZE * 2
      );
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawPreviewBox(start, current) {
    const tl = imgToCanvas(
      Math.min(start.imgX, current.imgX),
      Math.min(start.imgY, current.imgY)
    );
    const br = imgToCanvas(
      Math.max(start.imgX, current.imgX),
      Math.max(start.imgY, current.imgY)
    );

    ctx.fillStyle = COLOR_DRAW_PREVIEW;
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

    ctx.strokeStyle = COLOR_DRAW_STROKE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.setLineDash([]);
  }

  /* ================================================================
     Hit testing
     ================================================================ */

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  /**
   * Check if canvas point hits a handle of the selected box.
   * Returns the handle def or null.
   */
  function hitTestHandle(cx, cy) {
    if (selectedIdx < 0 || selectedIdx >= boxes.length) {
      return null;
    }

    const box = boxes[selectedIdx];

    for (let i = 0; i < HANDLE_DEFS.length; i++) {
      const hd = HANDLE_DEFS[i];
      const imgPos = hd.pos(box);
      const cPos = imgToCanvas(imgPos.x, imgPos.y);
      const dx = cx - cPos.x;
      const dy = cy - cPos.y;

      if (Math.abs(dx) <= HANDLE_RADIUS && Math.abs(dy) <= HANDLE_RADIUS) {
        return hd;
      }
    }

    return null;
  }

  /**
   * Check if canvas point is inside any box.
   * Returns the index of the topmost (last) matching box, or -1.
   */
  function hitTestBox(cx, cy) {
    const imgCoords = canvasToImg(cx, cy);
    const ix = imgCoords.x;
    const iy = imgCoords.y;

    // Search backwards so we hit the topmost box first
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (ix >= b.x1 && ix <= b.x2 && iy >= b.y1 && iy <= b.y2) {
        return i;
      }
    }

    return -1;
  }

  /* ================================================================
     Mouse handlers
     ================================================================ */

  function onMouseDown(e) {
    if (!canvas) {
      return;
    }

    const coords = getCanvasCoords(e);
    const cx = coords.x;
    const cy = coords.y;

    // Middle mouse button, right-click, or space+left click: pan
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      isPanning = true;
      panStartCanvasX = e.clientX;
      panStartCanvasY = e.clientY;
      panStartOffsetX = offsetX;
      panStartOffsetY = offsetY;
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Only handle left button for draw/select/resize/move
    if (e.button !== 0) {
      return;
    }

    const imgCoords = canvasToImg(cx, cy);

    // If in draw mode, start drawing a new box
    if (mode === 'draw') {
      drawStart = { imgX: imgCoords.x, imgY: imgCoords.y };
      drawCurrent = { imgX: imgCoords.x, imgY: imgCoords.y };
      return;
    }

    // Check handle hit on currently selected box
    const handle = hitTestHandle(cx, cy);
    if (handle) {
      mode = 'resize';
      dragHandle = handle;
      dragStartImgX = imgCoords.x;
      dragStartImgY = imgCoords.y;
      dragBoxSnapshot = copyBox(boxes[selectedIdx]);
      return;
    }

    // Check if clicking inside a box
    const hitIdx = hitTestBox(cx, cy);
    if (hitIdx >= 0) {
      selectBox(hitIdx);
      mode = 'move';
      dragStartImgX = imgCoords.x;
      dragStartImgY = imgCoords.y;
      dragBoxSnapshot = copyBox(boxes[selectedIdx]);
      canvas.style.cursor = 'move';
      return;
    }

    // Clicked empty space: deselect
    selectBox(-1);
  }

  function onMouseMove(e) {
    if (!canvas) {
      return;
    }

    const coords = getCanvasCoords(e);
    const cx = coords.x;
    const cy = coords.y;

    // Pan
    if (isPanning) {
      offsetX = panStartOffsetX + (e.clientX - panStartCanvasX);
      offsetY = panStartOffsetY + (e.clientY - panStartCanvasY);
      render();
      return;
    }

    const imgCoords = canvasToImg(cx, cy);

    // Drawing new box
    if (mode === 'draw' && drawStart) {
      drawCurrent = { imgX: imgCoords.x, imgY: imgCoords.y };
      render();
      return;
    }

    // Resizing
    if (mode === 'resize' && dragHandle && dragBoxSnapshot && selectedIdx >= 0) {
      const dx = imgCoords.x - dragStartImgX;
      const dy = imgCoords.y - dragStartImgY;
      applyResize(dx, dy);
      render();
      return;
    }

    // Moving
    if (mode === 'move' && dragBoxSnapshot && selectedIdx >= 0) {
      const moveDx = imgCoords.x - dragStartImgX;
      const moveDy = imgCoords.y - dragStartImgY;
      applyMove(moveDx, moveDy);
      render();
      return;
    }

    // Update cursor based on hover
    updateCursor(cx, cy);
  }

  function onMouseUp(e) {
    if (!canvas) {
      return;
    }

    // End pan
    if (isPanning) {
      isPanning = false;
      updateCursor(getCanvasCoords(e).x, getCanvasCoords(e).y);
      return;
    }

    // End draw
    if (mode === 'draw' && drawStart && drawCurrent) {
      let x1 = Math.min(drawStart.imgX, drawCurrent.imgX);
      let y1 = Math.min(drawStart.imgY, drawCurrent.imgY);
      let x2 = Math.max(drawStart.imgX, drawCurrent.imgX);
      let y2 = Math.max(drawStart.imgY, drawCurrent.imgY);

      // Clamp to image bounds
      x1 = Math.max(0, x1);
      y1 = Math.max(0, y1);
      x2 = Math.min(imgNaturalW, x2);
      y2 = Math.min(imgNaturalH, y2);

      const boxW = x2 - x1;
      const boxH = y2 - y1;

      if (boxW >= MIN_BOX_SIZE && boxH >= MIN_BOX_SIZE) {
        addBox(x1, y1, x2, y2);
      }

      drawStart = null;
      drawCurrent = null;
      // Switch back to select after drawing
      setMode('select');
      render();
      return;
    }

    // End resize or move
    if (mode === 'resize' || mode === 'move') {
      if (selectedIdx >= 0 && dragBoxSnapshot) {
        normalizeBox(selectedIdx);
        notifyBoxesChanged();
      }
      dragHandle = null;
      dragBoxSnapshot = null;
      mode = 'select';
      render();

      const coords = getCanvasCoords(e);
      updateCursor(coords.x, coords.y);
      return;
    }
  }

  function onWheel(e) {
    if (!canvas) {
      return;
    }

    e.preventDefault();

    const coords = getCanvasCoords(e);
    const cx = coords.x;
    const cy = coords.y;

    // Determine zoom direction
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    let newScale = scale * factor;

    // Clamp scale
    newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, newScale));

    if (newScale === scale) {
      return;
    }

    // Zoom centered on cursor position
    // The image point under the cursor should remain under the cursor
    const imgPoint = canvasToImg(cx, cy);
    scale = newScale;
    offsetX = cx - imgPoint.x * scale;
    offsetY = cy - imgPoint.y * scale;

    render();
  }

  function onKeyDown(e) {
    // Ignore if typing in an input or textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key;

    if (key === ' ') {
      e.preventDefault();
      spaceHeld = true;
      if (canvas) {
        canvas.style.cursor = 'grab';
      }
      return;
    }

    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      if (selectedIdx >= 0) {
        removeBox(selectedIdx);
      }
      return;
    }

    if (key === 'd' || key === 'D') {
      if (selectedIdx >= 0) {
        removeBox(selectedIdx);
      }
      return;
    }

    if (key === 'n' || key === 'N') {
      setMode('draw');
      return;
    }

    if (key === 's' || key === 'S') {
      setMode('select');
      return;
    }

    if (key === 'f' || key === 'F') {
      fitImageToCanvas();
      render();
      return;
    }

    if (key === 'ArrowLeft') {
      e.preventDefault();
      if (boxes.length > 0) {
        const prev = selectedIdx <= 0 ? boxes.length - 1 : selectedIdx - 1;
        selectBox(prev);
      }
      return;
    }

    if (key === 'ArrowRight') {
      e.preventDefault();
      if (boxes.length > 0) {
        const next = selectedIdx >= boxes.length - 1 ? 0 : selectedIdx + 1;
        selectBox(next);
      }
      return;
    }

    // Ctrl+0 or Cmd+0: fit to canvas
    if (key === '0' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      fitImageToCanvas();
      render();
      return;
    }

    // + and - for zoom
    if (key === '+' || key === '=') {
      zoomAtCenter(ZOOM_FACTOR);
      return;
    }

    if (key === '-' || key === '_') {
      zoomAtCenter(1 / ZOOM_FACTOR);
      return;
    }
  }

  function onKeyUp(e) {
    if (e.key === ' ') {
      spaceHeld = false;
      if (canvas && !isPanning) {
        updateCursor(-1, -1); // Reset cursor based on current mode
      }
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  /* ================================================================
     Resize and Move logic
     ================================================================ */

  function applyResize(dx, dy) {
    if (!dragHandle || !dragBoxSnapshot || selectedIdx < 0) {
      return;
    }

    const box = boxes[selectedIdx];
    const snap = dragBoxSnapshot;
    const hid = dragHandle.id;

    // Reset from snapshot
    box.x1 = snap.x1;
    box.y1 = snap.y1;
    box.x2 = snap.x2;
    box.y2 = snap.y2;

    // Apply delta to affected edges
    if (hid === 'nw' || hid === 'n' || hid === 'ne') {
      box.y1 = snap.y1 + dy;
    }
    if (hid === 'sw' || hid === 's' || hid === 'se') {
      box.y2 = snap.y2 + dy;
    }
    if (hid === 'nw' || hid === 'w' || hid === 'sw') {
      box.x1 = snap.x1 + dx;
    }
    if (hid === 'ne' || hid === 'e' || hid === 'se') {
      box.x2 = snap.x2 + dx;
    }

    // Clamp to image bounds
    box.x1 = Math.max(0, box.x1);
    box.y1 = Math.max(0, box.y1);
    box.x2 = Math.min(imgNaturalW, box.x2);
    box.y2 = Math.min(imgNaturalH, box.y2);
  }

  function applyMove(dx, dy) {
    if (!dragBoxSnapshot || selectedIdx < 0) {
      return;
    }

    const box = boxes[selectedIdx];
    const snap = dragBoxSnapshot;
    const w = snap.x2 - snap.x1;
    const h = snap.y2 - snap.y1;

    let newX1 = snap.x1 + dx;
    let newY1 = snap.y1 + dy;

    // Clamp to image bounds
    if (newX1 < 0) {
      newX1 = 0;
    }
    if (newY1 < 0) {
      newY1 = 0;
    }
    if (newX1 + w > imgNaturalW) {
      newX1 = imgNaturalW - w;
    }
    if (newY1 + h > imgNaturalH) {
      newY1 = imgNaturalH - h;
    }

    box.x1 = newX1;
    box.y1 = newY1;
    box.x2 = newX1 + w;
    box.y2 = newY1 + h;
  }

  /**
   * Ensure x1 < x2 and y1 < y2 after resize.
   */
  function normalizeBox(idx) {
    if (idx < 0 || idx >= boxes.length) {
      return;
    }

    const b = boxes[idx];
    const nx1 = Math.min(b.x1, b.x2);
    const ny1 = Math.min(b.y1, b.y2);
    const nx2 = Math.max(b.x1, b.x2);
    const ny2 = Math.max(b.y1, b.y2);

    boxes[idx] = {
      x1: nx1,
      y1: ny1,
      x2: nx2,
      y2: ny2,
      confidence: b.confidence,
      selected: b.selected,
    };
  }

  /* ================================================================
     Cursor management
     ================================================================ */

  function updateCursor(cx, cy) {
    if (!canvas) {
      return;
    }

    if (spaceHeld) {
      canvas.style.cursor = isPanning ? 'grabbing' : 'grab';
      return;
    }

    if (mode === 'draw') {
      canvas.style.cursor = 'crosshair';
      return;
    }

    // Check handle hover
    if (cx >= 0 && cy >= 0) {
      const handle = hitTestHandle(cx, cy);
      if (handle) {
        canvas.style.cursor = handle.cursor;
        return;
      }

      // Check box hover
      const hitIdx = hitTestBox(cx, cy);
      if (hitIdx >= 0) {
        canvas.style.cursor = 'move';
        return;
      }
    }

    canvas.style.cursor = 'default';
  }

  /* ================================================================
     Zoom helpers
     ================================================================ */

  function zoomAtCenter(factor) {
    if (!canvas) {
      return;
    }

    const parent = canvas.parentElement;
    if (!parent) {
      return;
    }

    const rect = parent.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale * factor));
    if (newScale === scale) {
      return;
    }

    const imgPoint = canvasToImg(cx, cy);
    scale = newScale;
    offsetX = cx - imgPoint.x * scale;
    offsetY = cy - imgPoint.y * scale;

    render();
  }

  /* ================================================================
     Box management
     ================================================================ */

  function copyBox(box) {
    return {
      x1: box.x1,
      y1: box.y1,
      x2: box.x2,
      y2: box.y2,
      confidence: box.confidence,
      selected: box.selected,
    };
  }

  function addBox(x1, y1, x2, y2) {
    const newBox = {
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2,
      confidence: 1.0,
      selected: false,
    };

    boxes = boxes.concat([newBox]);
    selectBox(boxes.length - 1);
    notifyBoxesChanged();
  }

  function removeBox(idx) {
    if (idx < 0 || idx >= boxes.length) {
      return;
    }

    boxes = boxes.filter(function (_b, i) { return i !== idx; });

    // Adjust selected index
    if (selectedIdx === idx) {
      selectedIdx = -1;
    } else if (selectedIdx > idx) {
      selectedIdx = selectedIdx - 1;
    }

    notifyBoxesChanged();
    render();
  }

  function selectBox(idx) {
    // Deselect all
    boxes = boxes.map(function (b) {
      return b.selected ? copyBox(Object.assign({}, b, { selected: false })) : b;
    });

    selectedIdx = idx;

    if (idx >= 0 && idx < boxes.length) {
      boxes[idx] = copyBox(Object.assign({}, boxes[idx], { selected: true }));
    }

    render();

    // Highlight in sidebar
    highlightSidebarItem(idx);
  }

  function highlightSidebarItem(idx) {
    const bboxList = document.getElementById('bbox-list');
    if (!bboxList) {
      return;
    }

    const items = bboxList.querySelectorAll('.bbox-list__item');
    items.forEach(function (item) {
      item.classList.remove('bbox-list__item--selected');
    });

    if (idx >= 0) {
      const target = bboxList.querySelector('[data-index="' + idx + '"]');
      if (target) {
        target.classList.add('bbox-list__item--selected');
      }
    }
  }

  /* ================================================================
     Notification
     ================================================================ */

  function notifyBoxesChanged() {
    if (typeof onBoxesChangedCb === 'function') {
      onBoxesChangedCb(getBoxes());
    }
  }

  /* ================================================================
     Export
     ================================================================ */

  function getBoxes() {
    return boxes.map(function (b) {
      return {
        bbox: [b.x1, b.y1, b.x2, b.y2],
        confidence: b.confidence,
      };
    });
  }

  /* ================================================================
     Toolbar integration
     ================================================================ */

  function setMode(newMode) {
    mode = newMode;

    // Update toolbar button active state
    const toolbar = document.getElementById('bbox-toolbar');
    if (!toolbar) {
      return;
    }

    const buttons = toolbar.querySelectorAll('.bbox-toolbar__btn');
    buttons.forEach(function (btn) {
      const tool = btn.getAttribute('data-tool');
      if (tool === 'draw' || tool === 'select') {
        if (tool === newMode) {
          btn.classList.add('bbox-toolbar__btn--active');
        } else {
          btn.classList.remove('bbox-toolbar__btn--active');
        }
      }
    });

    // Update cursor
    if (canvas) {
      if (newMode === 'draw') {
        canvas.style.cursor = 'crosshair';
      } else {
        canvas.style.cursor = 'default';
      }
    }
  }

  function initToolbar() {
    const toolbar = document.getElementById('bbox-toolbar');
    if (!toolbar) {
      return;
    }

    toolbar.addEventListener('click', function (e) {
      const btn = e.target.closest('.bbox-toolbar__btn');
      if (!btn) {
        return;
      }

      const tool = btn.getAttribute('data-tool');
      if (!tool) {
        return;
      }

      switch (tool) {
        case 'select':
          setMode('select');
          break;

        case 'draw':
          setMode('draw');
          break;

        case 'delete':
          if (selectedIdx >= 0) {
            removeBox(selectedIdx);
          }
          break;

        case 'zoom-in':
          zoomAtCenter(ZOOM_FACTOR);
          break;

        case 'zoom-out':
          zoomAtCenter(1 / ZOOM_FACTOR);
          break;

        case 'fit':
          fitImageToCanvas();
          render();
          break;
      }
    });
  }

  /* ================================================================
     Cleanup previous listeners
     ================================================================ */

  function removeEventListeners() {
    if (canvas && boundOnMouseDown) {
      canvas.removeEventListener('mousedown', boundOnMouseDown);
      canvas.removeEventListener('mousemove', boundOnMouseMove);
      canvas.removeEventListener('mouseup', boundOnMouseUp);
      canvas.removeEventListener('wheel', boundOnWheel);
      canvas.removeEventListener('contextmenu', boundOnContextMenu);
    }

    if (boundOnKeyDown) {
      document.removeEventListener('keydown', boundOnKeyDown);
    }

    if (boundOnKeyUp) {
      document.removeEventListener('keyup', boundOnKeyUp);
    }

    // Also remove mouseup from window (catches mouse release outside canvas)
    if (boundOnMouseUp) {
      window.removeEventListener('mouseup', boundOnMouseUp);
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  }

  /* ================================================================
     Init
     ================================================================ */

  function init(canvasEl, imageUrl, detectionsList, imgWidth, imgHeight) {
    // Cleanup previous
    removeEventListeners();

    canvas = canvasEl;
    if (!canvas) {
      return;
    }

    ctx = canvas.getContext('2d');

    // Reset state
    boxes = [];
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    mode = 'select';
    selectedIdx = -1;
    dragHandle = null;
    drawStart = null;
    drawCurrent = null;
    isPanning = false;
    spaceHeld = false;

    imgNaturalW = imgWidth || 0;
    imgNaturalH = imgHeight || 0;

    // Convert incoming detections to internal format
    if (Array.isArray(detectionsList)) {
      boxes = detectionsList.map(function (det) {
        const bbox = det.bbox || [0, 0, 0, 0];
        return {
          x1: bbox[0],
          y1: bbox[1],
          x2: bbox[2],
          y2: bbox[3],
          confidence: typeof det.confidence === 'number' ? det.confidence : 1.0,
          selected: false,
        };
      });
    }

    // Size the canvas
    resizeCanvas();

    // Load image
    image = new Image();
    image.crossOrigin = 'anonymous';

    image.onload = function () {
      // If server didn't provide dimensions, use natural image size
      if (!imgNaturalW || !imgNaturalH) {
        imgNaturalW = image.naturalWidth;
        imgNaturalH = image.naturalHeight;
      }

      fitImageToCanvas();
      render();
      notifyBoxesChanged();
    };

    image.onerror = function () {
      if (typeof showToast === 'function') {
        showToast('Failed to load image', 'error');
      }
    };

    image.src = imageUrl;

    // Bind event listeners
    boundOnMouseDown = onMouseDown;
    boundOnMouseMove = onMouseMove;
    boundOnMouseUp = onMouseUp;
    boundOnWheel = onWheel;
    boundOnKeyDown = onKeyDown;
    boundOnKeyUp = onKeyUp;
    boundOnContextMenu = onContextMenu;

    canvas.addEventListener('mousedown', boundOnMouseDown);
    canvas.addEventListener('mousemove', boundOnMouseMove);
    canvas.addEventListener('mouseup', boundOnMouseUp);
    canvas.addEventListener('wheel', boundOnWheel, { passive: false });
    canvas.addEventListener('contextmenu', boundOnContextMenu);

    // Global key listeners
    document.addEventListener('keydown', boundOnKeyDown);
    document.addEventListener('keyup', boundOnKeyUp);

    // Also listen for mouseup on window to catch release outside canvas
    window.addEventListener('mouseup', boundOnMouseUp);

    // ResizeObserver for auto-resize
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserver = new ResizeObserver(function () {
        resizeCanvas();
        render();
      });
      resizeObserver.observe(canvas.parentElement);
    }

    // Init toolbar buttons
    initToolbar();

    // Set initial mode to draw (HTML default has draw active)
    setMode('draw');
  }

  /* ================================================================
     Public API
     ================================================================ */

  return {
    // Properties exposed via getters/setters pattern for external code
    get canvas() { return canvas; },
    get ctx() { return ctx; },
    get image() { return image; },
    get boxes() { return boxes; },
    get scale() { return scale; },
    get offsetX() { return offsetX; },
    get offsetY() { return offsetY; },
    get mode() { return mode; },
    get selectedIdx() { return selectedIdx; },

    set onBoxesChanged(cb) { onBoxesChangedCb = cb; },
    get onBoxesChanged() { return onBoxesChangedCb; },

    init: init,
    render: render,
    addBox: addBox,
    removeBox: removeBox,
    selectBox: selectBox,
    getBoxes: getBoxes,
    setMode: setMode,
    fitImageToCanvas: function () {
      fitImageToCanvas();
      render();
    },
  };

})();

// Export as global
window.bboxEditor = bboxEditor;
