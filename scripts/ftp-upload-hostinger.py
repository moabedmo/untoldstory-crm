#!/usr/bin/env python3
"""Upload hostinger-dist/ (or LOCAL_DIR) to Hostinger via FTP/FTPS."""
from __future__ import annotations

import ftplib
import os
import pathlib
import sys
import traceback


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"::error::Missing required env var: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def connect_ftp(server: str, username: str, password: str) -> ftplib.FTP:
    print(f"Connecting to {server} as {username}...")
    last_error: Exception | None = None

    for label, factory in (
        ("FTPS", lambda: ftplib.FTP_TLS()),
        ("FTP", lambda: ftplib.FTP()),
    ):
        ftp = factory()
        try:
            ftp.connect(server, 21, timeout=90)
            ftp.set_pasv(True)
            if isinstance(ftp, ftplib.FTP_TLS):
                ftp.auth()
                ftp.prot_p()
            ftp.login(username, password)
            print(f"{label} login successful (pwd={ftp.pwd()!r})")
            return ftp
        except Exception as exc:
            last_error = exc
            print(f"{label} failed: {exc}")
            try:
                ftp.close()
            except Exception:
                pass

    print("::error::All FTP connection modes failed", file=sys.stderr)
    if last_error:
        traceback.print_exception(type(last_error), last_error, last_error.__traceback__)
    sys.exit(1)


def resolve_remote_root(ftp: ftplib.FTP) -> str:
    configured = os.environ.get("FTP_REMOTE_DIR", "").strip()
    home = ftp.pwd()
    candidates: list[str] = []
    if configured:
        candidates.append(configured)
    candidates.extend(["/public_html", "public_html", home, "."])

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        try:
            ftp.cwd(candidate)
            resolved = ftp.pwd()
            print(f"Using remote root: {resolved}")
            return resolved
        except Exception as exc:
            print(f"Skip remote root {candidate!r}: {exc}")

    print("::error::Could not resolve Hostinger web root (set FTP_REMOTE_DIR secret)", file=sys.stderr)
    sys.exit(1)


def delete_remote_assets(ftp: ftplib.FTP, remote_root: str) -> None:
    assets = f"{remote_root.rstrip('/')}/assets"
    try:
        ftp.cwd(assets)
    except Exception as exc:
        print(f"Skip asset cleanup ({assets}): {exc}")
        return

    for name in ftp.nlst():
        base = name.rsplit("/", 1)[-1]
        if base in (".", ".."):
            continue
        try:
            ftp.delete(name)
            print(f"Deleted stale asset {name}")
        except Exception:
            try:
                ftp.rmd(name)
                print(f"Removed stale dir {name}")
            except Exception as exc:
                print(f"Could not delete {name}: {exc}")

    ftp.cwd(remote_root)


def upload_dir(ftp: ftplib.FTP, local_path: pathlib.Path, remote_path: str) -> None:
    try:
        ftp.mkd(remote_path)
    except Exception:
        pass

    for item in sorted(local_path.iterdir(), key=lambda p: p.name):
        remote_item = f"{remote_path}/{item.name}"
        if item.is_dir():
            upload_dir(ftp, item, remote_item)
            continue
        print(f"Uploading {remote_item} ({item.stat().st_size} bytes)")
        with item.open("rb") as handle:
            ftp.storbinary(f"STOR {remote_item}", handle)


def main() -> None:
    server = require_env("FTP_SERVER")
    username = require_env("FTP_USER")
    password = require_env("FTP_PASS")

    local_raw = os.environ.get("LOCAL_DIR", "hostinger-dist").strip() or "hostinger-dist"
    local_dir = pathlib.Path(local_raw).resolve()
    if not (local_dir / "index.html").is_file():
        print(f"::error::Missing {local_dir / 'index.html'} — run pack:hostinger first", file=sys.stderr)
        sys.exit(1)

    file_count = sum(1 for p in local_dir.rglob("*") if p.is_file())
    total_bytes = sum(p.stat().st_size for p in local_dir.rglob("*") if p.is_file())
    print(f"Local bundle: {local_dir} ({file_count} files, {total_bytes} bytes)")

    ftp = connect_ftp(server, username, password)
    try:
        remote_root = resolve_remote_root(ftp)
        delete_remote_assets(ftp, remote_root)
        upload_dir(ftp, local_dir, remote_root)
        ftp.quit()
    except Exception:
        print("::error::FTP deploy failed", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

    print("Done!")


if __name__ == "__main__":
    main()
