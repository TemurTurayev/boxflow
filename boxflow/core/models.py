"""Pydantic request/response models for the BoxFlow API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Response after uploading an image."""

    image_id: str
    filename: str
    width: int
    height: int


class BboxItem(BaseModel):
    """A single bounding box from detection."""

    bbox: tuple[float, float, float, float] = Field(
        description="(x1, y1, x2, y2) in pixel coordinates"
    )
    confidence: float
    class_name: str = ""


class DetectResponse(BaseModel):
    """Response from the detection endpoint."""

    image_id: str
    width: int
    height: int
    boxes: list[BboxItem]


class LabeledBox(BaseModel):
    """A bounding box with a user-assigned label."""

    bbox: tuple[float, float, float, float]
    label: str


class SaveRequest(BaseModel):
    """Request body for saving labels."""

    boxes: list[LabeledBox]


class SaveResponse(BaseModel):
    """Response after saving labels."""

    label_file: str
    crops_count: int
    meta_file: str


class ClassifySuggestion(BaseModel):
    """A single classification suggestion for one box."""

    bbox: tuple[float, float, float, float]
    label: str
    confidence: float


class ClassifyRequest(BaseModel):
    """Request body for classification."""

    boxes: list[BboxItem]


class ClassifyResponse(BaseModel):
    """Response from the classification endpoint."""

    suggestions: list[ClassifySuggestion]
    status: str


class CategoryInfo(BaseModel):
    """Information about a labeling category."""

    name: str
    count: int = 0
    icon_url: str = ""


class CreateCategoryRequest(BaseModel):
    """Request body for creating a new category."""

    name: str


class QueueItem(BaseModel):
    """An image in the labeling queue."""

    filename: str
    image_id: str
    thumbnail_url: str


class ExportRequest(BaseModel):
    """Request body for exporting labels."""

    format: str = Field(default="yolo", pattern="^(yolo|coco|voc|csv)$")


class ExportResponse(BaseModel):
    """Response after exporting labels."""

    format: str
    file_path: str
    images_count: int
    labels_count: int


class HistoryItem(BaseModel):
    """A labeled image in the history."""

    image_id: str
    filename: str
    labels_count: int
    categories: list[str]
    labeled_at: str


class StatsResponse(BaseModel):
    """Overall labeling statistics."""

    total_images: int
    labeled_images: int
    total_labels: int
    categories: list[CategoryInfo]


class SettingsResponse(BaseModel):
    """Current application settings."""

    host: str
    port: int
    data_dir: str
    detection_provider: str
    detection_model: str
    detection_confidence: float
    detection_imgsz: int
    classifier_provider: str
    classifier_model: str
    export_format: str
    max_upload_size_mb: int


class ModelInfoItem(BaseModel):
    """Information about an available model."""

    name: str
    size_mb: float
    description: str = ""
    installed: bool = False


class ProviderModelsResponse(BaseModel):
    """Available models for a provider."""

    provider: str
    description: str
    models: list[ModelInfoItem]


class DownloadModelRequest(BaseModel):
    """Request to download a model."""

    provider: str
    model_name: str
