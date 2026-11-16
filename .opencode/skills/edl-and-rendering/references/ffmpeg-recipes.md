# FFmpeg recipes

Copy-paste ready. `ffmpeg-static` and `ffprobe-static` from the app bundle — no
system install, no PATH assumptions. PowerShell: double quotes outside, single
quotes inside. Times in seconds with 3 decimals.

## 1. Loudness, two passes

Pass 1 measures. Never guess: a −8 LUFS music bed and a −26 LUFS voice do not
average into −14.

```bash
ffmpeg -hide_banner -nostats -i mix.wav \
  -af loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json -f null -
# parse from stderr: input_i, input_tp, input_lra, input_thresh, target_offset
```

Pass 2 applies, linearly where possible:

```bash
ffmpeg -hide_banner -y -i mix.wav \
  -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-18.42:measured_TP=-2.10:measured_LRA=7.30:measured_thresh=-28.65:offset=0.85:linear=true:print_format=summary" \
  -c:a aac -b:a 320k -ar 48000 -ac 2 master.m4a
```

- `I=-14` for `vertical-social`, `feed-portrait`, `pin`; `I=-16` for `landscape`.
- `linear=true` only when `measured_LRA ≤ 11`; above that ffmpeg falls back to dynamic
  mode and the result pumps — re-run with `LRA=20` rather than shipping the pumping.
  Read `output_i` from the summary: within ±0.3 of target, or a `target_offset`
  outside ±2 is the cause. 320 kbps is deliberate: platforms re-encode at −14 LUFS,
  and 1.2 MB per 30 s buys headroom that survives generation two.

## 2. Ducking music under voice

```bash
ffmpeg -hide_banner -y -i music.wav -i voice.wav -filter_complex "
[0:a]atrim=start=0:end=30,asetpts=PTS-STARTPTS,volume=-7dB,adelay=0|0[mus];
[1:a]aresample=48000,adelay=400|400,apad=whole_dur=30,asplit=2[voA][voSC];
[mus][voSC]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=380:makeup=1[musD];
[voA][musD]amix=inputs=2:duration=first:normalize=0,
  alimiter=limit=0.94,atrim=0:30[mix]" \
  -map "[mix]" -c:a pcm_s16le mix.wav
```

- `threshold=0.02` is linear amplitude, ≈ −34 dBFS: voice above room tone triggers
  the duck. Raise to 0.04 in a noisy house.
- 15 ms attack keeps consonants; 380 ms release stops pumping between words.
- `normalize=0` is mandatory. Default `amix` divides by input count, quietly drops
  6 dB, and fails the loudness gate after the picture is already rendered.
- `adelay=400|400` offsets voice by 0.4 s, both channels. `duckUnderVoiceDb` is the
  depth target: `ratio=8` gives ≈ −18 dB under speech, `ratio=6` ≈ −12, `ratio=12` ≈ −20.

## 3. H.264 encodes

```bash
ffmpeg -hide_banner -y -i picture.mp4 -i master.m4a -map 0:v:0 -map 1:a:0 \
  -c:v libx264 -preset slow -crf 18 -profile:v high -level:v 4.2 \
  -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0 \
  -maxrate 12M -bufsize 24M \
  -c:a aac -b:a 320k -ar 48000 -ac 2 \
  -movflags +faststart -shortest out.mp4
```

| Ladder | Canvas | CRF | Preset | Maxrate | 30 s size |
|---|---|---|---|---|---|
| `draft` | 540×960 | 28 | `veryfast` | 4M | 6–9 MB |
| `final` vertical | 1080×1920 | 18 | `slow` | 12M | 38–52 MB |
| `final` landscape | 1920×1080 | 19 | `slow` | 16M | 42–60 MB |
| `pin` | 1000×1500 | 20 | `medium` | 8M | 30–40 MB |

- `-g 60 -keyint_min 60 -sc_threshold 0` gives a keyframe every 2 s, which trimmers
  and thumbnail pickers expect; the default scatters keyframes on every cut.
- `-pix_fmt yuv420p` always, or a 4:2:2 source produces a file Safari and TikTok
  refuse; `+faststart` on mp4 only, otherwise the first frame needs a network round
  trip.
- Never `-crf 0`. Lossless H.264 is ~8× the size and gets re-encoded anyway.

This is the no-overlay fast path, the concat-repair fallback, and the reference for
chunk encodes, which use the same ladder in Remotion (`--crf 18` final, 28 draft).

## 4. Frame-accurate trim

```bash
ffmpeg -hide_banner -y -ss 12.345 -i raw/kitchen.mp4 -t 6.500 \
  -an -map_metadata -1 -vf "fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1" \
  -c:v libx264 -crf 14 -preset veryfast seg_9f3c2a01.mp4
```

- `-ss` before `-i` with a re-encode is frame accurate: `accurate_seek` is on and
  ffmpeg decodes from the previous keyframe, discarding frames.
- `-ss` with `-c copy` is **not** accurate; it snaps to the keyframe and silently
  starts the shot up to 2 s early. Banned in this pipeline. `-t` after `-i` is output
  duration, matching `outSec − inSec`.
- CRF 14 for segments: an intermediate the composite re-encodes once. 18 stacks
  visible softening; 10 triples disk for no gain. `-an` because audio is mixed once
  from sources — segment audio drifts a frame per cut against the music. `setsar=1`
  stops a non-square-pixel source arriving squashed.

## 5. pad_blur

Letterbox a landscape clip into a vertical canvas over a blurred enlargement of
itself; use when a source under 2560 px wide would upscale past 1.35× in `cover`.

```bash
ffmpeg -hide_banner -y -i raw/wide.mp4 -t 6.500 -an -filter_complex "
[0:v]fps=30,split=2[bg][fg];
[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,
    gblur=sigma=45,eq=brightness=-0.07:saturation=0.85[b];
[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[f];
[b][f]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -crf 16 -preset veryfast seg_pad_1a04.mp4
```

`sigma=45` is a deliberate smear — 20 leaves doubled window frames visible and reads
as a mistake. The `-0.07` brightness and `0.85` saturation stop the blur competing
with the sharp centre. Both `scale` calls are needed: one fills and crops, one fits.
Swapping them produces a blurred stripe. R11 still runs because `path` must exist.

## 6. Cover crop with a moving centre

```bash
ffmpeg -y -i raw/kitchen.mp4 -ss 12.345 -t 6.500 -an -filter_complex "
[0:v]fps=30,crop=w=iw*0.3164:h=ih:
   x='(0.42 + 0.06*(t/6.5))*iw - ow/2':y='0.50*ih - oh/2',
   scale=1080:1920:flags=lanczos,setsar=1[v]" -map "[v]" \
  -c:v libx264 -crf 14 -preset veryfast seg_c8d10e22.mp4
```

`0.3164` is `cropW/W` for 16:9 into 9:16 (`footage-analysis/references/crop-anchors.md`
§3). Beyond two keyframes, generate a piecewise expression from the EDL path — one
`gte(t, t0)` branch per interval, clamped with `min`/`max`, capped at six intervals.
Longer chains evaluate slowly per frame and indicate the path should have been
reduced. An expression that walks past the frame edge yields a black border for two
frames: invisible in a draft, fatal in review. R12 catches it before encode.

## 7. Concat segments

`list.txt` holds one `file 'D:/video/data/listings/<slug>/cache/seg/seg_9f3c2a01.mp4'`
line per segment — forward slashes, single quotes, no BOM.

```bash
ffmpeg -hide_banner -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart picture.mp4
```

All segments must share codec, profile, level, resolution, fps, pix_fmt and SAR or
`-c copy` yields a file that plays for two seconds and stops — which is why every
segment carries the explicit flags from §3 rather than preset defaults. If they do
differ, re-encode (`-c:v libx264 -crf 14`) and accept one more generation.

## 8. Speed change

```bash
ffmpeg -y -i seg_in.mp4 -filter_complex "[0:v]setpts=PTS/1.25,fps=30[v];[0:a]atempo=1.25[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 14 -c:a aac -b:a 192k seg_fast.mp4
```

`setpts=PTS/speed` and `atempo=speed` must match or picture and sound separate.
`atempo` covers 0.5–2.0 in one instance, exactly the EDL's `speed` range; speed divides
duration, so 1.25 makes a 6.5 s window 5.2 s on the timeline.

## 9. Mux and verify

```bash
ffmpeg -hide_banner -y -i picture.mp4 -i master.m4a -map 0:v:0 -map 1:a:0 \
  -c:v copy -c:a copy -movflags +faststart -shortest \
  "2026-11-14-14-oak-avenue_cinematic_calm_vertical-social_v2.mp4"

ffprobe -v error -of json -show_entries \
  format=duration,size,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels,nb_frames \
  out.mp4

ffmpeg -hide_banner -nostats -i out.mp4 -filter_complex ebur128=peak=true -f null - 2>&1 |
  Select-String -Pattern "I:|Peak:"
```

Accept only when: duration within one frame of the EDL total, `r_frame_rate` equals
profile fps, `pix_fmt` is `yuv420p`, audio is 48000/2, loudness within ±0.5 of target,
true peak ≤ −1.0 dBTP.

## 10. Cover and captions

```bash
ffmpeg -y -ss 1.200 -i out.mp4 -frames:v 1 -vf "scale=1080:-2" -q:v 2 cover.jpg

ffmpeg -y -i out.mp4 -vf "subtitles=captions.srt:force_style='FontName=Archivo,FontSize=18,Outline=0,Shadow=0,BorderStyle=1,MarginV=340'" \
  -c:v libx264 -crf 18 -c:a copy out_captioned.mp4
```

`MarginV=340` is the bottom safe area for `vertical-social`. Burned captions belong to
exactly one stage — Remotion — so this is a sidecar rescue, never the normal path.

## Gotchas

- `-shortest` with a still longer than the audio truncates the video: right for a mux,
  wrong for a mix. `-fps_mode cfr` on any VFR phone source, or the timeline drifts
  40 ms per minute against the music. `-map_metadata -1` on every intermediate,
  because source GPS tags do not belong in a delivery file.
- `-loglevel error` hides the `loudnorm` and `ebur128` summaries, which are the only
  proof the audio is right. Use `-nostats -loglevel info` and parse.

