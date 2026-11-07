import com.rayzen.rigprobe.GlbWebpCompatibility;
import java.io.*;
import org.json.JSONObject;

/** Host-only codec adapter: production APK uses AndroidWebpCodec instead. */
public final class GlbWebpCli {
    public static void main(String[] args)throws Exception{
        GlbWebpCompatibility.ImageCodec codec=(webp,png)->{
            File source=File.createTempFile("fixture-webp-",".webp",png.getAbsoluteFile().getParentFile());
            try{
                try(OutputStream out=new FileOutputStream(source)){out.write(webp);}
                Process p=new ProcessBuilder(args[2],"-c","from PIL import Image; import sys; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2],format='PNG')",source.getPath(),png.getPath()).inheritIO().start();
                if(p.waitFor()!=0)throw new IOException("Host image decode failed");return new JSONObject().put("decoder","Pillow test adapter");
            }finally{source.delete();}
        };
        System.out.println(GlbWebpCompatibility.prepare(new File(args[0]),new File(args[1]),codec));
    }
}
