from __future__ import annotations

import hashlib
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import generate_registry as gr


ISO_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


@pytest.fixture
def site_dir(tmp_path: Path) -> Path:
    site = tmp_path / "site"
    site.mkdir()
    (site / "index.html").write_text("<html></html>", encoding="utf-8")
    (site / "app.js").write_text("console.log('kinemium');", encoding="utf-8")
    return site


@pytest.fixture
def plugins_dir(tmp_path: Path) -> Path:
    plugins = tmp_path / "plugins"
    plugins.mkdir()
    return plugins


def make_plugin(
    plugins_dir: Path,
    slug: str,
    manifest: dict | str | None = None,
    readme: str | None = None,
    extra_files: dict[str, str] | None = None,
) -> Path:
    plugin_dir = plugins_dir / slug
    plugin_dir.mkdir(parents=True)

    if manifest is not None:
        content = manifest if isinstance(manifest, str) else json.dumps(manifest)
        (plugin_dir / "manifest.json").write_text(content, encoding="utf-8")
    if readme is not None:
        (plugin_dir / "README.md").write_text(readme, encoding="utf-8")
    for relative_path, content in (extra_files or {}).items():
        target = plugin_dir / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    return plugin_dir


class TestParseArgs:
    def test_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(sys, "argv", ["generate_registry.py"])

        args = gr.parse_args()

        assert args.plugins_dir == Path("plugins")
        assert args.site_dir == Path("site")
        assert args.output_dir == Path("public")

    def test_overrides(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "generate_registry.py",
                "--plugins-dir",
                "a",
                "--site-dir",
                "b",
                "--output-dir",
                "c",
            ],
        )

        args = gr.parse_args()

        assert (args.plugins_dir, args.site_dir, args.output_dir) == (
            Path("a"),
            Path("b"),
            Path("c"),
        )


class TestTimestamps:
    def test_now_iso_is_utc_second_precision(self) -> None:
        value = gr.now_iso()

        assert ISO_PATTERN.match(value)

    def test_iso_from_timestamp_drops_microseconds(self) -> None:
        moment = datetime(2024, 5, 4, 3, 2, 1, 987654, tzinfo=timezone.utc)

        assert gr.iso_from_timestamp(moment.timestamp()) == "2024-05-04T03:02:01Z"

    def test_iso_from_timestamp_normalizes_non_utc_input(self) -> None:
        epoch = 0.0

        assert gr.iso_from_timestamp(epoch) == "1970-01-01T00:00:00Z"


class TestSafeReadText:
    def test_reads_utf8(self, tmp_path: Path) -> None:
        path = tmp_path / "file.txt"
        path.write_text("héllo", encoding="utf-8")

        assert gr.safe_read_text(path) == "héllo"

    def test_replaces_invalid_bytes(self, tmp_path: Path) -> None:
        path = tmp_path / "file.bin"
        path.write_bytes(b"ok\xff")

        result = gr.safe_read_text(path)

        assert result.startswith("ok")
        assert "\ufffd" in result


class TestWriteJson:
    def test_creates_parents_and_trailing_newline(self, tmp_path: Path) -> None:
        path = tmp_path / "nested" / "deep" / "payload.json"

        gr.write_json(path, {"name": "héllo", "count": 2})

        raw = path.read_text(encoding="utf-8")
        assert raw.endswith("\n")
        assert "héllo" in raw
        assert json.loads(raw) == {"name": "héllo", "count": 2}


class TestRelativeUrl:
    def test_joins_and_percent_encodes(self) -> None:
        assert gr.relative_url("assets", "my plugin", "icon.png") == (
            "assets/my%20plugin/icon.png"
        )

    def test_skips_empty_parts(self) -> None:
        assert gr.relative_url("downloads", "", "a.zip") == "downloads/a.zip"

    def test_no_parts(self) -> None:
        assert gr.relative_url() == ""


class TestResolveWithin:
    def test_returns_none_for_empty_relative_path(self, tmp_path: Path) -> None:
        assert gr.resolve_within(tmp_path, None) is None
        assert gr.resolve_within(tmp_path, "") is None

    def test_resolves_child_path(self, tmp_path: Path) -> None:
        resolved = gr.resolve_within(tmp_path, "icons/icon.png")

        assert resolved == (tmp_path / "icons" / "icon.png").resolve()

    def test_rejects_parent_traversal(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        root.mkdir()

        assert gr.resolve_within(root, "../secret.txt") is None

    def test_rejects_absolute_path_outside_root(self, tmp_path: Path) -> None:
        root = tmp_path / "root"
        root.mkdir()
        outside = tmp_path / "outside.txt"
        outside.write_text("nope", encoding="utf-8")

        assert gr.resolve_within(root, str(outside)) is None


class TestCopyAsset:
    def test_copies_nested_asset_and_returns_url(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        (plugin_dir / "art").mkdir(parents=True)
        (plugin_dir / "art" / "my icon.png").write_bytes(b"png-bytes")
        output_dir = tmp_path / "public"

        url = gr.copy_asset(plugin_dir, output_dir, "slug", "art/my icon.png")

        assert url == "assets/plugins/slug/art/my%20icon.png"
        copied = output_dir / "assets" / "plugins" / "slug" / "art" / "my icon.png"
        assert copied.read_bytes() == b"png-bytes"

    def test_returns_none_when_missing(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()

        assert gr.copy_asset(plugin_dir, tmp_path / "public", "slug", "missing.png") is None

    def test_returns_none_for_directory_target(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        (plugin_dir / "art").mkdir(parents=True)

        assert gr.copy_asset(plugin_dir, tmp_path / "public", "slug", "art") is None

    def test_returns_none_for_traversal(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")

        assert gr.copy_asset(plugin_dir, tmp_path / "public", "slug", "../secret.txt") is None

    def test_returns_none_when_asset_not_declared(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()

        assert gr.copy_asset(plugin_dir, tmp_path / "public", "slug", None) is None


class TestSha256ForFile:
    def test_matches_hashlib(self, tmp_path: Path) -> None:
        path = tmp_path / "file.bin"
        payload = b"kinemium" * 10
        path.write_bytes(payload)

        assert gr.sha256_for_file(path) == hashlib.sha256(payload).hexdigest()

    def test_handles_multi_chunk_file(self, tmp_path: Path) -> None:
        path = tmp_path / "big.bin"
        payload = b"x" * (1024 * 1024 * 2 + 7)
        path.write_bytes(payload)

        assert gr.sha256_for_file(path) == hashlib.sha256(payload).hexdigest()

    def test_empty_file(self, tmp_path: Path) -> None:
        path = tmp_path / "empty.bin"
        path.write_bytes(b"")

        assert gr.sha256_for_file(path) == hashlib.sha256(b"").hexdigest()


class TestIterPluginFiles:
    def test_collects_sorted_files_with_metadata(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "b.js").write_text("let a = 1;", encoding="utf-8")
        (plugin_dir / "sub").mkdir()
        (plugin_dir / "sub" / "a.json").write_text("{}", encoding="utf-8")

        files = list(gr.iter_plugin_files(plugin_dir))

        assert [item.relative_path for item in files] == ["b.js", "sub/a.json"]
        json_file = files[1]
        assert json_file.size == 2
        assert json_file.sha256 == hashlib.sha256(b"{}").hexdigest()
        assert json_file.content_type == "application/json"

    def test_skips_git_directory(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        (plugin_dir / ".git" / "objects").mkdir(parents=True)
        (plugin_dir / ".git" / "objects" / "blob").write_text("x", encoding="utf-8")
        (plugin_dir / "keep.txt").write_text("x", encoding="utf-8")

        files = list(gr.iter_plugin_files(plugin_dir))

        assert [item.relative_path for item in files] == ["keep.txt"]

    def test_falls_back_to_octet_stream(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "data.kinemium").write_text("x", encoding="utf-8")

        files = list(gr.iter_plugin_files(plugin_dir))

        assert files[0].content_type == "application/octet-stream"

    def test_empty_plugin_dir(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()

        assert list(gr.iter_plugin_files(plugin_dir)) == []


class TestBuildArchive:
    def test_writes_zip_with_slug_prefix(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "main.js").write_text("export default 1;", encoding="utf-8")
        files = list(gr.iter_plugin_files(plugin_dir))
        output_dir = tmp_path / "public"

        download = gr.build_archive(output_dir, "my-plugin", files)

        archive_path = output_dir / "downloads" / "my-plugin.zip"
        assert download["name"] == "my-plugin.zip"
        assert download["url"] == "downloads/my-plugin.zip"
        assert download["size"] == archive_path.stat().st_size
        assert download["sha256"] == gr.sha256_for_file(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            assert archive.namelist() == ["my-plugin/main.js"]
            assert archive.read("my-plugin/main.js") == b"export default 1;"

    def test_percent_encodes_url_for_slug_with_space(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        (plugin_dir / "a.txt").write_text("a", encoding="utf-8")
        files = list(gr.iter_plugin_files(plugin_dir))

        download = gr.build_archive(tmp_path / "public", "my plugin", files)

        assert download["url"] == "downloads/my%20plugin.zip"


class TestPluginUpdatedAt:
    def test_uses_latest_mtime(self, tmp_path: Path) -> None:
        plugin_dir = tmp_path / "plugin"
        plugin_dir.mkdir()
        older = plugin_dir / "older.txt"
        newer = plugin_dir / "newer.txt"
        older.write_text("a", encoding="utf-8")
        newer.write_text("b", encoding="utf-8")
        import os

        os.utime(older, (1_600_000_000, 1_600_000_000))
        os.utime(newer, (1_700_000_000, 1_700_000_000))
        files = list(gr.iter_plugin_files(plugin_dir))

        assert gr.plugin_updated_at(files) == gr.iso_from_timestamp(1_700_000_000)


class TestBuildPluginPayload:
    def test_builds_summary_and_detail(self, tmp_path: Path, plugins_dir: Path) -> None:
        plugin_dir = make_plugin(
            plugins_dir,
            "kinemium-oneko",
            manifest={"name": "Oneko", "icon": "icon.png", "thumbnail": "thumb.png"},
            readme="# Oneko",
            extra_files={"icon.png": "icon", "thumb.png": "thumb", "main.js": "run();"},
        )
        output_dir = tmp_path / "public"

        summary, detail = gr.build_plugin_payload(plugin_dir, output_dir, "2024-01-01T00:00:00Z")

        assert summary["slug"] == "kinemium-oneko"
        assert summary["generatedAt"] == "2024-01-01T00:00:00Z"
        assert summary["detailsUrl"] == "plugins/kinemium-oneko.json"
        assert summary["fileCount"] == len(detail["files"])
        assert summary["assets"] == {
            "iconUrl": "assets/plugins/kinemium-oneko/icon.png",
            "thumbnailUrl": "assets/plugins/kinemium-oneko/thumb.png",
        }
        assert summary["download"] == detail["download"]
        assert summary["updatedAt"] == detail["updatedAt"]

        assert detail["version"] == 1
        assert detail["sourceDir"] == "plugins/kinemium-oneko"
        assert detail["manifest"]["name"] == "Oneko"
        assert detail["readme"] == "# Oneko"
        assert {item["path"] for item in detail["files"]} == {
            "README.md",
            "icon.png",
            "main.js",
            "manifest.json",
            "thumb.png",
        }
        assert all(len(item["sha256"]) == 64 for item in detail["files"])

    def test_missing_readme_yields_empty_string(
        self, tmp_path: Path, plugins_dir: Path
    ) -> None:
        plugin_dir = make_plugin(plugins_dir, "plug", manifest={"name": "Plug"})

        _, detail = gr.build_plugin_payload(plugin_dir, tmp_path / "public", "now")

        assert detail["readme"] == ""

    def test_missing_assets_are_null(self, tmp_path: Path, plugins_dir: Path) -> None:
        plugin_dir = make_plugin(
            plugins_dir, "plug", manifest={"name": "Plug", "icon": "nope.png"}
        )

        summary, _ = gr.build_plugin_payload(plugin_dir, tmp_path / "public", "now")

        assert summary["assets"] == {"iconUrl": None, "thumbnailUrl": None}

    def test_skips_plugin_without_manifest(
        self, tmp_path: Path, plugins_dir: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        plugin_dir = make_plugin(plugins_dir, "plug", extra_files={"main.js": "x"})

        assert gr.build_plugin_payload(plugin_dir, tmp_path / "public", "now") is None
        assert "missing manifest.json" in capsys.readouterr().out

    def test_skips_plugin_with_invalid_manifest(
        self, tmp_path: Path, plugins_dir: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        plugin_dir = make_plugin(plugins_dir, "plug", manifest="{not json")

        assert gr.build_plugin_payload(plugin_dir, tmp_path / "public", "now") is None
        assert "invalid manifest.json" in capsys.readouterr().out

    def test_skips_plugin_with_no_publishable_files(
        self,
        tmp_path: Path,
        plugins_dir: Path,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        plugin_dir = make_plugin(plugins_dir, "plug", manifest={"name": "Plug"})
        monkeypatch.setattr(gr, "iter_plugin_files", lambda _: iter(()))

        assert gr.build_plugin_payload(plugin_dir, tmp_path / "public", "now") is None
        assert "no files to publish" in capsys.readouterr().out


class TestBuildRegistry:
    def test_raises_when_plugins_dir_missing(self, tmp_path: Path, site_dir: Path) -> None:
        with pytest.raises(FileNotFoundError, match="Plugins directory not found"):
            gr.build_registry(tmp_path / "missing", site_dir, tmp_path / "public")

    def test_raises_when_site_dir_missing(self, tmp_path: Path, plugins_dir: Path) -> None:
        with pytest.raises(FileNotFoundError, match="Site directory not found"):
            gr.build_registry(plugins_dir, tmp_path / "missing", tmp_path / "public")

    def test_copies_site_and_writes_index(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path
    ) -> None:
        make_plugin(
            plugins_dir,
            "b-plugin",
            manifest={"name": "Alpha"},
            extra_files={"main.js": "a"},
        )
        make_plugin(
            plugins_dir,
            "a-plugin",
            manifest={"name": "beta"},
            extra_files={"main.js": "b"},
        )
        output_dir = tmp_path / "public"

        gr.build_registry(plugins_dir, site_dir, output_dir)

        assert (output_dir / "index.html").read_text(encoding="utf-8") == "<html></html>"
        index = json.loads((output_dir / "plugins.json").read_text(encoding="utf-8"))
        assert index["version"] == 1
        assert index["pluginCount"] == 2
        assert ISO_PATTERN.match(index["generatedAt"])
        # Sorted case-insensitively by manifest name: "Alpha" before "beta".
        assert [item["slug"] for item in index["plugins"]] == ["b-plugin", "a-plugin"]
        assert {item["generatedAt"] for item in index["plugins"]} == {index["generatedAt"]}
        for slug in ("a-plugin", "b-plugin"):
            assert (output_dir / "plugins" / f"{slug}.json").is_file()
            assert (output_dir / "downloads" / f"{slug}.zip").is_file()

    def test_sorts_unnamed_plugins_by_slug(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path
    ) -> None:
        for slug in ("zeta", "alpha"):
            make_plugin(plugins_dir, slug, manifest={}, extra_files={"main.js": "x"})
        output_dir = tmp_path / "public"

        gr.build_registry(plugins_dir, site_dir, output_dir)

        index = json.loads((output_dir / "plugins.json").read_text(encoding="utf-8"))
        assert [item["slug"] for item in index["plugins"]] == ["alpha", "zeta"]

    def test_ignores_files_and_invalid_plugins_in_plugins_dir(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path
    ) -> None:
        (plugins_dir / "README.md").write_text("not a plugin", encoding="utf-8")
        make_plugin(plugins_dir, "broken", manifest="{oops")
        make_plugin(plugins_dir, "good", manifest={"name": "Good"})
        output_dir = tmp_path / "public"

        gr.build_registry(plugins_dir, site_dir, output_dir)

        index = json.loads((output_dir / "plugins.json").read_text(encoding="utf-8"))
        assert [item["slug"] for item in index["plugins"]] == ["good"]

    def test_empty_plugins_dir_yields_empty_index(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path
    ) -> None:
        output_dir = tmp_path / "public"

        gr.build_registry(plugins_dir, site_dir, output_dir)

        index = json.loads((output_dir / "plugins.json").read_text(encoding="utf-8"))
        assert index["pluginCount"] == 0
        assert index["plugins"] == []

    def test_clears_stale_output(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path
    ) -> None:
        output_dir = tmp_path / "public"
        output_dir.mkdir()
        stale = output_dir / "stale.txt"
        stale.write_text("old", encoding="utf-8")

        gr.build_registry(plugins_dir, site_dir, output_dir)

        assert not stale.exists()

    def test_is_idempotent(self, tmp_path: Path, plugins_dir: Path, site_dir: Path) -> None:
        make_plugin(plugins_dir, "plug", manifest={"name": "Plug"}, extra_files={"a.js": "1"})
        output_dir = tmp_path / "public"

        gr.build_registry(plugins_dir, site_dir, output_dir)
        first = json.loads((output_dir / "plugins" / "plug.json").read_text(encoding="utf-8"))
        gr.build_registry(plugins_dir, site_dir, output_dir)
        second = json.loads((output_dir / "plugins" / "plug.json").read_text(encoding="utf-8"))

        assert first["files"] == second["files"]
        assert first["download"]["sha256"] == second["download"]["sha256"]


class TestMain:
    def test_forwards_parsed_args(
        self, tmp_path: Path, plugins_dir: Path, site_dir: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        make_plugin(plugins_dir, "plug", manifest={"name": "Plug"})
        output_dir = tmp_path / "public"
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "generate_registry.py",
                "--plugins-dir",
                str(plugins_dir),
                "--site-dir",
                str(site_dir),
                "--output-dir",
                str(output_dir),
            ],
        )

        gr.main()

        index = json.loads((output_dir / "plugins.json").read_text(encoding="utf-8"))
        assert index["pluginCount"] == 1
