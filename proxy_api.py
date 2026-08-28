"""CORS-enabled streaming proxy for authorized downloads.

The proxy intentionally accepts only hosts listed in DOWNLOAD_ALLOWED_HOSTS.
It is not an open proxy and must only be used for files that you own or are
licensed to access and redistribute.
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
from collections.abc import AsyncIterator
from urllib.parse import unquote, urljoin, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse


APP_NAME = "CineSubz Authorized Download Proxy"
PORT = int(os.getenv("PROXY_PORT", "8000"))
MAX_DOWNLOAD_BYTES = int(os.getenv("MAX_DOWNLOAD_BYTES", str(2 * 1024 * 1024 * 1024)))
MAX_REDIRECTS = int(os.getenv("MAX_REDIRECTS", "5"))
VIDEO_CONTENT_TYPES = {"video/mp4", "video/x-matroska", "application/octet-stream"}


def csv_env(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


# Add any licensed file host explicitly, e.g.
# DOWNLOAD_ALLOWED_HOSTS=cinesubz.net,cinesubz.lk,files.yourdomain.com
ALLOWED_HOSTS = {host.lower().rstrip(".") for host in csv_env(
    "DOWNLOAD_ALLOWED_HOSTS", "cinesubz.net,cinesubz.lk"
)}
ALLOWED_ORIGINS = csv_env("ALLOWED_ORIGINS", "*")

app = FastAPI(title=APP_NAME, version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["*"]
)


class ProxyRequestError(Exception):
    """Raised for a rejected or failed upstream request."""


def host_is_allowed(hostname: str) -> bool:
    hostname = hostname.lower().rstrip(".")
    return any(hostname == allowed or hostname.endswith("." + allowed) for allowed in ALLOWED_HOSTS)


def validate_url(raw_url: str) -> str:
    value = raw_url.strip()
    parsed = urlparse(value)

    if parsed.scheme not in {"http", "https"}:
        raise ProxyRequestError("Only http:// and https:// URLs are supported")
    if not parsed.hostname:
        raise ProxyRequestError("The URL must include a hostname")
    if parsed.username or parsed.password:
        raise ProxyRequestError("URLs containing credentials are not allowed")
    if parsed.port not in {None, 80, 443}:
        raise ProxyRequestError("Only standard HTTP and HTTPS ports are allowed")
    if not host_is_allowed(parsed.hostname):
        raise ProxyRequestError(
            f"Host '{parsed.hostname}' is not allowlisted. "
            "Add it to DOWNLOAD_ALLOWED_HOSTS if you are authorized to proxy it."
        )

    # Resolve the hostname and reject private, loopback, link-local, multicast,
    # reserved, or unspecified addresses to reduce SSRF risk.
    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        }
    except socket.gaierror as exc:
        raise ProxyRequestError(f"Could not resolve upstream host: {exc}") from exc

    if not addresses:
        raise ProxyRequestError("Upstream host did not resolve to an address")

    for address in addresses:
        ip = ipaddress.ip_address(address)
        if any((ip.is_private, ip.is_loopback, ip.is_link_local, ip.is_multicast, ip.is_reserved, ip.is_unspecified)):
            raise ProxyRequestError("Upstream host resolves to a non-public address")

    return value


def safe_filename(value: str | None, fallback_url: str) -> str:
    candidate = unquote(value or "").strip()
    if not candidate:
        candidate = unquote(urlparse(fallback_url).path.rsplit("/", 1)[-1])
    candidate = re.sub(r"[^A-Za-z0-9._ -]+", "-", candidate).strip(" .-")
    return (candidate[:180] or "download.bin")


def content_disposition(filename: str) -> str:
    # ASCII-only filename after sanitization; quote for spaces and punctuation.
    return f'attachment; filename="{filename}"'


async def open_upstream(url: str, method: str = "GET") -> tuple[httpx.AsyncClient, httpx.Response, str]:
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0),
        follow_redirects=False,
        headers={"User-Agent": "AuthorizedDownloadProxy/1.0"},
    )
    current_url = url

    try:
        for _ in range(MAX_REDIRECTS + 1):
            current_url = validate_url(current_url)
            request = client.build_request(method, current_url)
            response = await client.send(request, stream=True)

            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                await response.aclose()
                if not location:
                    raise ProxyRequestError("Upstream redirect did not include a Location header")
                current_url = urljoin(current_url, location)
                continue

            if response.status_code >= 400:
                status = response.status_code
                await response.aclose()
                raise ProxyRequestError(f"Upstream returned HTTP {status}")

            content_length = response.headers.get("content-length")
            if content_length and int(content_length) > MAX_DOWNLOAD_BYTES:
                await response.aclose()
                raise ProxyRequestError("The upstream file exceeds MAX_DOWNLOAD_BYTES")

            return client, response, current_url

        raise ProxyRequestError("Too many upstream redirects")
    except Exception:
        await client.aclose()
        raise


async def resolve_upstream(url: str) -> tuple[str, httpx.Headers]:
    """Follow allowlisted redirects and return final URL plus headers only."""
    try:
        client, response, final_url = await open_upstream(url, method="HEAD")
        if response.status_code in {405, 501}:
            await response.aclose()
            await client.aclose()
            client, response, final_url = await open_upstream(url, method="GET")
        headers = response.headers
        await response.aclose()
        await client.aclose()
        return final_url, headers
    except Exception:
        raise


async def stream_limited(client: httpx.AsyncClient, response: httpx.Response) -> AsyncIterator[bytes]:
    total = 0
    try:
        async for chunk in response.aiter_bytes():
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                raise ProxyRequestError("The upstream file exceeded MAX_DOWNLOAD_BYTES while streaming")
            yield chunk
    finally:
        await response.aclose()
        await client.aclose()


@app.get("/")
async def root() -> dict[str, object]:
    return {
        "name": APP_NAME,
        "status": "running",
        "health": "/health",
        "download_endpoint": "/api/proxy-download?url=...",
        "resolve_endpoint": "/api/resolve?url=...",
        "allowed_hosts": sorted(ALLOWED_HOSTS),
    }


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "OK", "allowed_hosts": sorted(ALLOWED_HOSTS)}


@app.get("/api/resolve")
async def resolve_media(
    url: str = Query(..., description="Direct media URL on an allowlisted host"),
):
    """Resolve an authorized media URL without downloading its response body."""
    try:
        validated_url = validate_url(url)
        final_url, upstream_headers = await resolve_upstream(validated_url)
        content_type = upstream_headers.get("content-type", "application/octet-stream").split(";", 1)[0].lower()
        filename = safe_filename(None, final_url)
        content_length = upstream_headers.get("content-length")
        suffix = urlparse(final_url).path.lower()
        is_video = content_type in VIDEO_CONTENT_TYPES or suffix.endswith((".mp4", ".mkv"))

        return {
            "success": True,
            "authorized": True,
            "finalUrl": final_url,
            "contentType": content_type,
            "contentLength": int(content_length) if content_length and content_length.isdigit() else None,
            "filename": filename,
            "isVideo": is_video,
        }
    except ProxyRequestError as exc:
        return JSONResponse(status_code=400, content={"success": False, "error": str(exc)})
    except (httpx.HTTPError, ValueError) as exc:
        return JSONResponse(status_code=502, content={"success": False, "error": f"Upstream metadata request failed: {exc}"})


@app.get("/api/proxy-download")
async def proxy_download(
    url: str = Query(..., description="Direct file URL on an allowlisted host"),
    filename: str | None = Query(None, description="Optional download filename"),
):
    """Stream an authorized file through this API so the browser need not call the file host directly."""
    try:
        validated_url = validate_url(url)
        client, response, final_url = await open_upstream(validated_url)
    except ProxyRequestError as exc:
        return JSONResponse(status_code=400, content={"success": False, "error": str(exc)})
    except httpx.HTTPError as exc:
        return JSONResponse(status_code=502, content={"success": False, "error": f"Upstream request failed: {exc}"})

    output_name = safe_filename(filename, final_url)
    media_type = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0]
    headers = {
        "Content-Disposition": content_disposition(output_name),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    }
    if response.headers.get("content-length"):
        headers["Content-Length"] = response.headers["content-length"]

    return StreamingResponse(
        stream_limited(client, response),
        media_type=media_type,
        headers=headers,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("proxy_api:app", host="0.0.0.0", port=PORT, reload=False)
