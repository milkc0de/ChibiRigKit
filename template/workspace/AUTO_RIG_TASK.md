# Generic 2D character auto-rig task

You are the automatic rig architect for ChibiRigKit. Finish the rig in this workspace; do not merely describe a plan.

## Required inputs
Read `character.config.json` and the aligned images under `work/aligned/`:
- `normal.png`: complete normal character image.
- `flat.png`: reference/base image when supplied. It may have a blank face, simpler clothes, or static body areas.
- `blink.png`: full blink/closed-eye reference when supplied.
- `mouth_closed.png`: optional exact closed-mouth reference.

The original files under `input/` and `work/aligned/` are immutable. Never edit them.

## Required output
You must create:
1. `rig.plan.json` conforming to `rig.plan.schema.json`.
2. Full-canvas PNG masks under `work/masks/` for every part.
3. Run `python3 toolbox/build_project.py` to create `rig.project.json`, `work/player/index.html`, `assets/layers`, and `assets/masks`; the builder also writes the final HTML and ZIP under the kit root `dist/` and records paths in `work/player-output.json`.
4. Run `python3 toolbox/validate_character.py` and inspect `checks/validation_sheet.png` plus the source images.
5. Correct masks/plan and rebuild until the rig is coherent.

## Core 2D mesh process
Treat this as a reusable version of a layer-based 2D decomposition, not a one-off cropper.

- The flat/base layer is the static substrate. Keep static skin/blush and appropriate static clothing there.
- Moving limbs or parts that will be independently animated should not remain visibly duplicated on the static base.
- Reconstruct the normal character by placing normal-source parts back at the same registered coordinates.
- Open eyes come from `normal`; include eyeball, sclera and eyelashes together.
- Closed/blink eyes come from `blink`; preserve their original full-color source pixels and original registered position. They are normally hidden.
- During blink, the open-eye mesh deforms toward the closed-eye line/curve. Only at near-full closure does the closed-eye art fade on top. Opening is the reverse.
- Never convert closed eyes into artificial solid black blobs.
- Cheek blush belongs on the static face/base unless the character design clearly requires animated blush. Do not let cheek blush contaminate eye masks.
- If `mouth_closed` exists, use it as the exact mouth-closed endpoint. Otherwise derive mouth states from available inputs without including surrounding face skin.

## Semantic target decomposition
Choose counts based on the character, within `character.config.json` target ranges. Typical minimum structure:
- hair: 3–7 parts (back left/right, bangs, side hair as appropriate)
- large ribbon/accessory: separate part when present
- arms: 2–6 total pieces
- torso/body: 2–6 pieces
- skirt/coat lower garment: 1–5 pieces
- legs: 2–6 total pieces
- face base, ears when useful
- left/right open eye, left/right drawn closed eye
- mouth open / mouth closed / smile when available
- brows if visible

Do not invent parts that do not exist in the source. Do not force symmetry when the art is asymmetric.

## Mask quality rules
- Masks must follow actual silhouettes, not broad rectangles.
- Intentional 3–12 px overlap at joints is good; large unrelated contamination is not.
- Hair masks may include their own ornaments, but must not include eyes, cheeks, face skin, clothing, or neighboring limbs.
- Eye masks must include the full lashes but exclude cheeks/hair/skin outside the eye region.
- Closed-eye patches should be tight enough to avoid cheek blush but large enough to preserve the eyelid line and nearby antialiasing.
- Limbs must not contain the opposite limb/shoe.
- Preserve original pixel colors; masks select pixels, they do not recolor source art.

## Mesh rules
Every independently moving part should have a mesh entry.
- open eyes: `blink_eye_radial`; set `close_center_y_local` or radial `close_curve` based on the blink reference.
- hair/ribbon/skirt: `bend_vertical` with 6–12 slices and a small `amp_px`.
- arms/legs/torso: `soft_body` with 5–10 slices, subtle deformation.
- mouth/brows/face: `soft_strip` unless a more specific mouth mesh is used.
- static base may be unmeshed.

Keep motions subtle by default. The browser UI lets the user increase amount/speed later.

## Layering
`draw_order` must be back-to-front. Closed-eye art must render after open-eye art so the final swap is exact. Facial expression parts should not be hidden under front hair unless the source actually does so.

## Automatic validation
After each build, inspect:
- `checks/open_rebuild.png` and `checks/open_diff.png`
- `checks/blink_rebuild.png` and `checks/blink_diff.png` when blink exists
- `checks/validation_sheet.png`

The metric is only a clue. Use visual judgment. Specifically look for duplicated limbs, transparent holes, cheek contamination, hair/clothing contamination, eye position shifts, missing lashes, and seams exposed by independent motion.

## Safety against over-editing
Never touch source images. Prefer the smallest mask fix that solves a visible error. Preserve already-correct parts across review passes.

## Lessons enforced from v14

- `normal` is the canonical canvas; read `work/registration.json` and visually inspect `work/source_montage.png`. Bounding-box alignment is a fallback, not evidence of accurate registration. Closed-mouth registration must use unchanged hair/eye features rather than the mouth itself.
- Every open eye with drawn closed art must name it via `closed_part`. Pair its pivot, motion and parent through the builder; do not animate the closed endpoint independently. Supply the actual closed-eye curve in absolute registered canvas coordinates. The default straight line is only an initial estimate.
- Use `mouth_open_close` and `closed_part` for open mouths. For a smile, set `transform_from` to the ordinary open mouth and share the same closed endpoint. Set closed_slope from the art, never a character-specific constant. Mouth controls must remain independent of manual eye controls.
- Blush may be a tight independent pigment mask in the face group. It must not disappear on blink/smile. Do not include rectangular skin patches, hair or eye edges in it.
- Inspect `checks/base_only.png`: fixed base must omit independently moving hair, ornaments, arms, legs, shoes and ribbons. Keep only the intended stationary substrate. Missing hidden material is not a reason to leave duplicated moving parts on the base.
- Inspect all limbs separately: preserve toes, sock silhouettes and asymmetric art, while excluding the opposite shoe/limb. Inspect hair for face-skin islands and clothing frills.
- Optional `texture_repair` selects a prepared full-canvas RGBA image with an explicit grayscale mask. Changes stay inside the part mask. Do not recolor unrelated pixels or overwrite input/aligned sources.
- Optional `seam` likewise selects prepared margin pixels with a full-canvas region mask. Restrict leg masks to joints/knees, not shoe tips. Supply sufficient part pad (at most 64 pixels). The runtime uses the same part mesh/transform and current-frame silhouette, with no runtime model calls. Do not introduce global blur, stale frames, or inference queues. LaMa generation is not bundled with this template.
- Run `node toolbox/validate_runtime.cjs` after the Python checks. Inspect `checks/runtime_sheet.png` (16 motion poses, intensity 4), plus the static reconstruction and base-only image. `runtime-check.html` runs the same assertions interactively when diagnosing browser launch problems.
- Do not report completion from a low static image error alone. State which browser checks passed and which visual judgments remain uncertain. Source integrity, draw-order integrity, paired endpoints, actual mesh geometry and HTML/project-data equality must all hold.


## Authored head turns (front + eight directions)

- Split the face skin into its own `role: face`, `head: true`, `mesh: {type: face_grid}` layer. Do not leave the eyes/mouth/hair baked into the skin. Keep the stationary torso out of this layer.
- Prefer independent `eye_sclera`, `eye_iris`, and optional `eye_line` components for each eye. The sclera mask covers the full eyeball aperture including the area behind the iris. The iris mask fits inside it and preserves the actual colored iris/pupil/highlight. Do not try to divide eyes with arbitrary rectangles.
- Set `iris_part` and `closed_part` on eye_sclera; set `clip_to` on iris and eye_line to the corresponding sclera. Put sclera, iris and line before the drawn closed eye in draw_order. Runtime clips the moving iris to the posed sclera and gives all open components the same blink deformation.
- The builder underpaints only the area hidden by the original iris to avoid a second stationary pupil. It samples bright visible sclera, or accepts explicit `sclera_fill: [r,g,b]` when the design has colored/nonwhite sclera. This is a derived layer; never modify input/aligned sources.
- Include head-attached hair/accessories with `head: true`, exclude clothing/body using `head: false`. Head part bounds receive a 4x4 grid by default. `head_pose.columns/rows` may be 1..8.
- The builder provides suggested front/left/right/up/down/up_left/up_right/down_left/down_right placements. These are starting points, not approved or optimal art. Inspect all nine renders, especially far-eye width, iris centering, face outline, nose/mouth placement, and hair coverage.
- Head-pose coordinates use screen directions: X negative left, Y negative up. Per-part x/y, rotation, scale_x/y and vertices are authored independently at nine anchors, then blended with continuous bilinear weights. The editor lets the user choose the best-looking anchor, drag mesh points, save locally and export/import head-poses.json.
- Browser-saved poses do not silently overwrite rig.plan.json. Import them with `python toolbox/import_head_poses.py --file /path/to/head-poses.json`, then rebuild. Asset/layout mismatches and folded meshes must fail.
- This is a front-facing 2D deformation range, not a 360-degree 3D head. Full profile/back-of-head views need additional source artwork.

- Keep existing hair/body/limb sway active with random head motion. `head_pose.autoplay` defaults to true. Circle playback is for previewing pose transitions, not the default idle motion. Review both the nine-direction sheet and random-plus-sway checks.

## Nine reference layouts before animation
First finish the center plus eight yaw/pitch layouts as still images. Individually arrange the face contour, both eyes, mouth, brows, scalp, bangs, back hair and head accessories for each direction. A uniformly translated or projected copy is only a draft. Inspect a nine-image contact sheet, correct every direction, and save the per-part placements in `neck_sway.poses`. Then attach these finished layouts to the shared whole-head parent mesh and interpolate between their saved vertices. Roll is an additional rotation around the pinned neck. Preserve normal and closed eye/mouth alignment. The generic suggestions are not visual acceptance; report remaining visual defects explicitly. Do not require any particular sample character as input or reference.


## Player handoff and nine-direction review (2026-09)

Follow `rig.workflow.json` rules.head and rules.player_handoff and `docs/player-handoff.md`.
- Author new reference layouts at yaw/pitch -25/0/+25 degrees. Reduce vertical deformation to about 50% initially; preserve existing authored angle metadata until explicitly reauthoring. Do not merely relabel old endpoints.
- Vary apparent size and proportions to suit the drawing. In side views inset the far eye from both hair and face outline. Review diagonal back-head volume, cheek and chin direction, and the moving mouth and eyebrows.
- Move the mouth toward the facing direction (positive yaw = screen right); upward pitch raises the mouth. Move the whole chin; do not leave a single pinned vertex inside the chin. Inspect the upper three directions for a line or tear at the neck. Any hidden-skin repair is a derived masked layer, never a rewrite of input art.
- Head hair follows the common head mesh. For long back hair use head-attached roots with gravity, spring and damping toward the tips; do not copy character-specific coordinates or assets from the sample.
- Export the normal self-contained HTML/ZIP with projectData and bundleSnapshot. The parent browser player opens the selected character workspace directly. Do not add player-file import or Electron. ZIPs and character outputs are ignored generated artifacts, not the implementation source.
- Use the existing camera/audio/motion/output runtime. Do not create OBS, virtual camera drivers, native Swift windows, executable packaging, automatic device startup, or network broadcast. Camera and microphone require an explicit Start action. Desktop popup output and Electron have been removed. Keep drag-to-select cropping for WebM recording.
- Independent yaw/pitch/roll playback gains must include zero. Record the original channels; gains affect display, not the saved motion. ChibiRigMotion v1 is separate from the rig-settings motion preset.
- Preserve MIT notices and third-party component licenses. Do not initiate commits or publication unless separately requested.

Final exported HTML/assets belong in the kit root `dist/<character>/`; ZIP belongs in `dist/<character>.zip`. Do not put new completed exports beside the character workspace. The intermediate preview is `work/player/index.html`. Preserve existing older exports unless the user asks to remove them.

Tracking controls: lock only the input/camera/microphone selectors while media starts or runs; unlock on stop/failure. Keep eye/gaze, mouth and head opt-out switches available for camera modes, including head. Microphone-only mode requires mouth input and disables that opt-out. Retain loaded motion clips during live input. Each opted-out region uses a currently playing file, otherwise ordinary animation; paused files must not override ordinary animation while tracking.

The generated player and completed HTML document title must be `<character name> - ChibiRigKit`, with the character name HTML-escaped. The kit root GitHub Pages landing page has its own title.

## Permissions and private output

Work within the character workspace with local tools and the installed dependencies. Do not request unrestricted execution, network access, session-wide approvals, publishing, or commits. The parent app-server client allows workspace writes and local commands; permission expansion is denied. Model communication through Codex is separate from shell network access.

Use the task input's `execution.environment` for every build/validation command. Local app-server processes inherit it; when connecting to an existing server, explicitly set those environment variables in commands. `CHIBIRIG_DIST_ROOT` points to `work/agent-output` while the agent works. The parent orchestrator validates the result and writes final artifacts to the kit's `dist` afterward. This avoids granting the agent write access to other characters or the parent project. Temporary files belong in `work/agent-tmp`.

Completed HTML playback, editing, and WebM recording require no Internet connection. Tracking works offline after the local SDK/model setup. Initial setup and Codex rig creation require Internet access. Do not add external fonts, analytics, CDNs, or automatic device startup. Exports must strip device identifiers/names, local paths, transient UI messages and capture metadata; captured motion is excluded unless explicitly selected for inclusion.
