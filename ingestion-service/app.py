#!/usr/bin/env python3
"""smartbuddy-ingest — chunked, resumable, size-unlimited upload service for the dashboard.

The browser splits a file (which may be many GB) into fixed-size PARTS and uploads them one by one;
the server writes each part straight to disk, so peak memory is ONE part regardless of file size.
On completion the parts are concatenated on disk and the file is loaded by ingest_core (streamed
through DuckDB, PII hashed, swapped into the target table's month partition). Loading is heavy, so it
runs as a background JOB and the browser polls GET /uploads/{id} for phase + progress.

Protocol
  POST   /uploads                 {dataset, month, filename, size, total_parts, part_size} -> {id, ...}
  PUT    /uploads/{id}/parts/{i}  raw bytes for part i (idempotent; retry/resume safe)
  GET    /uploads/{id}            status: phase, received parts, rows, tables, rebuilt, error
  POST   /uploads/{id}/complete   assemble + start the load job (single-flight); poll GET after
  DELETE /uploads/{id}            cancel + clean up
  GET    /datasets                dataset registry (id/label/months/hint)

Safety: Keycloak-gated at the client nginx (auth_request); optional role allow-list via
SB_INGEST_ALLOWED_ROLES matched on the X-Auth-Roles the proxy forwards. Connects to ClickHouse as
the write-scoped smartbuddy_rw user. A disk-space guard and a one-at-a-time load lock protect the
shared VM; a sweeper removes stale sessions.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

import ingest_core

WORKDIR = Path(os.environ.get("SB_INGEST_WORKDIR", "/tmp/sb-uploads"))
SESSION_TTL_H = float(os.environ.get("SB_INGEST_SESSION_TTL_H", "24"))
DISK_HEADROOM = float(os.environ.get("SB_INGEST_DISK_FACTOR", "2.0"))   # need size*factor free to load
MAX_PARTS = int(os.environ.get("SB_INGEST_MAX_PARTS", "200000"))
ALLOWED_ROLES = {r.strip().lower() for r in os.environ.get("SB_INGEST_ALLOWED_ROLES", "").split(",") if r.strip()}
ID_RE = re.compile(r"^[0-9a-f]{32}$")

app = FastAPI(title="smartbuddy-ingest")
_load_lock = asyncio.Lock()        # only ONE heavy load runs at a time (bounds memory on the shared VM)
_sessions: dict[str, dict] = {}    # id -> status dict (mirrored to <session>/meta.json)


# ── session helpers ─────────────────────────────────────────────────────────
def _sdir(uid: str) -> Path:
    return WORKDIR / uid


def _save(st: dict) -> None:
    st["updated"] = int(time.time())
    d = _sdir(st["id"])
    d.mkdir(parents=True, exist_ok=True)
    (d / "meta.json").write_text(json.dumps(st), encoding="utf-8")


def _load_meta(uid: str) -> dict | None:
    if uid in _sessions:
        return _sessions[uid]
    p = _sdir(uid) / "meta.json"
    if p.exists():
        st = json.loads(p.read_text(encoding="utf-8"))
        _sessions[uid] = st
        return st
    return None


def _received_parts(uid: str) -> list[int]:
    d = _sdir(uid)
    if not d.exists():
        return []
    return sorted(int(p.name[5:]) for p in d.glob("part_*") if p.name[5:].isdigit())


def _public(st: dict) -> dict:
    got = _received_parts(st["id"])
    return {
        "id": st["id"], "dataset": st["dataset"], "month": st["month"], "filename": st["filename"],
        "size": st["size"], "part_size": st["part_size"], "total_parts": st["total_parts"],
        "received": len(got), "received_parts": got, "phase": st.get("phase", "created"),
        "progress": st.get("progress", 0.0), "rows": st.get("rows"), "tables": st.get("tables"),
        "rebuilt": st.get("rebuilt"), "error": st.get("error"), "hint": st.get("hint"),
    }


def _check_roles(request: Request) -> None:
    if ALLOWED_ROLES:
        roles = {r.strip().lower() for r in request.headers.get("x-auth-roles", "").split(",") if r.strip()}
        if not (roles & ALLOWED_ROLES):
            raise HTTPException(403, "Not permitted: this account lacks an ingest role.")


# ── endpoints ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/datasets")
def datasets():
    return {"datasets": ingest_core.dataset_info()}


@app.post("/uploads")
async def start_upload(request: Request):
    _check_roles(request)
    body = await request.json()
    dataset = str(body.get("dataset", ""))
    month = str(body.get("month", ""))
    filename = str(body.get("filename", "")).strip() or "upload"
    ext = Path(filename).suffix.lower()
    if dataset not in ingest_core.DATASETS:
        raise HTTPException(400, f"Unknown dataset '{dataset}'.")
    if not ingest_core.MONTH_RE.match(month):
        raise HTTPException(400, "Bad month; expected YYYY-MM (e.g. 2026-03).")
    if ext not in (".parquet", ".csv"):
        raise HTTPException(400, "File must be .parquet or .csv.")
    try:
        size = int(body.get("size", 0)); total_parts = int(body.get("total_parts", 0))
        part_size = int(body.get("part_size", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "size / total_parts / part_size must be integers.")
    if total_parts < 1 or total_parts > MAX_PARTS or part_size < 1:
        raise HTTPException(400, f"total_parts must be 1..{MAX_PARTS} and part_size > 0.")

    uid = os.urandom(16).hex()
    st = {"id": uid, "dataset": dataset, "month": month, "filename": filename, "ext": ext,
          "size": size, "part_size": part_size, "total_parts": total_parts,
          "phase": "uploading", "progress": 0.0, "created": int(time.time())}
    _sessions[uid] = st
    _save(st)
    return _public(st)


@app.put("/uploads/{uid}/parts/{index}")
async def put_part(uid: str, index: int, request: Request):
    if not ID_RE.match(uid):
        raise HTTPException(400, "Bad upload id.")
    st = _load_meta(uid)
    if not st:
        raise HTTPException(404, "Unknown upload id (expired?).")
    if st.get("phase") not in ("uploading",):
        raise HTTPException(409, f"Upload is '{st.get('phase')}', not accepting parts.")
    if index < 0 or index >= st["total_parts"]:
        raise HTTPException(400, f"Part index out of range 0..{st['total_parts'] - 1}.")
    data = await request.body()
    if not data:
        raise HTTPException(400, "Empty part.")
    tmp = _sdir(uid) / f".part_{index}.tmp"
    tmp.write_bytes(data)                                   # write to a temp name, then atomic rename
    tmp.rename(_sdir(uid) / f"part_{index:06d}")
    got = _received_parts(uid)
    st["progress"] = round(len(got) / st["total_parts"], 4)
    _save(st)
    return {"received": len(got), "total": st["total_parts"]}


@app.get("/uploads/{uid}")
async def get_upload(uid: str):
    if not ID_RE.match(uid):
        raise HTTPException(400, "Bad upload id.")
    st = _load_meta(uid)
    if not st:
        raise HTTPException(404, "Unknown upload id (expired?).")
    return _public(st)


@app.delete("/uploads/{uid}")
async def cancel_upload(uid: str):
    if not ID_RE.match(uid):
        raise HTTPException(400, "Bad upload id.")
    _sessions.pop(uid, None)
    shutil.rmtree(_sdir(uid), ignore_errors=True)
    return {"status": "deleted"}


@app.post("/uploads/{uid}/complete")
async def complete_upload(uid: str, request: Request):
    _check_roles(request)
    if not ID_RE.match(uid):
        raise HTTPException(400, "Bad upload id.")
    st = _load_meta(uid)
    if not st:
        raise HTTPException(404, "Unknown upload id (expired?).")
    if st.get("phase") in ("assembling", "loading", "rebuilding", "queued"):
        return _public(st)                                  # already in flight
    if st.get("phase") == "done":
        return _public(st)
    missing = [i for i in range(st["total_parts"]) if i not in set(_received_parts(uid))]
    if missing:
        raise HTTPException(409, {"error": "Upload incomplete.",
                                  "missing_count": len(missing), "missing_sample": missing[:20]})
    st["phase"] = "queued"; st["error"] = None; _save(st)
    asyncio.create_task(_process(uid))
    return _public(st)


# ── background load job ─────────────────────────────────────────────────────────
async def _process(uid: str) -> None:
    st = _sessions.get(uid)
    if not st:
        return
    async with _load_lock:                                  # one heavy load at a time
        d = _sdir(uid)
        assembled = d / f"assembled{st['ext']}"
        try:
            # disk guard — need room for the assembled file + DuckDB temp
            need = int(st["size"] * DISK_HEADROOM)
            free = shutil.disk_usage(WORKDIR).free
            if free < need:
                raise RuntimeError(f"Not enough disk to load: need ~{need >> 20} MB, {free >> 20} MB free.")

            st["phase"] = "assembling"; st["progress"] = 0.0; _save(st)
            await asyncio.to_thread(_assemble, uid, assembled)

            def on_progress(ev: dict) -> None:              # called from the worker thread
                st["phase"] = ev.get("phase", st["phase"])
                if ev.get("phase") == "loading" and ev.get("rows"):
                    st["load_rows"] = ev["rows"]
                if ev.get("phase") == "rebuild_warn":
                    st.setdefault("warnings", []).append(f"{ev.get('table')}: {ev.get('error')}")

            st["phase"] = "loading"; _save(st)
            result = await asyncio.to_thread(
                ingest_core.load_dataset, str(assembled), st["dataset"], st["month"],
                client=None, salt=None, on_progress=on_progress)

            st.update(phase="done", progress=1.0, rows=result["rows"],
                      tables=result["tables"], rebuilt=result["rebuilt"])
            if st.get("warnings"):
                st["hint"] = "Loaded, but some aggregate rebuilds warned: " + "; ".join(st["warnings"][:5])
            _save(st)
        except Exception as e:                              # surface a clean one-line reason
            st.update(phase="error", error=str(e).splitlines()[0] or e.__class__.__name__)
            _save(st)
        finally:
            try:
                assembled.unlink(missing_ok=True)
                for p in d.glob("part_*"):
                    p.unlink(missing_ok=True)
            except OSError:
                pass


def _assemble(uid: str, out: Path) -> None:
    st = _sessions[uid]
    with out.open("wb") as w:
        for i in range(st["total_parts"]):
            part = _sdir(uid) / f"part_{i:06d}"
            with part.open("rb") as r:
                shutil.copyfileobj(r, w, length=1 << 20)


# ── stale-session sweeper ────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup():
    WORKDIR.mkdir(parents=True, exist_ok=True)
    asyncio.create_task(_sweeper())


async def _sweeper() -> None:
    while True:
        cutoff = time.time() - SESSION_TTL_H * 3600
        try:
            for d in WORKDIR.iterdir() if WORKDIR.exists() else []:
                meta = d / "meta.json"
                if meta.exists() and meta.stat().st_mtime < cutoff:
                    _sessions.pop(d.name, None)
                    shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass
        await asyncio.sleep(3600)


@app.exception_handler(HTTPException)
async def _http_exc(_req: Request, exc: HTTPException):     # let dict details pass through as JSON
    detail = exc.detail
    return JSONResponse(status_code=exc.status_code,
                        content=detail if isinstance(detail, dict) else {"error": detail})
