import com.rayzen.rigprobe.GlbQuantization;
import java.io.*;
public final class GlbPrepareCli {
    public static void main(String[] args)throws Exception {
        System.out.println(GlbQuantization.prepare(new File(args[0]),new File(args[1])).toString());
    }
}
