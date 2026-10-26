# The bridge serves the interface's files (index.html, css/, js/, js/vendor/) and nothing else; its errors keep their
# connection open, as every reply does (some firewalls on Windows turn a connection the server ends into a reset)
import os, sys, http.client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import start_bridge, fetch
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8156
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + ("  " + str(detail)[:300] if detail != "" else ""), flush=True); ok or fails.append(name)
def get(p):
    r = fetch(f'http://127.0.0.1:{PORT}{p}')
    return r.status, r.headers.get('Content-Type', ''), r.body
b = start_bridge(PORT)
try:
    page = get('/')[2].decode()
    import re
    files = re.findall(r'(?:src|href)="((?:js|css)/[^"]+)"', page)
    check("the page loads its styles (fonts.css, app.css) and 29 scripts", len(files) == 31 and files[:2] == ['css/fonts.css', 'css/app.css'], files)
    for f in files:
        st, ct, body = get('/' + f)
        check(f"/{f} is served as {'CSS' if f.endswith('.css') else 'JavaScript'}", st == 200 and (('css' in ct) if f.endswith('.css') else ('javascript' in ct)) and body == open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), f), 'rb').read(), (st, ct))
    for f in [l.split('url(')[1].split(')')[0] for l in open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'css', 'fonts.css')) if 'url(' in l]:
        st, ct, body = get('/css/' + f)
        check(f"/css/{f} is served as a font", st == 200 and ct == 'font/woff2' and len(body) > 5000)
    for p in ['/js/nope.js', '/js/../noupix.py', '/js/%2e%2e/noupix.py', '/js/vendor/../../noupix.py', '/js/app.js.bak', '/tests/harness.py', '/examples/01-led-bars.json', '//etc/passwd', '/openledmapper.py', '/js/', '/css/app.css/', '/css/OFL.txt', '/icons/noupix.svg']:
        check(f"{p} is not served", get(p)[0] == 404)
    # errors on one connection that stays open: a 404, a 403 to a post with a body (read, so the next request is
    # clean), a 404 to a HEAD, and a page each time between them
    c = http.client.HTTPConnection('127.0.0.1', PORT, timeout=10)
    seen = []
    for method, path, body, headers in [('GET', '/js/nope.js', None, {}), ('GET', '/', None, {}),
                                        ('POST', '/media?name=x.webm', b'x' * 5000, {'Origin': 'https://example.com'}), ('GET', '/', None, {}),
                                        ('HEAD', '/nope', None, {}), ('GET', '/css/app.css', None, {})]:
        c.request(method, path, body=body, headers=headers); r = c.getresponse(); r.read()
        seen.append((r.status, r.will_close, c.sock is not None))
    check("errors keep their connection: 404, 403 to a post with a body, 404 to a HEAD, each followed by a page on the same connection",
          [s for s, *_ in seen] == [404, 200, 403, 200, 404, 200] and not any(w for _, w, _ in seen) and all(k for *_, k in seen), seen)
    c.close()
finally:
    b.terminate()
print("FAILED:", fails or "none")
