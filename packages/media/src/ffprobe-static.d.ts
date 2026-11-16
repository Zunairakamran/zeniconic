declare module 'ffprobe-static' {
  /** Resolved path to the bundled ffprobe binary, or null when unavailable. */
  const ffprobeStatic: { path: string | null };
  export default ffprobeStatic;
}
