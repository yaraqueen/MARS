"""Start the Mars Landing VR HUD on this computer: python serve.py  (then the browser opens by itself)."""
import http.server
import os
import socketserver
import webbrowser

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Browsers refuse .mjs / .wasm files sent with the wrong type, so set them explicitly
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".onnx": "application/octet-stream",
    }


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as server:
    url = f"http://localhost:{PORT}"
    print(f"Mars Landing VR running at {url}  (Ctrl+C to stop)")
    webbrowser.open(url)
    server.serve_forever()
