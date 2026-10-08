# The bridge serves the interface's files (index.html, css/, js/, js/vendor/) and nothing else
import os, sys, socket
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8156
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
def get(p):
    s = socket.create_connection(('127.0.0.1', PORT)); s.sendall(f'GET {p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'.encode())
    d = b''
    while True:
        c = s.recv(65536)
        if not c: break
        d += c
    head, _, body = d.partition(b'\r\n\r\n'); lines = head.decode(errors='replace').split('\r\n')
    return int(lines[0].split()[1]), next((l.split(':', 1)[1].strip() for l in lines if l.lower().startswith('content-type')), ''), body
b = start_bridge(PORT)
try:
    page = get('/')[2].decode()
    import re
    files = re.findall(r'(?:src|href)="((?:js|css)/[^"]+)"', page)
    check("the page loads its styles and 23 scripts", len(files) == 24, files)
    for f in files:
        st, ct, body = get('/' + f)
        check(f"/{f} is served as {'CSS' if f.endswith('.css') else 'JavaScript'}", st == 200 and (('css' in ct) if f.endswith('.css') else ('javascript' in ct)) and body == open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), f), 'rb').read(), (st, ct))
    for p in ['/js/nope.js', '/js/../openledmapper.py', '/js/%2e%2e/openledmapper.py', '/js/vendor/../../openledmapper.py', '/js/app.js.bak', '/tests/harness.py', '/examples/01-led-bars.json', '//etc/passwd', '/openledmapper.py', '/js/', '/css/app.css/']:
        check(f"{p} is not served", get(p)[0] == 404)
finally:
    b.terminate()
print("FAILED:", fails or "none")
