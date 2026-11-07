package com.rayzen.rigprobe;

import android.app.Service;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.*;
import dev.unicorn.rigger.android.RigNative;

/** A native failure affects only this service's private process. */
public final class ProbeService extends Service {
    public static final int RUN=1, CANCEL=2, PROGRESS=3, DONE=4, ERROR=5;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(), cancelled = new AtomicBoolean();
    private final Handler handler = new Handler(Looper.getMainLooper()) {
        @Override public void handleMessage(Message message) {
            if (message.sendingUid != android.os.Process.myUid()) return;
            if (message.what == CANCEL) {
                cancelled.set(true);
                try { RigNative.INSTANCE.cancel(); } catch (Throwable ignored) { }
            } else if (message.what == RUN) {
                final Bundle request = message.getData(); final Messenger reply = message.replyTo;
                if (!busy.compareAndSet(false,true)) { send(reply,ERROR,request.getString("token",""),"message","Расчёт уже выполняется"); return; }
                cancelled.set(false);
                send(reply,PROGRESS,request.getString("token",""),"stage","STARTING");
                executor.execute(() -> execute(request,reply));
            }
        }
    };
    private final Messenger incoming = new Messenger(handler);
    @Override public IBinder onBind(Intent intent) { return incoming.getBinder(); }
    @Override public void onDestroy() {
        cancelled.set(true);
        try { RigNative.INSTANCE.cancel(); } catch (Throwable ignored) { }
        executor.shutdownNow(); super.onDestroy();
    }
    private static void send(Messenger reply,int type,String token,String key,String value) {
        if (reply == null) return;
        Message m=Message.obtain(null,type); Bundle b=new Bundle(); b.putString(key,value); b.putString("token",token);b.putInt("pid",android.os.Process.myPid());m.setData(b);
        try { reply.send(m); } catch(RemoteException ignored) { }
    }
    private File ownFile(String name) throws IOException {
        File p=new File(name).getCanonicalFile();String root=getFilesDir().getCanonicalPath()+File.separator;
        if (!p.getPath().startsWith(root)) throw new IOException("Путь вне рабочей папки приложения");
        return p;
    }
    public static String hash(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] data=new byte[32768];for(int n;(n=in.read(data))!=-1;)digest.update(data,0,n);}
        StringBuilder out=new StringBuilder();for(byte b:digest.digest())out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();
    }
    public static void copy(InputStream in,OutputStream out,long limit) throws IOException {
        byte[] data=new byte[32768];long total=0;for(int n;(n=in.read(data))!=-1;){total+=n;if(total>limit)throw new IOException("Файл превышает допустимый размер");out.write(data,0,n);}
    }
    public static String read(File file,int limit) throws IOException {
        try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){copy(in,out,limit);return new String(out.toByteArray(),"UTF-8");}
    }
    public static void write(File file,String value) throws IOException {
        try(OutputStream out=new FileOutputStream(file)){out.write(value.getBytes("UTF-8"));}
    }
    private JSONObject session(File input) throws Exception {
        JSONObject s=new JSONObject();
        s.put("id",UUID.randomUUID().toString());s.put("formatVersion",1);s.put("solverVersion","0.5.29-variable-digit-topology");
        s.put("sourceSHA256",hash(input));s.put("sourceFile","input/source.glb");s.put("revision",0);
        s.put("rigSpaceTransform",new JSONArray(Arrays.asList(-1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)));
        for(String key:new String[]{"bodyLandmarks","leftHandLandmarks","rightHandLandmarks","bodyGuides","bodyGuideCentres","bodySurfaceAnchors","bodyJointOverrides","leftHandOverrides","rightHandOverrides","skinParameters","validationResults"})s.put(key,new JSONObject());
        s.put("lastSuccessfulStage","IMPORT");s.put("depthConfirmed",false);s.put("leftHandConfirmed",false);s.put("rightHandConfirmed",false);s.put("rigHands",false);
        s.put("leftHandDigits",new JSONArray(Arrays.asList("thumb","index","middle","ring","pinky")));s.put("rightHandDigits",new JSONArray(Arrays.asList("thumb","index","middle","ring","pinky")));
        s.put("leftPalmNormal",new JSONArray(Arrays.asList(0,0,1)));s.put("rightPalmNormal",new JSONArray(Arrays.asList(0,0,1)));s.put("absentChains",new JSONArray());
        return s;
    }
    private void execute(Bundle request,Messenger reply) {
        long started=SystemClock.elapsedRealtime(); File root=null;JSONObject receipt=new JSONObject();String error=null;
        try {
            String command=request.getString("command","");
            if (!Arrays.asList("ANALYZE","INITIAL_BODY_GUIDES","INSPECT","ROUNDTRIP").contains(command)) throw new IOException("Команда недоступна в диагностике");
            if (!Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")) throw new IOException("Для этого модуля требуется ARM64");
            File selected=ownFile(request.getString("source",""));
            if (!selected.isFile()||selected.length()>104857600) throw new IOException("Некорректный входной GLB");
            root=new File(getFilesDir(),"jobs/"+UUID.randomUUID());File folder=new File(root,"input");if(!folder.mkdirs())throw new IOException("Не удалось создать папку расчёта");
            receipt.put("probeVersion","0.3-test");receipt.put("command",command);receipt.put("androidApi",Build.VERSION.SDK_INT);receipt.put("device",Build.MANUFACTURER+" "+Build.MODEL);receipt.put("abis",new JSONArray(Arrays.asList(Build.SUPPORTED_ABIS)));
            File original=new File(folder,"source-original.glb"),geometry=new File(folder,"source-float.glb"),input=new File(folder,"source.glb"),output=new File(root,"output.glb"),report=new File(root,"report.json"),sessionFile=new File(root,"session.json");
            try(InputStream in=new FileInputStream(selected);OutputStream out=new FileOutputStream(original)){copy(in,out,104857600);}
            receipt.put("originalSourceSha256",hash(original));receipt.put("originalSourceBytes",original.length());
            send(reply,PROGRESS,request.getString("token",""),"stage","Подготовка GLB для риггера");
            receipt.put("stage","INPUT_PREPARATION");
            receipt.put("inputPreparation",GlbQuantization.prepare(original,geometry));
            try{receipt.put("texturePreparation",GlbWebpCompatibility.prepare(geometry,input,new AndroidWebpCodec()));}finally{geometry.delete();}
            receipt.put("preparedSourceSha256",hash(input));receipt.put("preparedSourceBytes",input.length());
            JSONObject settings=session(input);write(sessionFile,settings.toString(2));
            receipt.put("session",settings);
            receipt.put("inputSha256Before",hash(input));
            File library=new File(getApplicationInfo().nativeLibraryDir,"libriggerdroid_rigger.so");if(library.isFile())receipt.put("nativeLibrarySha256",hash(library));
            RigNative nativeRig=RigNative.INSTANCE;
            if(cancelled.get())throw new InterruptedException("Отменено до запуска");
            receipt.put("stage","NATIVE_CALL");
            nativeRig.prepare();if(cancelled.get())nativeRig.cancel();
            String returned=nativeRig.runSession(command,input.getPath(),output.getPath(),report.getPath(),sessionFile.getPath(),(stage,percent)->{
                Message m=Message.obtain(null,PROGRESS);Bundle b=new Bundle();b.putString("token",request.getString("token",""));b.putString("stage",stage);b.putInt("percent",percent);b.putInt("pid",android.os.Process.myPid());m.setData(b);try{reply.send(m);}catch(RemoteException ignored){}
            });
            try{receipt.put("nativeReturn",new JSONObject(returned));}catch(JSONException invalid){receipt.put("nativeReturnText",returned);}
            if(report.isFile()&&report.length()<1048576){String text=read(report,1048576);try{receipt.put("nativeReport",new JSONObject(text));}catch(JSONException invalid){receipt.put("nativeReportText",text);}}
            receipt.put("inputSha256After",hash(input));receipt.put("inputPreserved",receipt.getString("inputSha256Before").equals(receipt.getString("inputSha256After")));
            receipt.put("originalSourcePreserved",receipt.getString("originalSourceSha256").equals(hash(original)));
            receipt.put("outputBytes",output.isFile()?output.length():0);if(output.isFile())receipt.put("outputSha256",hash(output));
            receipt.put("probeStatus",cancelled.get()?"CANCELLED":"NATIVE_CALL_RETURNED");
        } catch(Throwable failure) {
            error=failure.getClass().getSimpleName()+": "+String.valueOf(failure.getMessage());
            try{receipt.put("probeStatus","FAILED");receipt.put("error",error);}catch(JSONException ignored){}
        } finally {
            try {
                receipt.put("elapsedMilliseconds",SystemClock.elapsedRealtime()-started);
                if(root==null){root=new File(getFilesDir(),"jobs/failed-"+UUID.randomUUID());root.mkdirs();}
                File file=new File(root,"probe-report.json");write(file,receipt.toString(2));send(reply,DONE,request.getString("token",""),"reportPath",file.getPath());
            } catch(Throwable failure) { send(reply,ERROR,request.getString("token",""),"message",String.valueOf(failure)); }
            busy.set(false);
        }
    }
}

