package dev.unicorn.rigger.android;

/** Minimal interoperability declaration matching the supplied binary's JNI ABI. */
public interface RigNativeProgress {
    void onStage(String stage, int percent);
}

