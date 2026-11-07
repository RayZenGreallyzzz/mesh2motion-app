"""Independent binary/geometry regression tests; fixtures contain no private assets."""
import copy,json,math,pathlib,struct,subprocess,sys,tempfile

JAVA=sys.argv[1:]
EXT='KHR_mesh_quantization'
checks=0
def check(ok,message):
    global checks
    if not ok:raise AssertionError(message)
    checks+=1
def pack(g,b):
    g=copy.deepcopy(g);g['buffers']=[{'byteLength':len(b)}]
    j=json.dumps(g,separators=(',',':')).encode();j+=b' '*(-len(j)%4);b+=b'\0'*(-len(b)%4)
    return struct.pack('<III',0x46546c67,2,28+len(j)+len(b))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(b),0x004e4942)+b
def unpack(raw):
    check(struct.unpack_from('<III',raw)==(0x46546c67,2,len(raw)),'GLB header/length')
    n,t=struct.unpack_from('<II',raw,12);check(t==0x4e4f534a,'JSON first')
    g=json.loads(raw[20:20+n]);size,kind=struct.unpack_from('<II',raw,20+n)
    check(kind==0x004e4942 and 28+n+size==len(raw),'BIN length')
    return g,raw[28+n:]
def floats(g,b,index):
    a=g['accessors'][index];check(a['componentType']==5126 and not a.get('normalized') and 'sparse' not in a,'expanded float accessor')
    v=g['bufferViews'][a['bufferView']];k=int(a['type'][3:]);offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<'+'f'*k,b,offset+i*v.get('byteStride',4*k)) for i in range(a['count'])]
def close(actual,expected):
    check(len(actual)==len(expected),'vertex count')
    for x,y in zip(actual,expected):
        for u,v in zip(x,y):check(abs(u-v)<1e-7*max(1,abs(v)),'decoded geometry differs')
def base():return {'asset':{'version':'2.0'},'extensionsUsed':[EXT,'KHR_texture_transform'],'extensionsRequired':[EXT],
    'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'translation':[1.25,-2.5,4.0],'rotation':[0,0,math.sqrt(.5),math.sqrt(.5)],'scale':[.001,.001,.001]}],
    'meshes':[{'primitives':[{'attributes':{}}]}],'accessors':[],'bufferViews':[]}
def add(g,b,raw,typ,shape,count,normalized=False,stride=None,offset=0):
    start=len(b);b.extend(raw);b.extend(b'\0'*(-len(b)%4));view={'buffer':0,'byteOffset':start,'byteLength':len(raw)}
    if stride is not None:view['byteStride']=stride
    vi=len(g['bufferViews']);g['bufferViews'].append(view)
    a={'bufferView':vi,'byteOffset':offset,'componentType':typ,'type':shape,'count':count}
    if normalized:a['normalized']=True
    ai=len(g['accessors']);g['accessors'].append(a);return ai
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory)
    def run(g,b,label,fail=None):
        original=pack(g,bytes(b));src=root/(label+'.glb');out=root/(label+'-out.glb');src.write_bytes(original)
        p=subprocess.run(JAVA+[str(src),str(out)],capture_output=True,text=True)
        check(src.read_bytes()==original,'original overwritten')
        if fail:
            check(p.returncode!=0 and fail in p.stderr,'expected safe failure: '+fail+'; '+p.stderr)
            check(not out.exists(),'partial output retained');return
        check(p.returncode==0,'conversion failed: '+p.stderr)
        report=json.loads(p.stdout);og,ob=unpack(out.read_bytes());_,ib=unpack(original)
        check(ob[:len(ib)]==ib,'original image/skin/animation binary prefix modified')
        for key in ['nodes','scenes','scene','skins','animations','materials','images','textures']:
            check(og.get(key)==g.get(key),'changed '+key)
        return og,ob,report,original,out.read_bytes()

    # Interleaved ushort positions + normalized signed normals + normalized UV.
    g=base();b=bytearray();pos=[(0,1000,65000),(65535,42,1),(2000,3000,4000)];norm=[(-128,0,127),(0,-127,0),(64,64,64)];uv=[(0,65535),(32768,16384),(65535,0)]
    # Use a valid 16-byte stride, non-zero accessor offsets, and unused padding.
    inter=b''.join(struct.pack('<3H2x3bx2H',*p,*n,*u) for p,n,u in zip(pos,norm,uv))
    pi=add(g,b,inter,5123,'VEC3',3,stride=16)
    g['accessors'].extend([{'bufferView':0,'byteOffset':8,'componentType':5120,'type':'VEC3','count':3,'normalized':True},
                           {'bufferView':0,'byteOffset':12,'componentType':5123,'type':'VEC2','count':3,'normalized':True}])
    attrs=g['meshes'][0]['primitives'][0]['attributes'];attrs.update(POSITION=pi,NORMAL=1,TEXCOORD_0=2)
    # Shared geometry must not be duplicated again; mesh indices remain integer.
    ii=add(g,b,struct.pack('<3H',0,1,2),5123,'SCALAR',3);g['meshes'][0]['primitives'][0]['indices']=ii
    wi=add(g,b,bytes([255,0,0,0]*3),5121,'VEC4',3,True);ji=add(g,b,bytes([0,0,0,0]*3),5121,'VEC4',3)
    attrs.update(WEIGHTS_0=wi,JOINTS_0=ji);g['meshes'][0]['primitives'].append(copy.deepcopy(g['meshes'][0]['primitives'][0]))
    g['materials']=[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0,'extensions':{'KHR_texture_transform':{'offset':[.25,.5],'scale':[16,16]}}}}}]
    # Valid 1x1 PNG and identity inverse bind, plus a real two-key animation.
    import base64
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6uoAAAAASUVORK5CYII=')
    image_view=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(b),'byteLength':len(png)});b.extend(png);b.extend(b'\0'*(-len(b)%4))
    g['images']=[{'bufferView':image_view,'mimeType':'image/png'}];g['textures']=[{'source':0}]
    ibm=add(g,b,struct.pack('<16f',*[1 if i%5==0 else 0 for i in range(16)]),5126,'MAT4',1)
    g['nodes'].append({});g['skins']=[{'joints':[1],'inverseBindMatrices':ibm}];g['nodes'][0]['skin']=0
    ti=add(g,b,struct.pack('<2f',0,1),5126,'SCALAR',2);vi=add(g,b,struct.pack('<6f',0,0,0,1,2,3),5126,'VEC3',2)
    g['animations']=[{'samplers':[{'input':ti,'output':vi}],'channels':[{'sampler':0,'target':{'node':1,'path':'translation'}}]}]
    og,ob,r,_,_=run(g,b,'interleaved');oa=og['meshes'][0]['primitives'][0]['attributes']
    close(floats(og,ob,oa['POSITION']),pos);close(floats(og,ob,oa['NORMAL']),[[-1,0,1],[0,-1,0],[64/127]*3]);close(floats(og,ob,oa['TEXCOORD_0']),[[0,1],[32768/65535,16384/65535],[1,0]])
    check(oa==og['meshes'][0]['primitives'][1]['attributes'],'shared accessor remapping')
    check(r['convertedAccessors']==3 and r['convertedAttributeReferences']==6,'deduplicated float storage')
    check(oa['JOINTS_0']==ji and oa['WEIGHTS_0']==wi and og['meshes'][0]['primitives'][0]['indices']==ii,'index and skin channels untouched')
    check(EXT not in og.get('extensionsRequired',[]) and og['extensionsUsed']==['KHR_texture_transform'],'remove only quantization extension')
    # Independent known world transform: rotate 90deg about Z, scale .001, translate.
    world=[(1.25-y*.001,-2.5+x*.001,4+z*.001) for x,y,z in floats(og,ob,oa['POSITION'])]
    close(world,[(.25,-2.5,69),(1.208,63.035,4.001),(-1.75,-.5,8)])

    # Sparse position without a base view; signed-short normalized endpoint clamp.
    s=base();sb=bytearray();ix=add(s,sb,bytes([1,2]),5121,'SCALAR',2);values=add(s,sb,struct.pack('<6h',-32768,0,32767,16384,-16384,1),5122,'VEC3',2)
    sparse={'componentType':5122,'normalized':True,'type':'VEC3','count':3,'sparse':{'count':2,'indices':{'bufferView':ix,'componentType':5121},'values':{'bufferView':values}}}
    s['accessors'].append(sparse);s['meshes'][0]['primitives'][0]['attributes']['POSITION']=2
    og,ob,_,_,_=run(s,sb,'sparse-zero-base');close(floats(og,ob,og['meshes'][0]['primitives'][0]['attributes']['POSITION']),[(0,0,0),(-1,0,1),(16384/32767,-16384/32767,1/32767)])
    # Sparse over a real base and signed morph delta (must never acquire a translation).
    m=base();mb=bytearray();mp=add(m,mb,b''.join(struct.pack('<3h2x',*range(i,i+3)) for i in (0,3,6)),5122,'VEC3',3,stride=8)
    delta=add(m,mb,bytes([128,0,127,0]*3),5120,'VEC3',3,True,stride=4)
    m['meshes'][0]['primitives'][0].update(attributes={'POSITION':mp},targets=[{'POSITION':delta}])
    og,ob,_,_,_=run(m,mb,'morph');close(floats(og,ob,og['meshes'][0]['primitives'][0]['targets'][0]['POSITION']),[(-1,0,1)]*3)
    # Sparse with a base, and 16/32-bit index widths.
    for ct,fmt in [(5123,'H'),(5125,'I')]:
        q=copy.deepcopy(m);qb=bytearray(mb);qi=add(q,qb,struct.pack('<'+fmt,1),ct,'SCALAR',1);qv=add(q,qb,struct.pack('<3h',100,200,300),5122,'VEC3',1)
        q['accessors'][mp]['sparse']={'count':1,'indices':{'bufferView':q['accessors'][qi]['bufferView'],'componentType':ct},'values':{'bufferView':q['accessors'][qv]['bufferView']}}
        og,ob,_,_,_=run(q,qb,'sparse-base-'+str(ct));close(floats(og,ob,og['meshes'][0]['primitives'][0]['attributes']['POSITION']),[(0,1,2),(100,200,300),(6,7,8)])
    # Every allowed integer position component, normalized and unnormalized.
    for ct,fmt,nums,den in [(5120,'b',[-128,0,127],127),(5121,'B',[0,128,255],255),(5122,'h',[-32768,1,32767],32767),(5123,'H',[0,32768,65535],65535)]:
        for normalized in (False,True):
            q=base();qb=bytearray();a=add(q,qb,struct.pack('<3'+fmt,*nums),ct,'VEC3',1,normalized);q['meshes'][0]['primitives'][0]['attributes']={'POSITION':a}
            og,ob,_,_,_=run(q,qb,'component-'+str(ct)+'-'+str(normalized));expected=[max(-1,n/den) if normalized else n for n in nums]
            close(floats(og,ob,og['meshes'][0]['primitives'][0]['attributes']['POSITION']),[expected])
    f=base();f.pop('extensionsUsed');f.pop('extensionsRequired');fb=bytearray();a=add(f,fb,struct.pack('<3f',.1,.2,.3),5126,'VEC3',1);f['meshes'][0]['primitives'][0]['attributes']['POSITION']=a
    _,_,r,original,output=run(f,fb,'float-exact');check(original==output and not r['changed'],'float-only source must be byte-exact')
    bad=copy.deepcopy(m);bad['accessors'][0]['count']=1000000;run(bad,mb,'bad-bounds','bounds')
    bad=copy.deepcopy(m);bad['bufferViews'][0]['extensions']={'EXT_meshopt_compression':{}};run(bad,mb,'meshopt','Meshopt')
    bad=copy.deepcopy(m);bad['meshes'][0]['primitives'][0]['extensions']={'KHR_draco_mesh_compression':{}};run(bad,mb,'draco','Draco')
    bad=copy.deepcopy(s);badbytes=bytearray(sb);badbytes[0]=2;badbytes[1]=1;run(bad,badbytes,'sparse-unsorted','strictly increasing')
    print(json.dumps({'status':'passed','assertions':checks,'fixtureRuns':18,'checks':'decoded local/world geometry; sparse; morphs; skin/index/image/animation preservation; failure cleanup; exact passthrough'}))

