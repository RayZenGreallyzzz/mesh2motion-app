package com.rayzen.rigprobe;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import java.io.*;
import org.json.JSONObject;

/** Uses Android's full-size WebP decoder; never scales or recompresses as JPEG. */
public final class AndroidWebpCodec implements GlbWebpCompatibility.ImageCodec {
    @Override public JSONObject toPng(byte[] source,File output)throws Exception{
        BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeByteArray(source,0,source.length,bounds);
        long pixels=(long)bounds.outWidth*bounds.outHeight;
        long budget=Math.min(288L*1024*1024,Runtime.getRuntime().maxMemory()/2);
        if(bounds.outWidth<=0||bounds.outHeight<=0||pixels>8192L*8192||pixels*4>budget)throw new IOException("Недостаточно памяти для текстуры без уменьшения: "+bounds.outWidth+"×"+bounds.outHeight);
        BitmapFactory.Options options=new BitmapFactory.Options();options.inScaled=false;options.inPremultiplied=false;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        Bitmap bitmap=BitmapFactory.decodeByteArray(source,0,source.length,options);
        if(bitmap==null)throw new IOException("Android не смог прочитать WebP");
        try{
            if(bitmap.getWidth()!=bounds.outWidth||bitmap.getHeight()!=bounds.outHeight)throw new IOException("Размер текстуры изменился при декодировании");
            try(OutputStream out=new BufferedOutputStream(new FileOutputStream(output))){if(!bitmap.compress(Bitmap.CompressFormat.PNG,100,out))throw new IOException("Не удалось сохранить PNG");}
            return new JSONObject().put("decoder","Android BitmapFactory").put("width",bitmap.getWidth()).put("height",bitmap.getHeight()).put("hasAlpha",bitmap.hasAlpha()).put("resized",false);
        }finally{bitmap.recycle();}
    }
}
