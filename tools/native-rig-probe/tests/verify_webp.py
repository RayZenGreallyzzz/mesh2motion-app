"""Tests the container transformation with real alpha WebP images; host codec only."""
import base64,copy,io,json,pathlib,struct,subprocess,sys,tempfile
from PIL import Image

JAVA=sys.argv[1:];checks=0;runs=0
def check(ok,why):
    global checks
    if not ok:raise AssertionError(why)
    checks+=1
def image(color):
    im=Image.new('RGBA',(3,2),color);im.putpixel((1,0),(255,0,128,127));im.putpixel((2,1),(0,0,0,0))
    b=io.BytesIO();im.save(b,format='WEBP',lossless=True,exact=True);return b.getvalue()
def pack(g,b,bin=True):
    g=copy.deepcopy(g)
    if bin:g['buffers']=[{'byteLength':len(b)}]
    j=json.dumps(g,separators=(',',':')).encode();j+=b' '*(-len(j)%4);b+=b'\0'*(-len(b)%4)
    data=struct.pack('<II',len(j),0x4e4f534a)+j
    if bin:data+=struct.pack('<II',len(b),0x004e4942)+b
    return struct.pack('<III',0x46546c67,2,12+len(data))+data
def unpack(raw):
    check(struct.unpack_from('<III',raw)==(0x46546c67,2,len(raw)),'GLB lengths')
    n,t=struct.unpack_from('<II',raw,12);g=json.loads(raw[20:20+n]);b=b''
    if len(raw)>20+n:
        size,kind=struct.unpack_from('<II',raw,20+n);check(kind==0x004e4942 and len(raw)==28+n+size,'BIN header');b=raw[28+n:]
    return g,b
def fixture():
    webp=image((10,100,200,255));b=bytearray(struct.pack('<9f',0,0,0,1,0,0,0,1,0));offset=len(b);b.extend(webp);b.extend(b'\0'*(-len(b)%4))
    g={'asset':{'version':'2.0'},'extensionsUsed':['EXT_texture_webp','KHR_texture_transform'],'extensionsRequired':['EXT_texture_webp'],
       'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'scale':[.001]*3,'translation':[1,2,3]}],
       'meshes':[{'primitives':[{'attributes':{'POSITION':0},'material':0}]}],
       'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[0,0,0],'max':[1,1,0]}],
       'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':36},{'buffer':0,'byteOffset':offset,'byteLength':len(webp)}],
       'images':[{'bufferView':1,'mimeType':'image/webp','name':'alpha WebP'}],
       'textures':[{'sampler':0,'extensions':{'EXT_texture_webp':{'source':0}}}],
       'samplers':[{'wrapS':33071,'wrapT':10497}],
       'materials':[{'alphaMode':'BLEND','pbrMetallicRoughness':{'baseColorTexture':{'index':0,'extensions':{'KHR_texture_transform':{'scale':[16,16],'offset':[.1,.2]}}}}}]}
    return g,b,webp
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory)
    def run(g,b,name,fail=None,bin=True):
        global runs
        runs+=1;raw=pack(g,bytes(b),bin);src=root/(name+'.glb');out=root/(name+'-out.glb');src.write_bytes(raw)
        p=subprocess.run(JAVA+[str(src),str(out),sys.executable],capture_output=True,text=True)
        check(src.read_bytes()==raw,'original changed')
        if fail:
            check(p.returncode!=0 and fail in p.stderr,'expected error: '+fail+'; '+p.stderr);check(not out.exists(),'partial result left');return
        check(p.returncode==0,'conversion error: '+p.stderr)
        og,ob=unpack(out.read_bytes());_,ib=unpack(raw);check(ob[:len(ib)]==ib,'binary prefix modified')
        for key in ['meshes','nodes','scenes','scene','accessors','materials','samplers','skins','animations']:
            check(og.get(key)==g.get(key),'changed '+key)
        check(not list(root.glob('glb-*')),'temporary files leaked')
        return og,ob,json.loads(p.stdout),raw,out.read_bytes()
    def png(g,b,i,expected):
        im=g['images'][i];check(im['mimeType']=='image/png' and 'uri' not in im,'embedded PNG descriptor')
        v=g['bufferViews'][im['bufferView']];raw=b[v['byteOffset']:v['byteOffset']+v['byteLength']]
        check(v['byteOffset']%4==0 and raw[:8]==b'\x89PNG\r\n\x1a\n','aligned real PNG')
        actual=Image.open(io.BytesIO(raw)).convert('RGBA');original=Image.open(io.BytesIO(expected)).convert('RGBA')
        check(actual.size==original.size and actual.tobytes()==original.tobytes(),'RGBA or dimensions changed')
    g,b,webp=fixture();og,ob,r,_,_=run(g,b,'embedded');png(og,ob,0,webp)
    check(og['textures'][0]=={'source':0,'sampler':0},'extension promoted to core source')
    check(og['extensionsUsed']==['KHR_texture_transform'] and 'extensionsRequired' not in og,'only WebP extension removed')
    check(r['convertedImages']==1 and r['images'][0]['width']==3,'conversion diagnostics')
    # Shared WebP references, an independent second texture, and a PNG fallback.
    q=copy.deepcopy(g);qb=bytearray(b);second=image((200,20,100,255));view=len(q['bufferViews']);q['bufferViews'].append({'buffer':0,'byteOffset':len(qb),'byteLength':len(second)});qb.extend(second);qb.extend(b'\0'*(-len(qb)%4))
    q['images'].append({'bufferView':view,'mimeType':'image/webp'});fallback=io.BytesIO();Image.new('RGB',(1,1),'green').save(fallback,format='PNG');q['images'].append({'uri':'data:image/png;base64,'+base64.b64encode(fallback.getvalue()).decode()})
    q['textures'][0]['source']=2;q['textures'].extend([{'extensions':{'EXT_texture_webp':{'source':0},'VENDOR_keep':{'value':42}}},{'extensions':{'EXT_texture_webp':{'source':1}}}])
    og,ob,r,_,_=run(q,qb,'fallback-shared');png(og,ob,0,webp);png(og,ob,1,second)
    check(r['convertedImages']==2,'shared images converted only once');check(og['textures'][1]['extensions']=={'VENDOR_keep':{'value':42}},'other texture extensions preserved');check(og['images'][2]==q['images'][2],'PNG fallback preserved')
    # No declared extension but a core reference to WebP still needs conversion.
    q=copy.deepcopy(g);q.pop('extensionsUsed');q.pop('extensionsRequired');q['textures']=[{'source':0}]
    og,ob,_,_,_=run(q,b,'core-webp');png(og,ob,0,webp)
    # URI source, including an image-only GLB without an initial BIN chunk.
    q=copy.deepcopy(g);q['images'][0]={'uri':'data:image/webp;base64,'+base64.b64encode(webp).decode()}
    og,ob,_,_,_=run(q,b,'data-uri');png(og,ob,0,webp)
    q={'asset':{'version':'2.0'},'extensionsUsed':['EXT_texture_webp'],'images':q['images'],'textures':q['textures']}
    og,ob,_,_,_=run(q,b'','no-initial-bin',bin=False);png(og,ob,0,webp)
    # No image processing for a normal GLB; pass it through byte-exactly.
    q=copy.deepcopy(g);q.pop('extensionsUsed');q.pop('extensionsRequired');q['textures']=[];q['images']=[]
    _,_,r,raw,encoded=run(q,b,'exact-pass');check(raw==encoded and not r['changed'],'non-WebP source changed')
    # A stale declaration with no WebP references is removable without codec work.
    q['extensionsUsed']=['EXT_texture_webp','KHR_texture_transform'];og,ob,r,_,_=run(q,b,'stale');check(r['convertedImages']==0 and og['extensionsUsed']==['KHR_texture_transform'],'stale declaration')
    bad=copy.deepcopy(g);bad['textures'][0]['extensions']['EXT_texture_webp']['source']=100;run(bad,b,'bad-index','index')
    bad=copy.deepcopy(g);bad['bufferViews'][1]['byteLength']=1000000000;run(bad,b,'bad-bounds','bounds')
    bad=copy.deepcopy(g);bad['images'][0]={'uri':'https://example.invalid/image.webp','mimeType':'image/webp'};run(bad,b,'external','embedded')
    bad=copy.deepcopy(g);bad['images'][0]={'uri':'data:image/webp;base64,=Zg=='};run(bad,b,'bad-uri','base64')
    badbytes=bytearray(b);badbytes[36]=0;run(g,badbytes,'bad-signature','signature')
    print(json.dumps({'status':'passed','assertions':checks,'fixtureRuns':runs,'codec':'Pillow host adapter; Android BitmapFactory execution not covered','checks':'WebP decoded RGBA and size preserved; extension fallback/shared source; geometry/skin/material/BIN preservation; bounds and error cleanup'}))
