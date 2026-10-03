#!/usr/bin/env python3
"""Serve the planner and read item screenshots.

    python tools/server.py            # then open http://localhost:8765

Same as `python -m http.server`, plus POST /api/ocr: the planner sends a pasted screenshot
and gets the item back (see tools/ocr_item.py).
"""
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ocr_item  # noqa: E402

PORT = 8765
LOCK = threading.Lock()  # the OCR engine is not thread-safe
MAX_IMAGE = 20 * 1024 * 1024


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        # Always revalidate, so an updated planner is picked up without a hard refresh.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/api/ping":
            try:
                import rapidocr_onnxruntime  # noqa: F401
                return self.send_json(200, {"ok": True, "ocr": True})
            except ImportError:
                return self.send_json(200, {"ok": True, "ocr": False, "error": "pip install rapidocr-onnxruntime pillow"})
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/ocr":
            return self.send_json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length") or 0)
        if not n or n > MAX_IMAGE:
            return self.send_json(400, {"error": "send the image as the request body (max 20 MB)"})
        img = self.rfile.read(n)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            with LOCK:
                res = ocr_item.read_item(img, slot=q.get("slot"), level=int(q["level"]) if q.get("level") else None, cls=q.get("cls"))
            return self.send_json(200, res)
        except Exception as e:  # report OCR/parse problems to the page instead of dropping the connection
            return self.send_json(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, fmt, *args):
        # Only log OCR calls; args can hold non-strings (e.g. an HTTPStatus from log_error).
        msg = fmt % args
        if "/api/" in msg:
            sys.stderr.write(msg + "\n")

    def log_error(self, fmt, *args):
        # 404s for files like favicon.ico are normal; report other errors.
        if args and str(args[0]) != "404" and getattr(args[0], "value", None) != 404:
            sys.stderr.write((fmt % args) + "\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Deskrawl planner on http://localhost:{port}  (Ctrl+C to stop)")
    # load the OCR models now so the first paste is fast
    threading.Thread(target=lambda: ocr_item.ocr_engine(), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
