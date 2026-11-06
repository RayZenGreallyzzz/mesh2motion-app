package com.rayzen.rigprobe;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.graphics.Color;
import android.widget.*;
import java.io.*;
import java.util.*;
import org.json.*;

public final class MainActivity extends Activity {
    private static final int PICK=10,SAVE_REPORT=11,SAVE_MODEL=12;
    private final ArrayList<Button> locked=new ArrayList<>();
    private TextView status;private File source,lastReport,lastModel;private Messenger worker;private boolean bound,running;private int workerPid;private String activeToken="";
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Runnable timeout=()->stopWorker("TIMEOUT: расчёт остановлен после 120 секунд");
    private final Messenger reply=new Messenger(new Handler(Looper.getMainLooper()) {
        @Override public void handleMessage(Message message) {
            Bundle b=message.getData();if(!running||!activeToken.equals(b.getString("token","")))return;workerPid=b.getInt("pid",0);
            if(message.what==ProbeService.PROGRESS){status.setText(b.getString("stage","")+" · "+b.getInt("percent")+"%");}
            else if(message.what==ProbeService.DONE){
                try{lastReport=new File(b.getString("reportPath"));String text=ProbeService.read(lastReport,2097152);status.setText(text.length()>12000?text.substring(0,12000)+"\nПолный текст — в отчёте.":text);File p=new File(lastReport.getParentFile(),"output.glb");lastModel=validGlb(p)?p:null;}catch(Exception e){status.setText(e.toString());}
                finishJob();
            }else if(message.what==ProbeService.ERROR){status.setText(b.getString("message","Ошибка"));finishJob();}
        }
    });
    private final ServiceConnection connection=new ServiceConnection(){
        @Override public void onServiceConnected(ComponentName name,IBinder binder){worker=new Messenger(binder);}
        @Override public void onServiceDisconnected(ComponentName name){worker=null;if(running)stopWorker("WORKER_STOPPED: процесс риггера завершился. Расчёт не подтверждён.");}
    };
    @Override public void onCreate(Bundle saved){super.onCreate(saved);
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(24,20,24,24);body.setBackgroundColor(Color.rgb(24,31,41));
        TextView heading=new TextView(this);heading.setText("Проверка нативного риггера");heading.setTextSize(22);heading.setTextColor(Color.WHITE);body.addView(heading);
        TextView about=new TextView(this);about.setText("ARM64 · отдельный тест. Проверяет загрузку модуля, чтение GLB и предложение ориентиров. Скелет и веса этим тестом не исправляются.\nВыберите модель, затем нажмите «Анализ».");about.setTextColor(Color.LTGRAY);body.addView(about);
        button(body,"Контрольный готовый риг",()->asset("probe/donor.glb"),true);
        button(body,"Исходная модель человека",()->asset("probe/demo-human.glb"),true);
        button(body,"Выбрать свой GLB",()->{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");startActivityForResult(i,PICK);},true);
        button(body,"Анализ",()->run("ANALYZE"),true);
        button(body,"Предложить ориентиры тела",()->run("INITIAL_BODY_GUIDES"),true);
        button(body,"Проверить чтение и запись GLB",()->run("ROUNDTRIP"),true);
        button(body,"Отменить",this::cancel,false);
        button(body,"Сохранить отчёт",()->save(SAVE_REPORT,"rig-engine-v02-"+System.currentTimeMillis()+".json","application/json",lastReport),true);
        button(body,"Сохранить результат записи GLB",()->save(SAVE_MODEL,"rig-engine-roundtrip.glb","model/gltf-binary",lastModel),true);
        status=new TextView(this);status.setTextColor(Color.WHITE);status.setTextIsSelectable(true);
        File previous=new File(getFilesDir(),"selected.glb");if(validGlb(previous)){source=previous;status.setText("0.2-test · Сохранена ранее выбранная модель. Нажмите «Анализ».\nКвантованный GLB подготавливается автоматически; исходник сохраняется.");}else status.setText("0.2-test · Ожидание. Интернет не требуется.");body.addView(status);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);scroll.addView(body);setContentView(scroll);
        connect();
    }
    private void button(LinearLayout body,String title,Runnable action,boolean lock){Button b=new Button(this);b.setText(title);b.setOnClickListener(v->action.run());body.addView(b);if(lock)locked.add(b);}
    private void connect(){if(bound)return;Intent i=new Intent(this,ProbeService.class);bound=bindService(i,connection,Context.BIND_AUTO_CREATE);}
    private void asset(String path){try(InputStream in=getAssets().open(path)){importFile(in,path);}catch(Exception e){status.setText("Не удалось открыть встроенную модель: "+e);}}
    private void importFile(InputStream in,String name)throws Exception{
        File temp=new File(getFilesDir(),"selected.tmp");try(OutputStream out=new FileOutputStream(temp)){ProbeService.copy(in,out,104857600);}
        if(!validGlb(temp))throw new IOException("Нужен корректный GLB 2.0");
        source=new File(getFilesDir(),"selected.glb");if(source.exists()&&!source.delete())throw new IOException("Не удалось заменить файл");if(!temp.renameTo(source))throw new IOException("Не удалось сохранить файл");
        status.setText("Выбрано: "+name+"\nРазмер: "+source.length()+" байт");
    }
    private void run(String command){
        if(running)return;if(source==null){status.setText("Сначала выберите модель");return;}if(worker==null){connect();status.setText("Процесс запускается. Нажмите команду ещё раз через секунду.");return;}
        running=true;activeToken=UUID.randomUUID().toString();lastModel=null;lastReport=null;workerPid=0;for(Button b:locked)b.setEnabled(false);status.setText("Запуск: "+command);main.postDelayed(timeout,120000);
        Message m=Message.obtain(null,ProbeService.RUN);Bundle data=new Bundle();data.putString("source",source.getPath());data.putString("command",command);data.putString("token",activeToken);m.setData(data);m.replyTo=reply;
        try{worker.send(m);}catch(RemoteException e){status.setText(e.toString());finishJob();}
    }
    private void cancel(){if(!running)return;final String token=activeToken;try{if(worker!=null)worker.send(Message.obtain(null,ProbeService.CANCEL));}catch(RemoteException ignored){}status.setText("Отменяю…");main.postDelayed(()->{if(running&&activeToken.equals(token))stopWorker("CANCELLED: процесс остановлен после запроса отмены");},3000);}
    private static boolean validGlb(File file){if(!file.isFile()||file.length()<20)return false;try(DataInputStream in=new DataInputStream(new FileInputStream(file))){return in.readInt()==0x676c5446&&Integer.reverseBytes(in.readInt())==2&&(Integer.reverseBytes(in.readInt())&0xffffffffL)==file.length();}catch(IOException invalid){return false;}}
    private void stopWorker(String reason){
        if(!running)return;
        int pid=workerPid;if(pid>0&&pid!=android.os.Process.myPid())android.os.Process.killProcess(pid);
        try{if(bound)unbindService(connection);}catch(Exception ignored){}bound=false;worker=null;stopService(new Intent(this,ProbeService.class));finishJob();status.setText(reason);
        try{lastReport=new File(getFilesDir(),"worker-stopped.json");JSONObject r=new JSONObject();r.put("probeStatus",reason);r.put("nativeCompletionConfirmed",false);ProbeService.write(lastReport,r.toString(2));}catch(Exception ignored){}
        connect();
    }
    private void finishJob(){running=false;main.removeCallbacks(timeout);for(Button b:locked)b.setEnabled(true);}
    private void save(int request,String name,String type,File file){if(file==null||!file.isFile()){status.setText("Пока нет файла для сохранения");return;}Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(type);i.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(i,request);}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(result!=RESULT_OK||data==null||data.getData()==null)return;Uri uri=data.getData();try{
        if(request==PICK){try(InputStream in=getContentResolver().openInputStream(uri)){importFile(in,"пользовательский GLB");}}
        else{File file=request==SAVE_REPORT?lastReport:lastModel;if(file==null)throw new IOException("Нет результата");try(InputStream in=new FileInputStream(file);OutputStream out=getContentResolver().openOutputStream(uri,"wt")){ProbeService.copy(in,out,104857600);}Toast.makeText(this,"Файл сохранён",Toast.LENGTH_SHORT).show();}
    }catch(Exception e){status.setText(e.toString());}}
    @Override protected void onDestroy(){if(running)cancel();if(bound){try{unbindService(connection);}catch(Exception ignored){}bound=false;}stopService(new Intent(this,ProbeService.class));super.onDestroy();}
}
