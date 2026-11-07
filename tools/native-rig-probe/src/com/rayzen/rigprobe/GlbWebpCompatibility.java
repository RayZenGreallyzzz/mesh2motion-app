package com.rayzen.rigprobe;

import java.io.*;
import java.util.*;
import org.json.*;

/** Replaces WebP images with embedded PNGs, preserving all existing binary data. */
public final class GlbWebpCompatibility {
    private static final String EXT="EXT_texture_webp";
    private static final int JSON=0x4e4f534a, BIN=0x004e4942;
    private static final long LIMIT=384L*1024*1024;
    public interface ImageCodec {
        /** Decode the full-size WebP to a PNG file; return width/height diagnostics. */
        JSONObject toPng(byte[] webp,File png)throws Exception;
    }
    private static final class Chunk {
        final int type,length;final long offset;
        Chunk(int t,int n,long p){type=t;length=n;offset=p;}
    }
    private static int le(RandomAccessFile f)throws IOException{return Integer.reverseBytes(f.readInt());}
    private static void le(DataOutputStream out,int n)throws IOException{out.writeInt(Integer.reverseBytes(n));}
    private static void transfer(RandomAccessFile in,OutputStream out,long start,long length)throws IOException{
        in.seek(start);byte[] b=new byte[65536];while(length>0){int n=in.read(b,0,(int)Math.min(b.length,length));if(n<0)throw new EOFException();out.write(b,0,n);length-=n;}
    }
    private static int index(JSONObject o,String key,int count)throws Exception{
        long n=o.getLong(key);if(n<0||n>=count)throw new IOException("Invalid "+key+" index");return(int)n;
    }
    private static boolean webp(JSONObject image){return "image/webp".equalsIgnoreCase(image.optString("mimeType"))||image.optString("uri").startsWith("data:image/webp;");}
    private static void remove(JSONObject doc,String key)throws Exception{
        JSONArray old=doc.optJSONArray(key);if(old==null)return;JSONArray next=new JSONArray();
        for(int i=0;i<old.length();i++)if(!EXT.equals(old.getString(i)))next.put(old.get(i));
        if(next.length()==0)doc.remove(key);else doc.put(key,next);
    }
    private static byte[] dataUri(String uri)throws IOException{
        String prefix="data:image/webp;base64,";if(!uri.startsWith(prefix))throw new IOException("Only embedded base64 WebP images are supported");
        if(uri.length()>64*1024*1024)throw new IOException("WebP data URI too large");
        ByteArrayOutputStream out=new ByteArrayOutputStream();int bits=0,value=0,padding=0,chars=0;
        for(int i=prefix.length();i<uri.length();i++){
            char c=uri.charAt(i);if(c==' '||c=='\r'||c=='\n'||c=='\t')continue;
            if(c=='='){padding++;if(padding>2)throw new IOException("Invalid base64 padding");continue;}
            if(padding>0)throw new IOException("Invalid base64 trailing data");
            int digit=c>='A'&&c<='Z'?c-'A':c>='a'&&c<='z'?c-'a'+26:c>='0'&&c<='9'?c-'0'+52:c=='+'?62:c=='/'?63:-1;
            if(digit<0)throw new IOException("Invalid base64 WebP");value=(value<<6)|digit;bits+=6;chars++;
            if(bits>=8){bits-=8;out.write((value>>bits)&255);}
        }
        if(chars%4==1||((chars+padding)%4!=0&&padding>0)||(bits>0&&(value&((1<<bits)-1))!=0))throw new IOException("Invalid base64 length");
        return out.toByteArray();
    }
    private static byte[] imageBytes(JSONObject image,JSONArray views,JSONObject buffer,Chunk bin,RandomAccessFile in)throws Exception{
        byte[] bytes;
        if(image.has("bufferView")){
            if(bin==null||buffer==null||buffer.has("uri"))throw new IOException("WebP image needs an embedded buffer");
            JSONObject v=views.getJSONObject(index(image,"bufferView",views.length()));
            if(v.optLong("buffer",0)!=0)throw new IOException("External image buffers are unsupported");
            long offset=v.optLong("byteOffset",0),length=v.getLong("byteLength"),total=buffer.getLong("byteLength");
            if(offset<0||length<12||length>64*1024*1024||total<0||total>bin.length||offset>total-length)throw new IOException("WebP image exceeds buffer bounds");
            bytes=new byte[(int)length];in.seek(bin.offset+offset);in.readFully(bytes);
        }else bytes=dataUri(image.getString("uri"));
        if(bytes.length<12||bytes[0]!='R'||bytes[1]!='I'||bytes[2]!='F'||bytes[3]!='F'||bytes[8]!='W'||bytes[9]!='E'||bytes[10]!='B'||bytes[11]!='P')throw new IOException("Invalid WebP image signature");
        return bytes;
    }
    public static JSONObject prepare(File source,File output,ImageCodec codec)throws Exception{
        if(source.getCanonicalFile().equals(output.getCanonicalFile()))throw new IOException("Source and output must differ");
        File extra=File.createTempFile("glb-pngs-",".bin",output.getAbsoluteFile().getParentFile());boolean complete=false;
        try(RandomAccessFile in=new RandomAccessFile(source,"r")){
            if(in.length()<20||in.length()>LIMIT||le(in)!=0x46546c67||le(in)!=2||(le(in)&0xffffffffL)!=in.length())throw new IOException("Invalid GLB 2.0 header");
            List<Chunk> chunks=new ArrayList<>();Chunk json=null,bin=null;
            while(in.getFilePointer()<in.length()){
                if(in.length()-in.getFilePointer()<8)throw new IOException("Truncated GLB chunk");long size=le(in)&0xffffffffL;int type=le(in);long offset=in.getFilePointer();
                if(size>Integer.MAX_VALUE||(size&3)!=0||size>in.length()-offset)throw new IOException("Invalid GLB chunk bounds");
                Chunk c=new Chunk(type,(int)size,offset);chunks.add(c);
                if(type==JSON){if(json!=null||chunks.size()!=1)throw new IOException("Invalid JSON chunk");json=c;}
                if(type==BIN){if(bin!=null)throw new IOException("Duplicate BIN chunk");bin=c;}
                in.seek(offset+size);
            }
            if(json==null||json.length>16*1024*1024)throw new IOException("Missing or oversized JSON");
            byte[] raw=new byte[json.length];in.seek(json.offset);in.readFully(raw);JSONObject doc=new JSONObject(new String(raw,"UTF-8"));
            JSONArray before=new JSONArray(doc.optJSONArray("extensionsUsed")==null?"[]":doc.getJSONArray("extensionsUsed").toString());
            JSONArray images=doc.optJSONArray("images"),textures=doc.optJSONArray("textures"),views=doc.optJSONArray("bufferViews"),buffers=doc.optJSONArray("buffers");
            if(images==null)images=new JSONArray();if(views==null){views=new JSONArray();doc.put("bufferViews",views);}
            TreeSet<Integer> convert=new TreeSet<>();
            for(int i=0;i<images.length();i++)if(webp(images.getJSONObject(i)))convert.add(i);
            if(textures!=null)for(int i=0;i<textures.length();i++){
                JSONObject t=textures.getJSONObject(i),extensions=t.optJSONObject("extensions"),webp=extensions==null?null:extensions.optJSONObject(EXT);
                if(webp!=null)convert.add(index(webp,"source",images.length()));
            }
            boolean declared=before.toString().contains("\""+EXT+"\"")||(doc.optJSONArray("extensionsRequired")!=null&&doc.getJSONArray("extensionsRequired").toString().contains("\""+EXT+"\""));
            JSONObject result=new JSONObject().put("converterVersion",1).put("extension",EXT).put("changed",false).put("extensionsBefore",before);
            if(convert.isEmpty()&&!declared){try(OutputStream out=new BufferedOutputStream(new FileOutputStream(output))){transfer(in,out,0,in.length());}complete=true;return result.put("convertedImages",0).put("extensionsAfter",before);}
            if(buffers==null){buffers=new JSONArray();doc.put("buffers",buffers);}
            JSONObject buffer=buffers.length()==0?null:buffers.getJSONObject(0);
            if(buffer!=null&&(buffer.has("uri")||bin==null||buffer.getLong("byteLength")>bin.length||buffer.getLong("byteLength")<bin.length-3L))throw new IOException("Invalid embedded buffer");
            long originalBin=bin==null?0:bin.length,added=0;JSONArray converted=new JSONArray();
            try(OutputStream appended=new BufferedOutputStream(new FileOutputStream(extra))){
                for(int imageIndex:convert){
                    if(Thread.currentThread().isInterrupted())throw new InterruptedIOException("Texture preparation interrupted");
                    JSONObject image=images.getJSONObject(imageIndex);byte[] webp=imageBytes(image,views,buffer,bin,in);
                    File png=File.createTempFile("glb-texture-",".png",output.getAbsoluteFile().getParentFile());
                    try{
                        JSONObject details=codec.toPng(webp,png);long length=png.length(),padded=(length+3)&~3L;
                        if(length<24||length>LIMIT||originalBin+added+padded>LIMIT)throw new IOException("Prepared textures exceed 384 MiB limit");
                        try(DataInputStream header=new DataInputStream(new FileInputStream(png))){
                            if(header.readLong()!=0x89504e470d0a1a0aL||header.readInt()!=13||header.readInt()!=0x49484452)throw new IOException("Texture codec did not produce PNG");
                            int width=header.readInt(),height=header.readInt();if(width<=0||height<=0)throw new IOException("Invalid PNG dimensions");
                            details.put("width",width).put("height",height);
                        }
                        JSONObject view=new JSONObject().put("buffer",0).put("byteOffset",originalBin+added).put("byteLength",length);
                        int newView=views.length();views.put(view);image.remove("uri");image.put("bufferView",newView).put("mimeType","image/png");
                        try(RandomAccessFile encoded=new RandomAccessFile(png,"r")){transfer(encoded,appended,0,length);}for(long p=length;p<padded;p++)appended.write(0);
                        converted.put(details.put("imageIndex",imageIndex).put("webpBytes",webp.length).put("pngBytes",length));added+=padded;
                    }finally{png.delete();}
                }
            }
            if(textures!=null)for(int i=0;i<textures.length();i++){
                JSONObject t=textures.getJSONObject(i),ex=t.optJSONObject("extensions");if(ex==null||!ex.has(EXT))continue;
                t.put("source",index(ex.getJSONObject(EXT),"source",images.length()));ex.remove(EXT);if(ex.length()==0)t.remove("extensions");
            }
            remove(doc,"extensionsUsed");remove(doc,"extensionsRequired");
            if(buffer==null&&added>0){buffer=new JSONObject();buffers.put(buffer);}if(buffer!=null)buffer.put("byteLength",originalBin+added);
            byte[] next=doc.toString().getBytes("UTF-8");int jsonPad=(-next.length)&3;
            long total=in.length()-json.length+next.length+jsonPad+added+(bin==null&&added>0?8:0);if(total>LIMIT)throw new IOException("Prepared GLB exceeds 384 MiB limit");
            try(DataOutputStream out=new DataOutputStream(new BufferedOutputStream(new FileOutputStream(output)))){
                le(out,0x46546c67);le(out,2);le(out,(int)total);
                for(Chunk c:chunks){
                    if(c==json){le(out,next.length+jsonPad);le(out,JSON);out.write(next);for(int p=0;p<jsonPad;p++)out.write(32);
                        if(bin==null&&added>0){le(out,(int)added);le(out,BIN);try(RandomAccessFile encoded=new RandomAccessFile(extra,"r")){transfer(encoded,out,0,added);}}}
                    else {le(out,c.length+(c==bin?(int)added:0));le(out,c.type);transfer(in,out,c.offset,c.length);
                        if(c==bin)try(RandomAccessFile encoded=new RandomAccessFile(extra,"r")){transfer(encoded,out,0,added);}}
                }
            }
            complete=true;return result.put("changed",true).put("convertedImages",convert.size()).put("images",converted).put("addedBinaryBytes",added)
                .put("originalBinaryPrefixPreserved",true).put("geometryAndSkinPreserved",true).put("extensionsAfter",doc.optJSONArray("extensionsUsed")==null?new JSONArray():doc.getJSONArray("extensionsUsed"));
        }finally{extra.delete();if(!complete)output.delete();}
    }
}
