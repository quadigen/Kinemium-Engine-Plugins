from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import quote
import zipfile


IGNORED_PARTS = {".git"}
TEXT_ENCODING = "utf-8"


class RegistryBuildError(RuntimeError):
    """Raised when the registry cannot be built from the given inputs."""


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


@dataclass
class PluginFile:
    source_path: Path
    relative_path: str
    size: int
    sha256: str
    content_type: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the GitHub Pages registry for Kinemium plugins."
    )
    parser.add_argument(
        "--plugins-dir",
        type=Path,
        default=Path("plugins"),
        help="Directory containing plugin folders.",
    )
    parser.add_argument(
        "--site-dir",
        type=Path,
        default=Path("site"),
        help="Directory containing static site files to publish.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("public"),
        help="Directory where the built site should be written.",
    )
    parser.add_argument(
        "--ignore-plugin-errors",
        action="store_true",
        help=(
            "Report broken plugins as warnings and still exit successfully "
            "instead of failing the build."
        ),
    )
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).replace(
        microsecond=0
    ).isoformat().replace("+00:00", "Z")


def safe_read_text(path: Path) -> str:
    return path.read_text(encoding=TEXT_ENCODING, errors="replace")


def read_manifest(path: Path) -> dict:
    try:
        raw = path.read_text(encoding=TEXT_ENCODING)
    except (OSError, UnicodeDecodeError) as exc:
        raise RegistryBuildError(f"manifest.json could not be read: {exc}") from exc

    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RegistryBuildError(f"invalid manifest.json: {exc}") from exc

    if not isinstance(manifest, dict):
        raise RegistryBuildError(
            f"manifest.json must contain a JSON object, got {type(manifest).__name__}"
        )
    return manifest


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding=TEXT_ENCODING,
    )


def relative_url(*parts: str) -> str:
    return "/".join(quote(part) for part in parts if part)


def resolve_within(root: Path, relative_path: str | None) -> Path | None:
    if not relative_path:
        return None

    candidate = (root / relative_path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def copy_asset(
    plugin_dir: Path,
    output_dir: Path,
    slug: str,
    relative_path: object,
    asset_kind: str,
) -> str | None:
    if relative_path is None:
        return None

    if not isinstance(relative_path, str) or not relative_path.strip():
        raise RegistryBuildError(
            f"manifest {asset_kind} must be a non-empty relative path, "
            f"got {relative_path!r}"
        )

    source_path = resolve_within(plugin_dir, relative_path)
    if source_path is None:
        raise RegistryBuildError(
            f"manifest {asset_kind} path escapes the plugin directory: {relative_path!r}"
        )
    if not source_path.is_file():
        raise RegistryBuildError(
            f"manifest {asset_kind} file does not exist: {relative_path!r}"
        )

    relative = source_path.relative_to(plugin_dir.resolve())
    destination = output_dir / "assets" / "plugins" / slug / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, destination)

    return relative_url("assets", "plugins", slug, *relative.parts)


def sha256_for_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def iter_plugin_files(plugin_dir: Path) -> Iterable[PluginFile]:
    for path in sorted(plugin_dir.rglob("*")):
        if not path.is_file():
            continue

        relative = path.relative_to(plugin_dir)
        if any(part in IGNORED_PARTS for part in relative.parts):
            continue

        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        yield PluginFile(
            source_path=path,
            relative_path=relative.as_posix(),
            size=path.stat().st_size,
            sha256=sha256_for_file(path),
            content_type=content_type,
        )


def build_archive(output_dir: Path, slug: str, files: list[PluginFile]) -> dict:
    archive_path = output_dir / "downloads" / f"{slug}.zip"
    archive_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for plugin_file in files:
            archive.write(
                plugin_file.source_path,
                arcname=f"{slug}/{plugin_file.relative_path}",
            )

    return {
        "name": archive_path.name,
        "url": relative_url("downloads", archive_path.name),
        "size": archive_path.stat().st_size,
        "sha256": sha256_for_file(archive_path),
    }


def plugin_updated_at(files: list[PluginFile]) -> str:
    latest_timestamp = max(
        plugin_file.source_path.stat().st_mtime for plugin_file in files
    )
    return iso_from_timestamp(latest_timestamp)


def build_plugin_payload(
    plugin_dir: Path, output_dir: Path, generated_at: str
) -> tuple[dict, dict] | None:
    slug = plugin_dir.name
    files = list(iter_plugin_files(plugin_dir))
    if not files:
        raise RegistryBuildError(
            "plugin directory contains no publishable files "
            "(an uninitialized submodule?)"
        )

    manifest_path = plugin_dir / "manifest.json"
    if not manifest_path.is_file():
        warn(f"Skipping {slug}: missing manifest.json")
        return None

    manifest = read_manifest(manifest_path)

    readme_path = plugin_dir / "README.md"
    readme = safe_read_text(readme_path) if readme_path.is_file() else ""

    icon_url = copy_asset(plugin_dir, output_dir, slug, manifest.get("icon"), "icon")
    thumbnail_url = copy_asset(
        plugin_dir, output_dir, slug, manifest.get("thumbnail"), "thumbnail"
    )
    download = build_archive(output_dir, slug, files)
    updated_at = plugin_updated_at(files)

    detail_payload = {
        "version": 1,
        "generatedAt": generated_at,
        "slug": slug,
        "sourceDir": f"plugins/{slug}",
        "updatedAt": updated_at,
        "manifest": manifest,
        "assets": {
            "iconUrl": icon_url,
            "thumbnailUrl": thumbnail_url,
        },
        "readme": readme,
        "download": download,
        "files": [
            {
                "path": plugin_file.relative_path,
                "size": plugin_file.size,
                "sha256": plugin_file.sha256,
                "contentType": plugin_file.content_type,
            }
            for plugin_file in files
        ],
    }

    summary_payload = {
        "slug": slug,
        "generatedAt": generated_at,
        "updatedAt": updated_at,
        "manifest": manifest,
        "assets": {
            "iconUrl": icon_url,
            "thumbnailUrl": thumbnail_url,
        },
        "download": download,
        "detailsUrl": relative_url("plugins", f"{slug}.json"),
        "fileCount": len(files),
    }

    return summary_payload, detail_payload


def build_registry(
    plugins_dir: Path,
    site_dir: Path,
    output_dir: Path,
    ignore_plugin_errors: bool = False,
) -> None:
    if not plugins_dir.is_dir():
        raise RegistryBuildError(f"Plugins directory not found: {plugins_dir}")
    if not site_dir.is_dir():
        raise RegistryBuildError(f"Site directory not found: {site_dir}")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    shutil.copytree(site_dir, output_dir, dirs_exist_ok=True)

    generated_at = now_iso()
    summaries: list[dict] = []
    failures: list[str] = []

    for plugin_dir in sorted(path for path in plugins_dir.iterdir() if path.is_dir()):
        try:
            payloads = build_plugin_payload(plugin_dir, output_dir, generated_at)
        except (RegistryBuildError, OSError, zipfile.BadZipFile) as exc:
            failures.append(f"{plugin_dir.name}: {exc}")
            warn(f"Failed to build {plugin_dir.name}: {exc}")
            continue

        if payloads is None:
            continue

        summary_payload, detail_payload = payloads
        summaries.append(summary_payload)
        write_json(output_dir / "plugins" / f"{plugin_dir.name}.json", detail_payload)
        print(f"Built {plugin_dir.name}")

    summaries.sort(
        key=lambda item: (
            str(item["manifest"].get("name", "")).lower(),
            item["slug"].lower(),
        )
    )

    write_json(
        output_dir / "plugins.json",
        {
            "version": 1,
            "generatedAt": generated_at,
            "pluginCount": len(summaries),
            "plugins": summaries,
        },
    )

    print(f"Built {len(summaries)} plugin(s)")

    if failures:
        details = "\n".join(f"  - {failure}" for failure in failures)
        if ignore_plugin_errors:
            warn(f"{len(failures)} plugin(s) failed to build:\n{details}")
            return
        raise RegistryBuildError(f"{len(failures)} plugin(s) failed to build:\n{details}")


def main() -> int:
    args = parse_args()
    try:
        build_registry(
            plugins_dir=args.plugins_dir,
            site_dir=args.site_dir,
            output_dir=args.output_dir,
            ignore_plugin_errors=args.ignore_plugin_errors,
        )
    except RegistryBuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
