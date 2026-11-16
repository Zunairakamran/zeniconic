# Quality presets

Four presets, one encoder contract. A preset changes resolution, CRF and bitrate —
never aspect, never runtime, never loudness. The profile decides geometry; the
preset decides how many pixels are spent on it.

## Presets

| Preset | Short side | `vertical-social` | `feed-portrait` | `landscape` | `pin` | Use |
|---|---|---|---|---|---|---|
| Draft | 540 | 540×960 | 540×675 | 960×540 | 540×810 | Internal review only |
| Standard | 1080 | 1080×1920 | 1080×1350 | 1920×1080 | 1000×1500 | Every delivery by default |
| High | 1440 | 1440×2560 | 1440×1800 | 2560×1440 | 1500×2250 | Landscape masters, archive |
| Custom | 720–2160 | computed | computed | computed | computed | Source is unusual, or a destination has a hard cap |

Notes that prevent wrong choices:

- `pin` at Standard keeps its native 1000×1500; the profile fixes the width, so the
  "1080" preset does not stretch it.
- **High on `vertical-social` gains nothing on a phone.** TikTok, Reels, Stories and
  Shorts transcode to roughly 1080 wide. High is worth it only when the same file is
  also the website or archive master. Say so instead of upselling it.
- Draft never enters a ZIP and never reaches a destination. It is a review link with
  the same timeline and the same audio chain, at roughly a third of the encode time.
- A source smaller than the preset short side caps the preset. Never upscale; drop to
  the next preset down and tell the user which one and why.

## Encoder contract

| Setting | Value |
|---|---|
| Video codec | H.264 / AVC, `libx264` |
| Profile | High |
| Level | 4.0 at ≤1080p30, 4.2 at 1080p50/60, 5.0 at 1440p30, 5.1 at 1440p50/60 |
| Pixel format | `yuv420p`, 8-bit |
| Colour | `bt709` primaries, transfer and matrix; tagged, not assumed |
| SAR / DAR | 1:1 / profile aspect |
| GOP | 2 s (`-g` = 2 × fps), closed, `-sc_threshold 0` |
| B-frames | 2 |
| Audio | AAC-LC, 48 kHz, stereo, 320 kbps |
| Container | MP4, `+faststart`, one video and one audio stream |
| Loudness | Profile target, true peak −1.5 dBTP |

`yuv420p` is not a quality compromise here; it is the only pixel format every
destination decodes without a colour shift. 10-bit or 4:2:2 masters stay in the
project, never in a delivery.

## Bitrate and CRF

CRF does the work; the cap stops a difficult frame from blowing the file size.
Both are needed: CRF alone produces 40 Mbps on confetti, and a fixed bitrate alone
wastes bits on a white wall.

| Preset | CRF | x264 preset | Target | Cap | VBV buffer |
|---|---|---|---|---|---|
| Draft | 28 | `veryfast` | 2 Mbps | 3 Mbps | 6 Mbit |
| Standard, 1080 (2.07 MP) | 18 | `slow` | 8 Mbps | 12 Mbps | 24 Mbit |
| Standard, 4:5 or 2:3 (≈1.5 MP) | 18 | `slow` | 6 Mbps | 9 Mbps | 18 Mbit |
| High, 1440 (3.69 MP) | 16 | `slow` | 16 Mbps | 20 Mbps | 40 Mbit |
| Custom | 16–26 | `medium`–`slow` | user | ≤40 Mbps | 2× cap |

Why 8 Mbps at 1080: YouTube's own guidance for 1080p SDR is around 8 Mbps, and
1080×1920 carries exactly the same 2.07 megapixels as 1920×1080, so the same budget
applies in both orientations. The 4:5 and 2:3 canvases carry about 1.5 MP and need
about 6 Mbps for the same perceptual quality at the same CRF.

Frame rate multiplies the budget: at 50 or 60 fps raise target and cap by 1.5×, or
the encode trades detail for motion. Do not raise it by 2×; inter-frame redundancy
does not scale linearly.

## Frame rate

- Match the source. 25 fps stays 25, 23.976 stays 23.976.
- Allowed families: 23.976/24, 25, 29.97/30, 50 and 59.94/60. Anything else is
  conformed at the segment stage, not at delivery.
- Never conform 24→30 or 25→30 to "make it smoother". Duplicated frames judder, and
  the destination re-times anyway.
- Mixed-rate sources take the rate of the majority of screen time; the rest are
  conformed with frame duplication, not optical flow.

## Loudness

| Profile | Integrated | True peak | Notes |
|---|---|---|---|
| `vertical-social` | −14 LUFS | −1.5 dBTP | Feed playback is loud and compressed |
| `feed-portrait` | −14 LUFS | −1.5 dBTP | Same as vertical |
| `pin` | −14 LUFS | −1.5 dBTP | Autoplays muted; loudness matters only after tap |
| `landscape` | −16 LUFS | −1.5 dBTP | YouTube normalises to about −14; −16 leaves headroom for the site player |

Mastering, ducking and two-pass `loudnorm` are `audio-restoration`'s job. Delivery
only verifies the result and blocks a file that is more than 1 LU from target.

## Encode command

```bash
ffmpeg -i composite.mov \
  -c:v libx264 -profile:v high -level 4.2 -pix_fmt yuv420p \
  -preset slow -crf 18 -maxrate 12M -bufsize 24M \
  -g 60 -keyint_min 60 -sc_threshold 0 -bf 2 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 320k -ar 48000 -ac 2 \
  -movflags +faststart \
  out.mp4
```

`-g 60` assumes 30 fps. Compute it as `2 × fps` and pass the value; a 60 fps file
with a 30-frame GOP has a keyframe every half second and doubles the bitrate for no
visible gain.

## Verification

```bash
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,profile,level,width,height,pix_fmt,r_frame_rate,color_space \
  -of json out.mp4
ffprobe -v error -show_entries format=duration,bit_rate -of json out.mp4
ffmpeg -hide_banner -nostats -i out.mp4 -af ebur128=peak=true -f null -
```

| Field | Expected |
|---|---|
| `codec_name` | `h264` |
| `profile` | `High` |
| `level` | matches the preset table for this resolution and rate |
| `width` × `height` | profile geometry, exact |
| `pix_fmt` | `yuv420p` |
| `color_space` | `bt709` |
| `r_frame_rate` | source rate, in the allowed set |
| `duration` | equals the variant target ±0.05 s |
| `bit_rate` | between target and cap |
| faststart | `moov` atom before `mdat` (`ffprobe -v trace` or a box scan) |
| integrated loudness | profile target ±1 LU |
| true peak | ≤ −1.5 dBTP |

## Source problems that look like preset problems

| Symptom | Real cause | Fix |
|---|---|---|
| Soft on YouTube, sharp locally | Source was 720p upscaled, or CRF too high | Cap the preset to the source; never upscale |
| Colours washed out, sky cyan | HDR (HLG/PQ) source tagged as SDR | Tone-map to bt709 at segment stage, then encode |
| Video sideways | Rotation metadata ignored | Apply rotation side data at ingest, then set SAR 1:1 |
| Banding in a ceiling or sky | 8-bit + `veryfast` + low bitrate | CRF 18, `slow`, add 1–2 Mbps to the cap |
| Audio drifts a frame by the end | VFR source, CFR output | Force CFR at the segment stage |
| Black or grey first frame | In-point sits on a fade; cover taken at 0.000 | Move the in-point past the fade; pick a cover after 0.2 s |
| Level warning from a destination | 1440p encoded at level 4.0 | Set level 5.0 for 1440p |
| 40 MB for 15 seconds | No `maxrate` cap | Add the VBV cap from the table |

## Custom guardrails

Custom exists for odd sources and hard destination caps, not for taste.

- Short side 720–2160. Below 720 the platform's own compression wins; above 2160 no
  destination accepts it.
- CRF 16–28. Below 16 the file triples for no visible gain; above 28 the encoder
  starts deleting detail in foliage and fabric.
- Allowed frame-rate families only: 23.976–24, 25, 29.97–30, 50, 59.94–60.
- The cap may not exceed 40 Mbps, and the level is derived, never hand-entered.
- Audio is always 48 kHz AAC 320 kbps, whatever the video settings.
- Loudness is always the profile target. "Louder for social" is not a custom option;
  it is a misunderstanding of normalisation.
- Aspect is never custom. If the user wants 1:1 or 4:3, the answer is a different
  format and a different profile conversation.
