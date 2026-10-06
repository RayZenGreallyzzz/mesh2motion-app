export class PlatformUtils {
  /* originally created this since iOS has some weird rules about valid file extensions for
     uploads. If we see the browser is iOS, we will allow all file extensions */
  public static isIOS (): boolean {
    // Check user agent for iOS devices
    const isIOSUA = /iPad|iPhone|iPod/.test(navigator.userAgent)

    // iPad on iOS 13+ detection (reports as Macintosh but has touch)
    const isIPadOS = navigator.userAgent.includes('Mac') && 'ontouchend' in document
    return isIOSUA || isIPadOS
  }

  /**
   * Android document providers are inconsistent about MIME types for .glb/.fbx.
   * Some valid GLB files are exposed as application/octet-stream instead of
   * model/gltf-binary, so extension-based <input accept> filters can hide them.
   */
  public static isAndroid (): boolean {
    return /Android/i.test(navigator.userAgent)
  }
}
