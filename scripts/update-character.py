#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Update the shared runtime/validation contract, retaining a backup of replaced files."""
import argparse,shutil,json,hashlib
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[1]
FILES=['launchers/TRACKING_FILES.json', 'launchers/TRACKING_DOWNLOADS.json', 'licenses/mediapipe-LICENSE.txt', 'licenses/mediapipe-NOTICES.txt', 'runtime/player_sync.js', 'launchers/PLAYER_SERVER.py', 'launchers/START_SERVER.ps1', 'launchers/START_SERVER.cmd', 'launchers/START_SERVER.command', 'launchers/START_SERVER.sh', 'package.json', 'LICENSE.txt', 'runtime/recording.js', 'runtime/bundle.js', 'runtime/head_pose.js', 'toolbox/neck_checks.js', 'motion.schema.json', 'templates/results/reference-planning.json', 'templates/results/rigging.json', 'templates/results/review.json', 'templates/results/blocked.json', 'rig.workflow.json', 'rig.workflow.schema.json', 'rig.result.schema.json', 'runtime/index.template.html', 'runtime/project_io.js', 'runtime/background.js', 'toolbox/build_project.py', 'toolbox/head_pose.py', 'toolbox/import_head_poses.py', 'toolbox/rig_contract.py', 'rig.plan.schema.json', 'toolbox/validate_character.py', 'toolbox/validate_runtime.cjs', 'toolbox/head_checks.js', 'toolbox/motion_io_checks.js', 'toolbox/runtime_checks.js', 'toolbox/validate_workflow.py', 'runtime/expression_underpaint.js', 'runtime/tracking_worker.js', 'runtime/tracking.js', 'runtime/hair_player.js', 'runtime/hair_dynamics.js', 'runtime/tracking_core.js', 'runtime/output.js', 'runtime/capture_player.js', 'runtime/motion_clip.js', 'toolbox/render_player.py', 'chibimotion.schema.json', 'docs/chibirig-motion.md', 'docs/player-handoff.md', 'toolbox/player_output.py']
# Retire only the unmodified distributed instructions now merged into the JSON
# contract. Custom instructions belong to the character author and are retained.
OBSOLETE_SHARED_FILES={
    'AUTO_RIG_TASK.md':'3dfb702f50b65471482ad9c6293acd13d20efd05ba0661c5938f60bc0b4cd782',
    'GENERATE_REFERENCES_TASK.md':'20926f9eaa5c4f1e072a7e0a37767671294e6099e4316302580697f8d5bf5abe',
}
def update(folder):
    folder=Path(folder).resolve()
    if not (folder/'character.config.json').is_file():raise ValueError('Not a character workspace')
    backup=folder/'work/template-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');changed=[];removed=[];preserved_custom=[]
    # MEDIA_NOTICE.txt may be character-specific. Preserve an existing one,
    # but seed the generic notice for workspaces created before it existed.
    media_notice=folder/'MEDIA_NOTICE.txt'
    if not media_notice.exists():
        shutil.copy2(ROOT/'template/workspace/MEDIA_NOTICE.txt',media_notice);changed.append('MEDIA_NOTICE.txt')
    files=FILES
    for name in files:
        source=ROOT/'template/workspace'/name;target=folder/name
        if target.exists() and target.read_bytes()==source.read_bytes():continue
        if target.exists():
            saved=backup/name;saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,saved)
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);changed.append(name)
    for name,digest in OBSOLETE_SHARED_FILES.items():
        target=folder/name
        if not target.is_file():continue
        if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
            preserved_custom.append(name);continue
        target.unlink();removed.append(name)
    profile=folder/'head-layout.profile.json'
    head_layout={'profile':'head-layout.profile.json','preserved':True,'regenerate':'toolbox/author_head_layout.py --apply'} if profile.is_file() and (folder/'toolbox/author_head_layout.py').is_file() else None
    return {'updated':changed,'removed':removed,'preserved_custom':preserved_custom,'backup':str(backup) if backup.exists() else None,'head_layout':head_layout,'rebuild':'toolbox/build_project.py'}
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--character',required=True);args=ap.parse_args();print(json.dumps(update(args.character),ensure_ascii=False))
