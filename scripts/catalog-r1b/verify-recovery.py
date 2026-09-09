"""Read immutable R1 originals; decode 126 gaps and serve exact catalog paths locally.
No provider writes, URL mutation, credentials or full redownloads. Requires installed Pillow.
"""
import json, hashlib, pathlib, datetime, io, threading, urllib.parse, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image
source = pathlib.Path('/Users/lolo/PrivateBackups/mutter-catalog-r1-20260908')
out = pathlib.Path('/Users/lolo/PrivateBackups/mutter-catalog-r1b-20260909')
out.mkdir(mode=0o700, exist_ok=True)
load = lambda name: json.loads((source/name).read_text())
refs = load('image-correspondence-private.json')
metadata = load('imagekit-metadata-private.json')
catalog = {d['name']: d for d in load('catalog-firestore.json')}
gaps = [r for r in refs if r['status'] == 'URL_ORIGINAL_COPIED_METADATA_MISSING']
assert len(gaps) == 126
manifest = load('manifest.json'); assert manifest['protectionComplete'] is False

def digest(data): return hashlib.sha256(data).hexdigest()
def strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, list):
        for child in value: yield from strings(child)
    elif isinstance(value, dict):
        for child in value.values(): yield from strings(child)
def signature(data):
    if data[:3] == b'\xff\xd8\xff': return 'JPEG'
    if data[:8] == b'\x89PNG\r\n\x1a\n': return 'PNG'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return 'WEBP'
    raise ValueError('Unknown image signature')
route_map = {}
results = []
for ref in gaps:
    blob = (source/'originals'/ref['sha256']).read_bytes()
    assert digest(blob) == ref['sha256'] and len(blob) == ref['bytes']
    kind = signature(blob)
    with Image.open(io.BytesIO(blob)) as image:
        assert image.format == kind
        image.verify()
    with Image.open(io.BytesIO(blob)) as image:
        image.load(); width, height = image.size
        assert width > 0 and height > 0
    owners = [d for name,d in catalog.items() if name == ref['owner'] or name.endswith('/documents/'+ref['owner'])]
    assert len(owners) == 1 and ref['url'] in set(strings(owners[0].get('fields', {})))
    url = urllib.parse.urlsplit(ref['url']); assert url.scheme == 'https' and url.hostname == 'ik.imagekit.io'
    route = url.path + ('?'+url.query if url.query else '')
    assert not url.query, 'Unexpected transformed URL'
    assert route not in route_map or route_map[route]['sha256'] == ref['sha256']
    route_map[route] = ref
    exact = [m for m in metadata if m.get('url') == ref['url']]
    path_matches = [m for m in metadata if m.get('filePath') and urllib.parse.unquote(url.path).endswith(m['filePath'])]
    results.append({**ref, 'signature':kind,'decoded':True,'width':width,'height':height,'catalogReferenceVerified':True,'exactLibraryMatches':len(exact),'pathLibraryMatches':len(path_matches)})
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        ref = route_map.get(self.path)
        if ref is None: self.send_error(404); return
        blob = (source/'originals'/ref['sha256']).read_bytes()
        kind = signature(blob)
        self.send_response(200); self.send_header('Content-Type',{'JPEG':'image/jpeg','PNG':'image/png','WEBP':'image/webp'}[kind]);self.send_header('Content-Length',str(len(blob)));self.end_headers();self.wfile.write(blob)
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
try:
    for route, ref in route_map.items():
        with urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}'+route, timeout=10) as response:
            data=response.read();assert digest(data)==ref['sha256'];assert response.headers['Content-Type'].startswith('image/')
            with Image.open(io.BytesIO(data)) as image:image.load()
    try: urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}/unmapped',timeout=10)
    except urllib.error.HTTPError as error: assert error.code == 404
    else: raise AssertionError('Unmapped route should fail')
finally: server.shutdown();server.server_close();thread.join()
# Recheck every backed-up reference hash, without copying or modifying originals.
unique={r['sha256'] for r in refs}
for sha in unique: assert digest((source/'originals'/sha).read_bytes())==sha
assert unique == {p.name for p in (source/'originals').iterdir() if p.is_file()}
summary={'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'references':len(refs),'uniqueBlobsRehashed':len(unique),'gapReferences':len(gaps),'gapSignaturesAndDecodes':len(results),'localExactRoutesRestored':len(route_map),'originalManifestSHA256':digest((source/'manifest.json').read_bytes()),'originalManifestUnchanged':True,'protectionComplete':False,'providerNamespaceACLRestored':False,'libraryIdentityUnresolved':sum(r['exactLibraryMatches']==0 and r['pathLibraryMatches']==0 for r in results)}
for name,data in [('recovery-private.json',results),('recovery-summary.json',summary)]:
    path=out/name
    with path.open('x') as f: json.dump(data,f,indent=2);f.write('\n')
    path.chmod(0o600)
print(json.dumps(summary))
