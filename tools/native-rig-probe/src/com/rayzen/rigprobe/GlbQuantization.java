package com.rayzen.rigprobe;

import java.io.*;
import java.nio.*;
import java.nio.channels.FileChannel;
import java.util.*;
import org.json.*;

/** Lossless-to-float expansion of KHR_mesh_quantization; never edits the source. */
public final class GlbQuantization {
    private static final String EXT="KHR_mesh_quantization";
    private static final int JSON=0x4e4f534a, BIN=0x004e4942;
    private static final long LIMIT=384L*1024*1024;
    private static final class Chunk {
        final int type,length; final long offset;
        Chunk(int t,int n,long p){type=t;length=n;offset=p;}
    }
    private static int le(RandomAccessFile f)throws IOException{return Integer.reverseBytes(f.readInt());}
    private static void le(DataOutputStream out,int v)throws IOException{out.writeInt(Integer.reverseBytes(v));}
    private static int nonnegative(JSONObject j,String key,int fallback)throws Exception{
        long v=j.has(key)?j.getLong(key):fallback;
        if(v<0||v>Integer.MAX_VALUE)throw new IOException("Invalid GLB "+key);
        return (int)v;
    }
    private static boolean includes(JSONArray a,String name){
        if(a!=null)for(int i=0;i<a.length();i++)if(name.equals(a.optString(i)))return true;
        return false;
    }
    private static void removeExtension(JSONObject j,String key)throws Exception{
        JSONArray old=j.optJSONArray(key);if(old==null)return;JSONArray next=new JSONArray();
        for(int i=0;i<old.length();i++)if(!EXT.equals(old.getString(i)))next.put(old.getString(i));
        if(next.length()==0)j.remove(key);else j.put(key,next);
    }
    private static void transfer(RandomAccessFile in,OutputStream out,long offset,long bytes)throws IOException{
        in.seek(offset);byte[] b=new byte[65536];
        while(bytes>0){int n=in.read(b,0,(int)Math.min(b.length,bytes));if(n<0)throw new EOFException();out.write(b,0,n);bytes-=n;}
    }
    private static void interrupted()throws IOException{
        if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("GLB preparation interrupted");
    }
    public static JSONObject prepare(File source,File output)throws Exception{
        if(source.getCanonicalFile().equals(output.getCanonicalFile()))throw new IOException("Source and output must differ");
        File extra=File.createTempFile("glb-floats-",".bin",output.getAbsoluteFile().getParentFile());
        boolean complete=false;
        try(RandomAccessFile file=new RandomAccessFile(source,"r")){
            if(file.length()<20||file.length()>LIMIT||le(file)!=0x46546c67||le(file)!=2||(le(file)&0xffffffffL)!=file.length())throw new IOException("Invalid GLB 2.0 header");
            List<Chunk> chunks=new ArrayList<>();Chunk json=null,bin=null;
            while(file.getFilePointer()<file.length()){
                if(file.length()-file.getFilePointer()<8)throw new IOException("Truncated GLB chunk");
                long n=le(file)&0xffffffffL;int type=le(file);long start=file.getFilePointer();
                if(n>Integer.MAX_VALUE||(n&3)!=0||n>file.length()-start)throw new IOException("Invalid GLB chunk length");
                Chunk c=new Chunk(type,(int)n,start);chunks.add(c);
                if(type==JSON){if(json!=null||chunks.size()!=1)throw new IOException("Invalid JSON chunk order");json=c;}
                if(type==BIN){if(bin!=null)throw new IOException("Duplicate BIN chunk");bin=c;}
                file.seek(start+n);
            }
            if(json==null||json.length>16*1024*1024)throw new IOException("Missing or oversized GLB JSON");
            byte[] raw=new byte[json.length];file.seek(json.offset);file.readFully(raw);
            JSONObject doc=new JSONObject(new String(raw,"UTF-8"));
            JSONObject result=new JSONObject().put("converterVersion",1).put("extension",EXT).put("changed",false);
            if(!includes(doc.optJSONArray("extensionsUsed"),EXT)&&!includes(doc.optJSONArray("extensionsRequired"),EXT)){
                try(OutputStream out=new BufferedOutputStream(new FileOutputStream(output))){transfer(file,out,0,file.length());}
                complete=true;return result.put("convertedAccessors",0).put("addedBinaryBytes",0);
            }
            if(bin==null)throw new IOException("Quantized GLB has no embedded BIN");
            JSONArray buffers=doc.getJSONArray("buffers");JSONObject buffer=buffers.getJSONObject(0);
            int bufferLength=nonnegative(buffer,"byteLength",0);
            if(buffer.has("uri")||bufferLength>bin.length||bin.length-bufferLength>3)throw new IOException("Invalid embedded GLB buffer");
            JSONArray views=doc.optJSONArray("bufferViews");if(views==null){views=new JSONArray();doc.put("bufferViews",views);}
            // Compressed storage requires a real decoder; never reinterpret its bytes.
            for(int i=0;i<views.length();i++){
                JSONObject ex=views.getJSONObject(i).optJSONObject("extensions");
                if(ex!=null&&(ex.has("EXT_meshopt_compression")||ex.has("KHR_meshopt_compression")))throw new IOException("Meshopt decompression is required before quantization conversion");
            }
            ByteBuffer bytes=file.getChannel().map(FileChannel.MapMode.READ_ONLY,bin.offset,bin.length).order(ByteOrder.LITTLE_ENDIAN);
            JSONArray accessors=doc.getJSONArray("accessors");
            Converter converter;
            try(DataOutputStream floats=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(extra)))){
                converter=new Converter(accessors,views,bytes,bufferLength,bin.length,floats);
                JSONArray meshes=doc.optJSONArray("meshes");
                if(meshes!=null)for(int m=0;m<meshes.length();m++){
                    JSONArray primitives=meshes.getJSONObject(m).getJSONArray("primitives");
                    for(int p=0;p<primitives.length();p++){
                        JSONObject primitive=primitives.getJSONObject(p),ex=primitive.optJSONObject("extensions");
                        if(ex!=null&&ex.has("KHR_draco_mesh_compression"))throw new IOException("Draco decompression is required before quantization conversion");
                        converter.attributes(primitive.getJSONObject("attributes"));
                        JSONArray targets=primitive.optJSONArray("targets");
                        if(targets!=null)for(int t=0;t<targets.length();t++)converter.attributes(targets.getJSONObject(t));
                    }
                }
            }
            removeExtension(doc,"extensionsUsed");removeExtension(doc,"extensionsRequired");
            // Keep original binary (including image, skin and animation data) byte-for-byte.
            buffer.put("byteLength",bin.length+converter.appended);
            byte[] newJson=doc.toString().getBytes("UTF-8");int jsonPadding=(4-newJson.length%4)%4;
            long total=file.length()-json.length+newJson.length+jsonPadding+converter.appended;
            if(total>LIMIT)throw new IOException("Prepared GLB exceeds 384 MiB limit");
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(output)))){
                le(out,0x46546c67);le(out,2);le(out,(int)total);
                for(Chunk c:chunks){
                    if(c==json){le(out,newJson.length+jsonPadding);le(out,JSON);out.write(newJson);for(int k=0;k<jsonPadding;k++)out.writeByte(32);}
                    else if(c==bin){le(out,(int)(bin.length+converter.appended));le(out,BIN);transfer(file,out,bin.offset,bin.length);
                        try(InputStream added=new FileInputStream(extra)){byte[] b=new byte[65536];for(int n;(n=added.read(b))!=-1;)out.write(b,0,n);}}
                    else {le(out,c.length);le(out,c.type);transfer(file,out,c.offset,c.length);}
                }
            }
            complete=true;
            return result.put("changed",true).put("convertedAccessors",converter.cache.size()).put("convertedAttributeReferences",converter.references)
                .put("addedBinaryBytes",converter.appended).put("maxFloat32RoundingError",converter.maxError)
                .put("originalBinaryPrefixPreserved",true).put("nodeTransformsPreserved",true).put("textureTransformsPreserved",true);
        } finally {extra.delete();if(!complete)output.delete();}
    }
    private static final class Layout {
        final int start,stride;
        Layout(int p,int s){start=p;stride=s;}
    }
    private static final class Converter {
        final JSONArray accessors,views;final ByteBuffer bin;final int originalLength,appendStart;final DataOutputStream out;
        final Map<Integer,Integer> cache=new HashMap<>();long appended=0;int references=0;double maxError=0;
        Converter(JSONArray a,JSONArray v,ByteBuffer b,int length,int start,DataOutputStream o){accessors=a;views=v;bin=b;originalLength=length;appendStart=start;out=o;}
        Layout layout(int view,int offset,int element,int count,boolean tightlyPacked)throws Exception{
            JSONObject v=views.getJSONObject(view);
            if(nonnegative(v,"buffer",0)!=0)throw new IOException("External geometry buffer is unsupported");
            int start=nonnegative(v,"byteOffset",0),length=nonnegative(v,"byteLength",0),stride=nonnegative(v,"byteStride",element);
            if(stride<element||(tightlyPacked&&stride!=element))throw new IOException("Invalid accessor stride");
            long needed=count==0?offset:(long)offset+(long)(count-1)*stride+element;
            if(start>(long)originalLength-length||needed>length||offset>length)throw new IOException("Accessor exceeds original buffer bounds");
            return new Layout(start+offset,stride);
        }
        void attributes(JSONObject attributes)throws Exception{
            Iterator<String> it=attributes.keys();List<String> keys=new ArrayList<>();while(it.hasNext())keys.add(it.next());
            for(String semantic:keys){
                // Integer joints and legal normalized color/weight accessors remain untouched.
                if(!semantic.equals("POSITION")&&!semantic.equals("NORMAL")&&!semantic.equals("TANGENT")&&!semantic.startsWith("TEXCOORD_"))continue;
                int index=attributes.getInt(semantic),component=accessors.getJSONObject(index).getInt("componentType");
                if(component==5126)continue;
                if(component!=5120&&component!=5121&&component!=5122&&component!=5123)throw new IOException("Unsupported quantized component: "+component);
                Integer next=cache.get(index);if(next==null){next=convert(index);cache.put(index,next);}
                attributes.put(semantic,next);references++;
            }
        }
        int convert(int index)throws Exception{
            JSONObject a=accessors.getJSONObject(index);int count=nonnegative(a,"count",0),type=a.getInt("componentType");
            String shape=a.getString("type");int components;
            if("VEC2".equals(shape))components=2;else if("VEC3".equals(shape))components=3;else if("VEC4".equals(shape))components=4;else throw new IOException("Invalid geometry accessor type: "+shape);
            int width=(type==5120||type==5121)?1:2,element=components*width;
            long size=(long)count*components*4;if(count==0||size>LIMIT-appendStart-appended)throw new IOException("Invalid or oversized geometry accessor");
            Layout base=a.has("bufferView")?layout(a.getInt("bufferView"),nonnegative(a,"byteOffset",0),element,count,false):null;
            boolean normalized=a.optBoolean("normalized",false);
            JSONObject sparse=a.optJSONObject("sparse");int sparseCount=0,sparseWidth=0,sparseType=0,nextSparse=-1,sparseCursor=0;Layout indices=null,values=null;
            if(sparse!=null){
                sparseCount=nonnegative(sparse,"count",0);if(sparseCount>count)throw new IOException("Invalid sparse accessor count");
                JSONObject si=sparse.getJSONObject("indices"),sv=sparse.getJSONObject("values");sparseType=si.getInt("componentType");
                if(sparseType==5121)sparseWidth=1;else if(sparseType==5123)sparseWidth=2;else if(sparseType==5125)sparseWidth=4;else throw new IOException("Invalid sparse index type");
                indices=layout(si.getInt("bufferView"),nonnegative(si,"byteOffset",0),sparseWidth,sparseCount,true);
                values=layout(sv.getInt("bufferView"),nonnegative(sv,"byteOffset",0),element,sparseCount,true);
                if(sparseCount>0)nextSparse=sparseIndex(indices.start,sparseType,count);
            }
            long offset=appendStart+appended;double[] min=new double[components],max=new double[components];Arrays.fill(min,Double.POSITIVE_INFINITY);Arrays.fill(max,Double.NEGATIVE_INFINITY);
            for(int i=0;i<count;i++){
                if((i&4095)==0)interrupted();
                boolean override=i==nextSparse;int start=override?values.start+sparseCursor*values.stride:base==null?-1:base.start+i*base.stride;
                for(int c=0;c<components;c++){
                    double d=start<0?0:scalar(start+c*width,type,normalized);float f=(float)d;le(out,Float.floatToIntBits(f));
                    min[c]=Math.min(min[c],f);max[c]=Math.max(max[c],f);maxError=Math.max(maxError,Math.abs(d-f));
                }
                if(override){sparseCursor++;if(sparseCursor<sparseCount){nextSparse=sparseIndex(indices.start+sparseCursor*indices.stride,sparseType,count);if(nextSparse<=i)throw new IOException("Sparse indices must be strictly increasing");}else nextSparse=-1;}
            }
            if(sparseCursor!=sparseCount)throw new IOException("Unconsumed sparse values");
            JSONObject view=new JSONObject().put("buffer",0).put("byteOffset",offset).put("byteLength",size).put("target",34962);
            int viewIndex=views.length();views.put(view);
            JSONObject expanded=new JSONObject(a.toString());expanded.remove("sparse");expanded.remove("normalized");expanded.remove("byteOffset");
            expanded.put("bufferView",viewIndex).put("componentType",5126).put("min",new JSONArray(min)).put("max",new JSONArray(max));
            int newIndex=accessors.length();accessors.put(expanded);appended+=size;return newIndex;
        }
        int sparseIndex(int offset,int type,int count)throws IOException{
            long n=type==5121?(bin.get(offset)&255):type==5123?(bin.getShort(offset)&65535):(bin.getInt(offset)&0xffffffffL);
            if(n>=count)throw new IOException("Sparse index exceeds accessor count");return(int)n;
        }
        double scalar(int offset,int type,boolean normalized){
            int n=type==5120?bin.get(offset):type==5121?(bin.get(offset)&255):type==5122?bin.getShort(offset):(bin.getShort(offset)&65535);
            if(!normalized)return n;
            if(type==5120)return Math.max(-1.0,n/127.0);if(type==5121)return n/255.0;
            if(type==5122)return Math.max(-1.0,n/32767.0);return n/65535.0;
        }
    }
}
