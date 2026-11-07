package com.rayzen.riganimationstudio.nativeengine;

import android.content.*;
import android.os.*;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

@CapacitorPlugin(name="RigNativeEngine")
public final class NativeRigPlugin extends Plugin {
    private final ExecutorService io=Executors.newSingleThreadExecutor();private final Handler main=new Handler(Looper.getMainLooper());
    private volatile String activeToken="",activeProject="";private volatile PluginCall pending;private Messenger worker;private boolean bound;private int workerPid;private Bundle waiting;
    private final Map<String,Long> uploadSizes=new HashMap<>();
    private final ServiceConnection connection=new ServiceConnection(){
        @Override public void onServiceConnected(ComponentName name,IBinder binder){worker=new Messenger(binder);if(waiting!=null)dispatch();}
        @Override public void onServiceDisconnected(ComponentName name){worker=null;if(pending!=null)failWorker("Движок завершился. Исходная модель сохранена.");}
    };
    private final Messenger reply=new Messenger(new Handler(Looper.getMainLooper()){
        @Override public void handleMessage(Message message){
            Bundle b=message.getData();if(pending==null||!activeToken.equals(b.getString("token")))return;workerPid=b.getInt("pid",0);
            if(message.what==NativeRigWorker.PROGRESS){JSObject event=new JSObject();event.put("project",activeProject);event.put("stage",b.getString("value"));event.put("percent",b.getInt("percent"));notifyListeners("progress",event);}
            else if(message.what==NativeRigWorker.DONE){PluginCall call=pending;String project=activeProject;clearPending();io.execute(()->{
                try{File root=project(project),receiptFile=new File(b.getString("value")).getCanonicalFile();if(!receiptFile.equals(new File(root,"receipt.json").getCanonicalFile()))throw new IOException("Неверный отчёт");JSONObject receipt=new JSONObject(NativeFiles.read(receiptFile,2097152));JSObject out=new JSObject();out.put("receipt",receipt);call.resolve(out);}
                catch(Exception e){call.reject(e.getMessage());}
            });}
            else if(message.what==NativeRigWorker.ERROR)failWorker(b.getString("value","Ошибка движка"));
        }
    });
    private final Runnable deadline=()->failWorker("Расчёт превысил 120 секунд. Исходная модель сохранена.");
    private File base(){File root=new File(getContext().getCacheDir(),"native-rig");root.mkdirs();return root;}
    private File project(String id)throws Exception{if(id==null||!id.matches("[a-f0-9-]{36}"))throw new IOException("Неверная сессия");File root=new File(base(),id);if(!root.isDirectory())throw new IOException("Сессия больше недоступна");return root;}
    private boolean available(){return Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a")&&new File(getContext().getApplicationInfo().nativeLibraryDir,"libriggerdroid_rigger.so").isFile();}
    @PluginMethod public void capabilities(PluginCall call){JSObject out=new JSObject();out.put("available",available());out.put("solverVersion","0.5.29-variable-digit-topology");out.put("reason",available()?"":"Нужна ARM64-сборка Studio с модулем риггера");call.resolve(out);}
    @PluginMethod public void begin(PluginCall call){io.execute(()->{try{
        if(!available())throw new IOException("Нативный движок отсутствует в этой сборке");if(pending!=null)throw new IOException("Дождитесь расчёта");long size=call.getData().optLong("size",-1);if(size<20||size>NativeFiles.MAX_INPUT)throw new IOException("GLB должен быть меньше 100 МБ");
        String id=UUID.randomUUID().toString();File input=new File(base(),id+"/input");if(!input.mkdirs())throw new IOException("Не удалось создать сессию");new File(input,"source-original.glb").createNewFile();uploadSizes.put(id,size);JSObject out=new JSObject();out.put("project",id);call.resolve(out);
    }catch(Exception e){call.reject(e.getMessage());}});}
    @PluginMethod public void append(PluginCall call){io.execute(()->{try{
        String id=call.getString("project");File root=project(id),file=new File(root,"input/source-original.glb");Long size=uploadSizes.get(id);String data=call.getString("data","");long offset=call.getData().optLong("offset",-1);
        if(size==null||data.length()>180000||offset!=file.length())throw new IOException("Нарушен порядок передачи модели");byte[] bytes=Base64.decode(data,Base64.NO_WRAP);if(bytes.length==0||offset+bytes.length>size)throw new IOException("Неверный размер блока");
        try(OutputStream out=new FileOutputStream(file,true)){out.write(bytes);}call.resolve();
    }catch(Exception e){call.reject(e.getMessage());}});}
    @PluginMethod public void prepare(PluginCall call){io.execute(()->{try{
        if(pending!=null)throw new IOException("Расчёт уже выполняется");String id=call.getString("project");File root=project(id),original=new File(root,"input/source-original.glb");Long size=uploadSizes.get(id);
        if(size==null||size!=original.length())throw new IOException("Модель передана не полностью");
        File library=new File(getContext().getApplicationInfo().nativeLibraryDir,"libriggerdroid_rigger.so");if(!NativeFiles.ENGINE_SHA.equals(NativeFiles.hash(library)))throw new IOException("Версия движка не соответствует интерфейсу");
        uploadSizes.remove(id);start(call,id,root,"PREPARE");
    }catch(Throwable e){call.reject("Подготовка модели: "+e.getMessage());}});}
    @PluginMethod public void run(PluginCall call){io.execute(()->{try{
        if(pending!=null)throw new IOException("Расчёт уже выполняется");String id=call.getString("project"),command=call.getString("command","");File root=project(id),file=new File(root,"session.json");
        if(!Arrays.asList("ANALYZE","INITIAL_BODY_GUIDES","PROPOSE_BODY","PREVIEW_BODY","BUILD_SKELETON","COMPUTE_WEIGHTS","EXPORT").contains(command))throw new IOException("Недоступная команда");
        JSONObject s=new JSONObject(NativeFiles.read(file,1048576));boolean changed=false;
        for(String key:new String[]{"bodyGuides","bodyLandmarks"})if(call.getData().has(key)){JSONObject points=call.getData().getJSONObject(key);NativeFiles.points(points);s.put(key,points);changed=true;}
        if(changed){s.put("revision",s.getInt("revision")+1).put("depthConfirmed",false);}
        if("BUILD_SKELETON".equals(command)){if(!call.getData().optBoolean("reviewed",false))throw new IOException("Сначала проверьте суставы спереди и сбоку");s.put("depthConfirmed",true);}
        if(Arrays.asList("BUILD_SKELETON","COMPUTE_WEIGHTS","EXPORT").contains(command)&&(!s.getBoolean("depthConfirmed")||s.getJSONObject("bodyLandmarks").length()<4))throw new IOException("Нужны проверенные ориентиры тела");
        NativeFiles.write(file,s);start(call,id,root,command);
    }catch(Exception e){call.reject(e.getMessage());}});}
    private void start(PluginCall call,String id,File root,String command){
        Bundle request=new Bundle();String token=UUID.randomUUID().toString();request.putString("root",root.getPath());request.putString("command",command);request.putString("token",token);
        pending=call;activeProject=id;activeToken=token;waiting=request;
        main.post(()->{main.postDelayed(deadline,120000);if(worker==null){if(!bound)bound=getContext().bindService(new Intent(getContext(),NativeRigWorker.class),connection,Context.BIND_AUTO_CREATE);if(!bound)failWorker("Не удалось запустить движок");}else dispatch();});
    }
    private void dispatch(){if(waiting==null||worker==null)return;Message message=Message.obtain(null,NativeRigWorker.RUN);message.setData(waiting);message.replyTo=reply;waiting=null;try{worker.send(message);}catch(RemoteException e){failWorker("Движок недоступен");}}
    private void clearPending(){pending=null;activeProject="";activeToken="";waiting=null;main.removeCallbacks(deadline);workerPid=0;}
    private void failWorker(String reason){PluginCall call=pending;int pid=workerPid;clearPending();if(pid>0&&pid!=android.os.Process.myPid())android.os.Process.killProcess(pid);if(bound){try{getContext().unbindService(connection);}catch(Exception ignored){}bound=false;}worker=null;getContext().stopService(new Intent(getContext(),NativeRigWorker.class));if(call!=null)call.reject(reason);}
    @PluginMethod public void cancel(PluginCall call){main.post(()->{final String token=activeToken;if(pending!=null){try{if(worker!=null)worker.send(Message.obtain(null,NativeRigWorker.CANCEL));}catch(RemoteException ignored){}main.postDelayed(()->{if(pending!=null&&activeToken.equals(token))failWorker("Расчёт отменён. Исходная модель сохранена.");},3000);}call.resolve();});}
    @PluginMethod public void read(PluginCall call){io.execute(()->{try{
        String id=call.getString("project"),kind=call.getString("kind","");File root=project(id),file;
        if("output".equals(kind))file=new File(root,"output.glb");else if("prepared".equals(kind))file=new File(root,"input/source.glb");else throw new IOException("Недоступный файл");
        if(pending!=null&&id.equals(activeProject))throw new IOException("Расчёт ещё выполняется");NativeFiles.validateGlb(file,NativeFiles.MAX_OUTPUT);long offset=call.getData().optLong("offset",-1);int size=call.getInt("size",98304);if(offset<0||offset>file.length()||size<1||size>98304)throw new IOException("Неверный диапазон");
        byte[] data=new byte[(int)Math.min(size,file.length()-offset)];try(RandomAccessFile in=new RandomAccessFile(file,"r")){in.seek(offset);in.readFully(data);}JSObject out=new JSObject();out.put("data",Base64.encodeToString(data,Base64.NO_WRAP));out.put("offset",offset);out.put("total",file.length());call.resolve(out);
    }catch(Exception e){call.reject(e.getMessage());}});}
    @PluginMethod public void discard(PluginCall call){io.execute(()->{try{String id=call.getString("project");if(id!=null&&id.equals(activeProject))throw new IOException("Сессия выполняется");File root=project(id);uploadSizes.remove(id);NativeFiles.delete(root);call.resolve();}catch(Exception e){call.reject(e.getMessage());}});}
    @Override protected void handleOnDestroy(){main.post(()->failWorker("Страница закрыта"));io.shutdownNow();super.handleOnDestroy();}
}
