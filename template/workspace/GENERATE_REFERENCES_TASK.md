# One-image reference preparation

Input: `work/aligned/normal.png` and `character.config.json`. Read `reference.plan.schema.json` and `toolbox/generate_references.py`. Create `reference.plan.json` and full-canvas grayscale masks under `work/reference_masks/`. This is a planning phase: do not edit input/, work/aligned/, character.config.json or the generator itself, and do not build the rig yet.

Identify the visible eyes and mouth from the actual image. Create a tight mask for each feature including all eye whites, iris, lashes or the mouth interior/outline; exclude hair and unrelated skin. A 2-pixel cleanup margin is added by default. The normal source coordinate system is canonical.

For each eye, author a closed eyelid as a polyline with enough points for a smooth arc (typically 12-24 points). Keep the original tilt, asymmetry, corner positions and lash style. The closed line and optional `lashes` polylines must stay within the eye edit region. Choose stroke_width in source pixels. The generator can sample a dark source color automatically; specify line_color only when that sample would be wrong. The curve is a plausible inferred blink, not recovered hidden artwork.

For the mouth, give a subtle closed-mouth polyline that preserves its expression and tilt. Preserve surrounding facial features. Mark `already_closed: true` when the source feature is already closed; the generator keeps its current source art for that endpoint. Still provide a curve and width for schema consistency. A genuinely absent mouth may be `null`; do not invent anatomy. Eyes may be an empty array when none exist.

`flat_extra_masks` may remove brows or blush when those will be separate movable layers. Do not use this to erase huge areas of hair, body, clothing or the outer silhouette. Flat is a feature-free face reference; the rig still requires correct masks to keep independently moving parts out of the static base.

The local generator uses inpainting inside the selected regions only. If the skin is a uniform known color and inpainting would bleed a neighboring edge, set `skin_color: [R,G,B]` sampled from that character. Do not use default peach/white or character-specific fixed coordinates.

Provided flat/blink/mouth_closed inputs take precedence; only missing roles are generated. The orchestrator will generate them, preserve input hashes, align them by identity (they already share the normal canvas), attach a contact sheet, and start the full rigging phase. Report ambiguity briefly rather than pretending the inferred expressions are supplied artwork.
