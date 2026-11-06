package dev.unicorn.rigger.android;

/** Independently written JNI declarations; no application bytecode is bundled. */
public final class RigNative {
    public static final RigNative INSTANCE = new RigNative();
    static { System.loadLibrary("riggerdroid_rigger"); }
    private RigNative() { }
    public final native void prepare();
    public final native void cancel();
    public final native String run(String command, String input, String output,
                                  String report, RigNativeProgress progress);
    public final native String runSession(String command, String input, String output,
                                         String report, String session, RigNativeProgress progress);
}
