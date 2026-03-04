# BoxFlow

AI-assisted image labeling for object detection. Upload images, auto-detect objects with YOLO, classify with CLIP, and export in YOLO/COCO/VOC/CSV formats.

## Features

- **Web UI** -- Upload images, draw/edit bounding boxes, assign labels
- **Auto-detection** -- YOLO-powered object detection with adjustable confidence
- **Auto-classification** -- CLIP-based category suggestions from reference images
- **Multi-format export** -- YOLO txt, COCO JSON, Pascal VOC XML, CSV
- **Plugin architecture** -- Swap detection/classification backends via providers
- **Model management** -- Download and switch models from the settings panel
- **Dashboard** -- Track labeling progress, dataset stats, and model info
- **Keyboard shortcuts** -- Fast labeling workflow with hotkeys

## Quick Start

```bash
pip install boxflow[all]
boxflow --port 8001
```

Open `http://localhost:8001` in your browser.

### Minimal install (no AI)

```bash
pip install boxflow
boxflow
```

Manual bounding box drawing and labeling works without any AI dependencies.

### With detection only

```bash
pip install boxflow[yolo]
boxflow --detection-model yolov8s.pt
```

### With detection + classification

```bash
pip install boxflow[all]
boxflow --detection-model yolov8s.pt --classifier-provider clip
```

## Workflow

1. **Upload** -- Drag-and-drop or select images
2. **Detect** -- Auto-detect objects (or draw boxes manually)
3. **Label** -- Assign categories (auto-suggested or manual)
4. **Export** -- Download labels in your preferred format

## Configuration

All settings can be set via environment variables with the `BOXFLOW_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `BOXFLOW_PORT` | `8001` | Server port |
| `BOXFLOW_HOST` | `0.0.0.0` | Bind address |
| `BOXFLOW_DATA_DIR` | `./data` | Data directory for uploads, labels, crops |
| `BOXFLOW_DETECTION_PROVIDER` | `yolo` | Detection backend (`yolo`) |
| `BOXFLOW_DETECTION_MODEL` | `yolov8n.pt` | YOLO model file |
| `BOXFLOW_DETECTION_CONFIDENCE` | `0.25` | Minimum detection confidence |
| `BOXFLOW_DETECTION_IMGSZ` | `640` | Detection input resolution |
| `BOXFLOW_CLASSIFIER_PROVIDER` | `none` | Classifier backend (`clip` or `none`) |
| `BOXFLOW_CLASSIFIER_MODEL` | `ViT-B-32` | CLIP model name |
| `BOXFLOW_EXPORT_FORMAT` | `yolo` | Default export format |
| `BOXFLOW_MAX_UPLOAD_SIZE_MB` | `50` | Max upload file size |
| `BOXFLOW_CORS_ORIGINS` | `localhost` | Allowed CORS origins (JSON list) |

Or pass them as CLI arguments:

```bash
boxflow --port 9000 --data ./my-project --detection-model yolov8m.pt
```

## Data Layout

```
data/
  uploads/          # Raw uploaded images
  labeled/
    images/         # Copies of labeled images
    labels/         # YOLO-format .txt per image
  crops/            # Per-category crop directories
  meta/             # Per-image JSON metadata
  reference/        # Reference images for CLIP classification
  categories.json   # Category registry
```

## Custom Providers

BoxFlow uses a plugin architecture for detection and classification. Built-in providers:

- **`yolo`** -- Ultralytics YOLOv8/YOLO11 (requires `ultralytics`)
- **`clip`** -- OpenCLIP ViT models (requires `open_clip_torch`)

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload an image |
| POST | `/api/detect/{id}` | Run detection |
| POST | `/api/classify/{id}` | Classify detected objects |
| POST | `/api/save/{id}` | Save labels |
| POST | `/api/export` | Export labels (returns file) |
| GET | `/api/queue` | Unlabeled image queue |
| GET | `/api/history` | Labeled image history |
| GET | `/api/stats` | Dataset statistics |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create category |
| DELETE | `/api/categories/{name}` | Delete category |
| GET | `/api/settings` | Current settings |
| GET | `/api/images/{id}` | Serve uploaded image |

## Development

```bash
git clone https://github.com/TemurTurayev/boxflow.git
cd boxflow
pip install -e ".[dev,all]"
pytest
```

## License

MIT
