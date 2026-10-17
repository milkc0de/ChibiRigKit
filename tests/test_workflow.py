# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
import importlib.util,json,subprocess,sys,tempfile,unittest,shutil,hashlib
from unittest.mock import patch
from pathlib import Path
from jsonschema import ValidationError,Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'template/workspace/toolbox'))
from validate_workflow import load_contract,check_rules,validate

class WorkflowTests(unittest.TestCase):
    def test_machine_contract_is_valid(self):
        contract=load_contract(ROOT/'template/workspace')
        self.assertEqual(contract['communication']['final'],'structured_json')
        self.assertEqual(contract['rules']['head']['interpolation'],'rounded-bilinear')
        self.assertEqual(contract['rules']['head']['endpoint_authoring'],'edit_center_and_each_of_eight_directions_independently')
        self.assertIn('Do not build the rig', ' '.join(contract['authoring']['reference_planning']))
        schema=json.loads((ROOT/'template/workspace/rig.workflow.schema.json').read_text())
        without_authoring=dict(contract);without_authoring.pop('authoring')
        with self.assertRaises(ValidationError):Draft202012Validator(schema).validate(without_authoring)
    def test_update_removes_only_unmodified_legacy_instructions(self):
        spec=importlib.util.spec_from_file_location('update_character',ROOT/'scripts/update-character.py')
        updater=importlib.util.module_from_spec(spec);spec.loader.exec_module(updater)
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            shutil.copytree(ROOT/'template/workspace',root,dirs_exist_ok=True)
            original=b'Unmodified shared instructions migrated to the workflow contract.\n'
            custom=b'Character-specific instructions: preserve my existing masks.\n'
            (root/'AUTO_RIG_TASK.md').write_bytes(original)
            (root/'GENERATE_REFERENCES_TASK.md').write_bytes(custom)
            profile=b'{"format":"ChibiRigHeadLayoutProfile","version":1}\n'
            (root/'head-layout.profile.json').write_bytes(profile)
            (root/'toolbox/author_head_layout.py').write_text('# Character-specific authoring tool\n')
            plan=(root/'rig.plan.json').read_bytes() if (root/'rig.plan.json').is_file() else b'{"parts":[]}'
            (root/'rig.plan.json').write_bytes(plan)
            with patch.dict(updater.OBSOLETE_SHARED_FILES,{'AUTO_RIG_TASK.md':hashlib.sha256(original).hexdigest()}):
                result=updater.update(root)
            self.assertEqual(result['removed'],['AUTO_RIG_TASK.md'])
            self.assertEqual(result['preserved_custom'],['GENERATE_REFERENCES_TASK.md'])
            self.assertFalse((root/'AUTO_RIG_TASK.md').exists())
            self.assertEqual((root/'GENERATE_REFERENCES_TASK.md').read_bytes(),custom)
            self.assertEqual((root/'head-layout.profile.json').read_bytes(),profile)
            self.assertEqual((root/'rig.plan.json').read_bytes(),plan)
            self.assertEqual(result['head_layout']['regenerate'],'toolbox/author_head_layout.py --apply')
            self.assertIn('authoring',load_contract(root))
    def test_measured_acceptance_fails_closed(self):
        rules=[{'path':'integrity','equals':'passed'},{'path':'checks','equals':1}]
        check_rules({'integrity':'passed','checks':1},rules)
        for report in [{'integrity':'passed'}, {'integrity':'failed','checks':1}, {'integrity':'passed','checks':True}]:
            with self.subTest(report=report),self.assertRaises(ValueError):check_rules(report,rules)
    def test_result_templates_and_file_directory_artifacts(self):
        template=ROOT/'template/workspace'
        schema=json.loads((template/'rig.result.schema.json').read_text())
        for file in (template/'templates/results').glob('*.json'):
            Draft202012Validator(schema).validate(json.loads(file.read_text()))
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name in ['rig.workflow.json','rig.workflow.schema.json','rig.result.schema.json']:shutil.copy2(template/name,root/name)
            (root/'work/masks').mkdir(parents=True);(root/'image.png').write_bytes(b'fixture')
            result={'status':'ready_for_validation','artifacts':['work/masks/','image.png'],'issues':[]}
            report=root/'report.json';report.write_text(json.dumps(result));validate(root,report='report.json')
            for path in ['work/missing/','../outside','.',str(root/'image.png'),'']:
                result['artifacts']=[path];report.write_text(json.dumps(result))
                with self.subTest(path=path),self.assertRaises((ValueError,ValidationError)):validate(root,report='report.json')
            (root/'escape').symlink_to(root.parent,target_is_directory=True)
            result['artifacts']=['escape/'];report.write_text(json.dumps(result))
            with self.assertRaises(ValueError):validate(root,report='report.json')
            # A reported folder is valid, but cannot replace a required output file.
            (root/'rig.plan.json').mkdir();result['artifacts']=['work/masks/'];report.write_text(json.dumps(result))
            with self.assertRaisesRegex(ValueError,'Missing required output: rig.plan.json'):validate(root,phase='rigging',report='report.json')
    def test_offline_app_server_integration(self):
        # Protocol/checkpoint integration only. Browser acceptance is separately tested in Chromium.
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td)
            result=subprocess.run([sys.executable,str(ROOT/'scripts/create-face-demo.py'),'--output',td],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            motion=json.loads((root/'motion.template.json').read_text())
            Draft202012Validator(json.loads((root/'motion.schema.json').read_text())).validate(motion)
            self.assertNotIn('data:image/',json.dumps(motion))
            report={'combinations':48,'motionFrames':16,'trailCheck':True,'basePreserved':True,'head':{'enabled':True,'directions':9,'randomSwayFrames':24},'motionIO':{'roundtrip':True,'pixelIdentical':True,'atomic':True,'legacyJSON':True,'rejectedImports':4}}
            # Stub only the browser process in this transport test; never label it a rendering test.
            (root/'toolbox/validate_runtime.cjs').write_text("require('node:fs').writeFileSync('checks/runtime-report.json',JSON.stringify("+json.dumps(report)+"));")
            command=['node',str(ROOT/'scripts/auto-rig.mjs'),'--character',td,'--python',sys.executable,'--codex-bin',str(ROOT/'tests/fixtures/fake-codex.mjs'),'--resume-thread','fixture-thread']
            result=subprocess.run(command,capture_output=True,text=True,timeout=90)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            checkpoint=json.loads((root/'work/codex-run.json').read_text())
            self.assertEqual(checkpoint['status'],'completed')
            self.assertEqual([p['phase'] for p in checkpoint['turns']],['rigging','review-1','review-2'])
            requests=[json.loads(s) for s in (root/'work/test-wire.jsonl').read_text().splitlines()]
            self.assertTrue(any(r['method']=='thread/resume' for r in requests))
            for req in (r for r in requests if r['method']=='turn/start'):
                task=json.loads(req['params']['input'][0]['text'])
                self.assertEqual(task['contract']['version'],1);self.assertTrue(task['resume'])
                self.assertEqual(task['instruction_source'],'rig.workflow.json#/authoring')
                self.assertIn('reference_planning',task['contract']['authoring'])
                self.assertEqual(req['params']['outputSchema']['required'],['status','artifacts','issues'])
                self.assertEqual(task['result_template']['status'],'ready_for_validation')
                self.assertIn('directory',task['artifact_contract']['kinds'])
            blocked=root/'work/blocked.json';blocked.write_text(json.dumps({'status':'blocked','artifacts':[],'issues':[]}))
            with self.assertRaises(ValueError):validate(root,report='work/blocked.json')
            malformed=root/'work/malformed.json';malformed.write_text(json.dumps({'status':'done'}))
            with self.assertRaises(ValidationError):validate(root,report='work/malformed.json')
            bad=json.loads((root/'work/phase-rigging.json').read_text());bad['artifacts']=['../outside.png'];blocked.write_text(json.dumps(bad))
            with self.assertRaises(ValueError):validate(root,report='work/blocked.json')

if __name__=='__main__':unittest.main()
