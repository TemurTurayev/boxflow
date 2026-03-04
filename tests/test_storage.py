"""Tests for the Storage class."""

from __future__ import annotations

from pathlib import Path

from boxflow.core.storage import Storage


class TestStorageDirectories:
    """Verify that Storage creates and exposes the correct directory tree."""

    def test_ensure_directories_creates_tree(self, data_dir: Path) -> None:
        storage = Storage(data_dir)
        storage.ensure_directories()

        assert storage.uploads_dir.is_dir()
        assert storage.images_dir.is_dir()
        assert storage.labels_dir.is_dir()
        assert storage.crops_dir.is_dir()
        assert storage.meta_dir.is_dir()
        assert storage.reference_dir.is_dir()

    def test_root_property(self, data_dir: Path) -> None:
        storage = Storage(data_dir)
        assert storage.root == data_dir

    def test_ensure_directories_is_idempotent(self, data_dir: Path) -> None:
        storage = Storage(data_dir)
        storage.ensure_directories()
        storage.ensure_directories()
        assert storage.uploads_dir.is_dir()


class TestStorageResolve:
    """Verify image resolution by stem."""

    def test_resolve_image_found(self, storage: Storage) -> None:
        (storage.uploads_dir / "abc123.jpg").write_bytes(b"fake")
        result = storage.resolve_image("abc123")
        assert result is not None
        assert result.stem == "abc123"

    def test_resolve_image_not_found(self, storage: Storage) -> None:
        assert storage.resolve_image("nonexistent") is None

    def test_list_uploads_empty(self, storage: Storage) -> None:
        assert storage.list_uploads() == []

    def test_list_uploads_returns_files(self, storage: Storage) -> None:
        (storage.uploads_dir / "a.jpg").write_bytes(b"a")
        (storage.uploads_dir / "b.png").write_bytes(b"b")
        uploads = storage.list_uploads()
        assert len(uploads) == 2

    def test_list_categories_from_crops(self, storage: Storage) -> None:
        (storage.crops_dir / "cat_a").mkdir()
        (storage.crops_dir / "cat_b").mkdir()
        cats = storage.list_categories()
        assert cats == ["cat_a", "cat_b"]
