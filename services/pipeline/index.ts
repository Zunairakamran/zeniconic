/**
 * Public surface of the pipeline service.
 *
 * `service` owns analysis, requests and the EDL render seam; `ffmpeg-overlays`
 * owns the packaged text path; `marketing` owns the single-pass campaign
 * renderer. Re-exporting them here keeps callers from reaching into files.
 */

export * from './service';
export * from './ffmpeg-overlays';
export * from './marketing';
