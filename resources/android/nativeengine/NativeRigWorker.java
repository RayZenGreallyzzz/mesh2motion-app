package com.rayzen.riganimationstudio.nativeengine;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;
import dev.unicorn.rigger.android.RigNative;

/** Engine crashes and cancellation are isolated from the visible WebView. */
public final class NativeRigWorker extends Service {
    static final int RUN=1,CANCEL=2,PROGRESS=3,DONE=4,ERROR=5;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();private final AtomicBoolean busy=new AtomicBoolean(),cancelled=new AtomicBoolean();
    private final Messenger incoming=new Messenger(new Handler(Looper.getMainLooper()){
        @Override public void handleMessage(Message message){
            if(message.sendingUid!=android.os.Process.myUid())return;
            if(message.what==CANCEL){cancelled.set(true);try{RigNative.INSTANCE.cancel();}catch(Throwable ignored){}return;}
            if(message.what!=RUN)return;Bundle b=message.getData();Messenger reply=message.replyTo;String token=b.getString("token","");
            if(!busy.compareAndSet(false,true)){send(reply,ERROR,token,"Расчёт уже выполняется",0);return;}
            cancelled.set(false);send(reply,PROGRESS,token,"Запуск движка",0);executor.execute(()->run(b,reply));
        }
    });
    @Override public IBinder onBind(Intent intent){return incoming.getBinder();}
    static void send(Messenger reply,int what,String token,String value,int percent){
        Message m=Message.obtain(null,what);Bundle b=new Bundle();b.putString("token",token);b.putString("value",value);b.putInt("percent",percent);b.putInt("pid",android.os.Process.myPid());m.setData(b);try{reply.send(m);}catch(RemoteException ignored){}
    }
    private void run(Bundle request,Messenger reply){
        String token=request.getString("token","");File root=null;JSONObject receipt=new JSONObject();long start=SystemClock.elapsedRealtime();
        try{
            File candidate=new File(request.getString("root","")).getCanonicalFile();String allowed=new File(getCacheDir(),"native-rig").getCanonicalPath()+File.separator;
            if(!candidate.getPath().startsWith(allowed)||!candidate.getName().matches("[a-f0-9-]{36}"))throw new IOException("Неверная сессия");root=candidate;
            String command=request.getString("command","");
            if(!Arrays.asList("PREPARE","ANALYZE","INITIAL_BODY_GUIDES","PROPOSE_BODY","PREVIEW_BODY","BUILD_SKELETON","COMPUTE_WEIGHTS","EXPORT").contains(command))throw new IOException("Недоступная команда");
            File input=new File(root,"input/source.glb"),sessionFile=new File(root,"session.json"),output=new File(root,"output.glb"),report=new File(root,"native-report.json");
            if("PREPARE".equals(command)){
                File original=new File(root,"input/source-original.glb"),geometry=new File(root,"input/source-float.glb");NativeFiles.validateGlb(original,NativeFiles.MAX_INPUT);
                JSONObject prepared=new JSONObject().put("originalSha256",NativeFiles.hash(original));
                send(reply,PROGRESS,token,"Подготовка координат",0);prepared.put("geometryPreparation",GlbQuantization.prepare(original,geometry));
                try{send(reply,PROGRESS,token,"Подготовка текстур",0);prepared.put("texturePreparation",GlbWebpCompatibility.prepare(geometry,input,new AndroidWebpCodec()));}finally{geometry.delete();}
                NativeFiles.validateGlb(input,NativeFiles.MAX_OUTPUT);NativeFiles.write(sessionFile,NativeFiles.session(input,root.getName()));
                prepared.put("preparedSha256",NativeFiles.hash(input)).put("preparedBytes",input.length());NativeFiles.write(new File(root,"preparation.json"),prepared);
                receipt.put("status","DONE").put("command",command).put("preparation",prepared);return;
            }
            NativeFiles.validateGlb(input,384L*1024*1024);JSONObject session=new JSONObject(NativeFiles.read(sessionFile,1048576));
            String hash=NativeFiles.hash(input);if(!hash.equals(session.getString("sourceSHA256")))throw new IOException("Модель изменилась после подготовки");
            if(output.exists()&&!output.delete())throw new IOException("Не удалось очистить результат");if(report.exists())report.delete();
            receipt.put("command",command).put("revision",session.getInt("revision")).put("inputSha256Before",hash).put("nativeLibrarySha256",NativeFiles.ENGINE_SHA);
            RigNative nativeRig=RigNative.INSTANCE;if(cancelled.get())throw new InterruptedException("Отменено");nativeRig.prepare();if(cancelled.get())nativeRig.cancel();
            String returned=nativeRig.runSession(command,input.getPath(),output.getPath(),report.getPath(),sessionFile.getPath(),(stage,percent)->send(reply,PROGRESS,token,stage,percent));
            JSONObject result=new JSONObject(returned);receipt.put("nativeReturn",result);
            if(report.isFile()){JSONObject nativeReport=new JSONObject(NativeFiles.read(report,2097152));receipt.put("nativeReport",nativeReport);if("FAILED".equals(nativeReport.optString("status")))result=nativeReport;}
            receipt.put("status",cancelled.get()?"CANCELLED":result.optString("status","FAILED"));
            String after=NativeFiles.hash(input);receipt.put("inputSha256After",after).put("inputPreserved",hash.equals(after));
            if(!hash.equals(after))receipt.put("status","FAILED").put("error","Движок изменил входной файл");
            if("DONE".equals(receipt.optString("status"))&&output.isFile()){NativeFiles.validateGlb(output,NativeFiles.MAX_OUTPUT);receipt.put("outputBytes",output.length()).put("outputSha256",NativeFiles.hash(output));}
            else if(output.isFile())output.delete();
        }catch(Throwable error){try{receipt.put("status","FAILED").put("error",error.getClass().getSimpleName()+": "+error.getMessage());}catch(JSONException ignored){}}
        finally{
            try{receipt.put("elapsedMilliseconds",SystemClock.elapsedRealtime()-start);if(root==null)throw new IOException("Сессия недоступна");File file=new File(root,"receipt.json");NativeFiles.write(file,receipt);send(reply,DONE,token,file.getPath(),100);}
            catch(Throwable e){send(reply,ERROR,token,String.valueOf(e.getMessage()),0);}busy.set(false);
        }
    }
    @Override public void onDestroy(){cancelled.set(true);try{RigNative.INSTANCE.cancel();}catch(Throwable ignored){}executor.shutdownNow();super.onDestroy();}
}
