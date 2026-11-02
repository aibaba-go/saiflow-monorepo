"""Tiny health endpoint for script tests: fake_health_server.py <ok|degraded|wrongversion>.
Prints the bound port on the first line of stdout, then serves until killed."""

import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

MODE = sys.argv[1]
BODIES = {
    "ok": (200, {"status": "ok", "version": "v1", "database": "ok"}),
    "degraded": (503, {"status": "degraded", "version": "v1", "database": "error"}),
    "wrongversion": (200, {"status": "ok", "version": "v0", "database": "ok"}),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        status, body = BODIES[MODE] if self.path == "/api/v1/health" else (404, {})
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
