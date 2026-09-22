# ChibiRig Motion v1

Recommended filename: `take.chibimotion.json`. UTF-8 JSON, format identifier `ChibiRigMotion`, version `1`, time unit `seconds`. This is this player's original format; the player does not parse proprietary motion curves or parameter identifiers.

```json
{
  "format": "ChibiRigMotion",
  "version": 1,
  "timeUnit": "seconds",
  "duration": 1,
  "loop": false,
  "channels": ["headYaw", "headPitch", "headRoll", "mouthOpen"],
  "frames": [[0, 0, 0, 0, 0], [1, 15, 8, -3, 0.5]],
  "metadata": {"name": "Take 1", "source": "camera"}
}
```

Each frame is `[time, value for channel 0, ...]`. Interpolation is linear. Time starts exactly at zero, strictly increases, and ends at `duration`. Maximum duration: 3600 seconds; maximum frame count: 120001. A recording samples at up to 30 fps and preserves actual elapsed timestamps, including dropped inference frames. No raw video/audio is stored.

| Channel | Range / convention |
| --- | --- |
| headYaw | -90..90 degrees; positive moves toward screen right |
| headPitch | -90..90 degrees; positive looks upward |
| headRoll | -90..90 degrees; positive clockwise on screen |
| eyeLeft, eyeRight | 0 closed, 1 open; screen-side naming |
| gazeX, gazeY | -1..1; positive right / up |
| mouthOpen | 0..1 |
| mouthShape | -1..1; narrower / wider |
| bodyYaw, bodyPitch, bodyRoll | -90..90 degrees; positive right / up / clockwise |
| breath | 0..1 |
| browLeftX, browRightX, browLeftY, browRightY | -1..1; positive right / up |
| browLeftAngle, browRightAngle, browLeftShape, browRightShape | -1..1 |

Channels may be omitted; missing eyelids default to open and other values to zero. Unknown/duplicate channel names and invalid frame lengths/times/values are rejected before replacing the active clip. The JSON Schema describes the container; `runtime/motion_clip.js` also checks cross-field dimensions, per-channel ranges and monotonic timestamps.

Yaw/pitch/roll playback multipliers are independent, 0..3x. They do not rewrite recorded values. The rig still clamps head yaw/pitch to ±25° and roll to ±30°, and retains its authored 50% vertical deformation. Camera mirror/calibration are applied before recording; playback gains and artistic mesh limits are applied afterward.

Rig presets (`chibirigkit.motion`, `motion.schema.json`) are separate from recorded takes: they save per-character controls and authored placements, not captured time-series data.
