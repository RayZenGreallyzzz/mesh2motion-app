package com.rayzen.riganimationstudio.nativeengine;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;

final class NativeFiles {
    static final String ENGINE_SHA="de2c3c4f795441784a3a908a5988c583b85d008253514dc9c01d4831b4041963";
    static final long MAX_INPUT=100L*1024*1024,MAX_OUTPUT=128L*1024*1024;
    static String hash(File file)throws Exception{
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] data=new byte[65536];for(int n;(n=in.read(data))!=-1;)digest.update(data,0,n);}
        StringBuilder result=new StringBuilder();for(byte value:digest.digest())result.append(String.format(Locale.ROOT,"%02x",value&255));return result.toString();
    }
    static String read(File file,int limit)throws IOException{
        if(file.length()>limit)throw new IOException("JSON слишком большой");
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[32768];int total=0;for(int n;(n=in.read(b))!=-1;){total+=n;if(total>limit)throw new IOException("JSON слишком большой");out.write(b,0,n);}return new String(out.toByteArray(),"UTF-8");
        }
    }
    static void write(File file,JSONObject data)throws Exception{
        File temp=new File(file.getParentFile(),file.getName()+".tmp");try(OutputStream out=new FileOutputStream(temp)){out.write(data.toString().getBytes("UTF-8"));}
        if(!temp.renameTo(file))throw new IOException("Не удалось сохранить сессию");
    }
    static void validateGlb(File file,long limit)throws IOException{
        if(!file.isFile()||file.length()<20||file.length()>limit)throw new IOException("Некорректный размер GLB");
        try(DataInputStream in=new DataInputStream(new FileInputStream(file))){if(in.readInt()!=0x676c5446||Integer.reverseBytes(in.readInt())!=2||(Integer.reverseBytes(in.readInt())&0xffffffffL)!=file.length())throw new IOException("Нужен корректный GLB 2.0");}
    }
    static JSONObject session(File source,String id)throws Exception{
        JSONObject s=new JSONObject().put("id",id).put("formatVersion",1).put("solverVersion","0.5.29-variable-digit-topology").put("sourceSHA256",hash(source)).put("sourceFile","input/source.glb").put("revision",0);
        s.put("rigSpaceTransform",new JSONArray(Arrays.asList(-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)));
        for(String name:new String[]{"bodyLandmarks","leftHandLandmarks","rightHandLandmarks","bodyGuides","bodyGuideCentres","bodySurfaceAnchors","bodyJointOverrides","leftHandOverrides","rightHandOverrides","skinParameters","validationResults"})s.put(name,new JSONObject());
        s.put("lastSuccessfulStage","IMPORT").put("depthConfirmed",false).put("leftHandConfirmed",false).put("rightHandConfirmed",false).put("rigHands",false);
        for(String side:new String[]{"left","right"}){s.put(side+"HandDigits",new JSONArray(Arrays.asList("thumb","index","middle","ring","pinky")));s.put(side+"PalmNormal",new JSONArray(Arrays.asList(0,0,1)));}
        return s.put("absentChains",new JSONArray());
    }
    static void points(JSONObject points)throws Exception{
        if(points.length()>64)throw new IOException("Слишком много ориентиров");
        Iterator<String> keys=points.keys();while(keys.hasNext()){
            String name=keys.next();if(!name.matches("[a-z][a-z0-9_]{0,40}"))throw new IOException("Неверное имя ориентира");
            JSONArray point=points.getJSONArray(name);if(point.length()!=3)throw new IOException("Нужны координаты X, Y, Z");
            for(int i=0;i<3;i++){double v=point.getDouble(i);if(Double.isNaN(v)||Double.isInfinite(v)||Math.abs(v)>1000000)throw new IOException("Неверные координаты ориентира");}
        }
    }
    static void delete(File file){File[] children=file.listFiles();if(children!=null)for(File c:children)delete(c);file.delete();}
}
