# BoxFlow

AI-assisted image labeling for object detection.

Upload images, auto-detect objects with YOLO, classify with CLIP, export in YOLO/COCO/VOC/CSV formats.

## Installation

```bash
pip install boxflow
```

With detection and classification support:

```bash
pip install boxflow[all]
```

## Quick Start

```bash
boxflow --port 8001 --data ./my-labels
```

Then open `http://localhost:8001` in your browser.

## Configuration

All settings can be configured via environment variables with the `BOXFLOW_` prefix:

| Variable | Default | Description |
|----------|---------|-------------|
| `BOXFLOW_HOST` | `0.0.0.0` | Server host |
| `BOXFLOW_PORT` | `8001` | Server port |
| `BOXFLOW_DATA_DIR` | `./data` | Data directory |
| `BOXFLOW_DETECTION_PROVIDER` | `yolo` | Detection backend |
| `BOXFLOW_DETECTION_MODEL` | `yolov8n.pt` | Model file |
| `BOXFLOW_DETECTION_CONFIDENCE` | `0.25` | Min confidence |
| `BOXFLOW_CLASSIFIER_PROVIDER` | `none` | Classifier backend |
| `BOXFLOW_EXPORT_FORMAT` | `yolo` | Default export format |

## License

MIT
