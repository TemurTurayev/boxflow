"""Integration tests for the API endpoints."""

from __future__ import annotations

import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from boxflow.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    """Create a test client with a temp data directory."""
    with patch.dict(
        "os.environ",
        {
            "BOXFLOW_DATA_DIR": str(tmp_path / "data"),
            "BOXFLOW_DETECTION_PROVIDER": "yolo",
        },
    ):
        app = create_app()
        return TestClient(app)


@pytest.fixture()
def jpeg_file() -> io.BytesIO:
    """Create a minimal JPEG in memory."""
    img = Image.new("RGB", (320, 240), color=(50, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    buf.name = "test.jpg"
    return buf


class TestUploadEndpoint:
    def test_upload_returns_image_id(
        self, client: TestClient, jpeg_file: io.BytesIO
    ) -> None:
        response = client.post(
            "/api/upload",
            files={"file": ("test.jpg", jpeg_file, "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "image_id" in data
        assert data["filename"] == "test.jpg"
        assert data["width"] == 320
        assert data["height"] == 240


class TestImageEndpoint:
    def test_get_image_returns_jpeg(
        self, client: TestClient, jpeg_file: io.BytesIO
    ) -> None:
        upload_resp = client.post(
            "/api/upload",
            files={"file": ("test.jpg", jpeg_file, "image/jpeg")},
        )
        image_id = upload_resp.json()["image_id"]

        response = client.get(f"/api/images/{image_id}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/jpeg"

    def test_get_missing_image_returns_404(self, client: TestClient) -> None:
        response = client.get("/api/images/deadbeef0000")
        assert response.status_code == 404


class TestCategoriesEndpoint:
    def test_list_categories_empty(self, client: TestClient) -> None:
        response = client.get("/api/categories")
        assert response.status_code == 200
        assert response.json() == []

    def test_create_category(self, client: TestClient) -> None:
        response = client.post(
            "/api/categories",
            json={"name": "vehicle"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "vehicle"
        assert data["created"] is True

    def test_create_empty_category_fails(self, client: TestClient) -> None:
        response = client.post(
            "/api/categories",
            json={"name": "  "},
        )
        assert response.status_code == 422


class TestQueueEndpoint:
    def test_queue_empty(self, client: TestClient) -> None:
        response = client.get("/api/queue")
        assert response.status_code == 200
        assert response.json() == []


class TestSettingsEndpoint:
    def test_get_settings(self, client: TestClient) -> None:
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert "detection_provider" in data
        assert "detection_model" in data
        assert "port" in data


class TestStatsEndpoint:
    def test_stats_empty(self, client: TestClient) -> None:
        response = client.get("/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert data["total_images"] == 0
        assert data["labeled_images"] == 0
