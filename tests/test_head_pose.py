# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
import copy,hashlib,importlib.util,json,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('head_pose_contract',ROOT/'template/workspace/toolbox/head_pose.py');head=importlib.util.module_from_spec(spec);spec.loader.exec_module(head)

class HeadPoseTests(unittest.TestCase):
    def test_direction_weights_and_continuity(self):
        for name,(x,y) in head.DIRECTIONS.items():
            w=head.pose_weights(x,y);self.assertEqual(w[name],1);self.assertEqual(sum(w.values()),1)
        for x in np.linspace(-1,1,33):
            for y in np.linspace(-1,1,33):
                w=head.pose_weights(x,y);self.assertAlmostEqual(sum(w.values()),1);self.assertTrue(all(v>=0 for v in w.values()))
        self.assertEqual(head.pose_weights(.5,-.5)['up_right'],.25)
    def test_folded_mesh_is_rejected(self):
        bounds={'x':0,'y':0,'w':100,'h':100}
        self.assertTrue(head.valid_mesh(bounds,{},2,2))
        points=[[0,0] for _ in range(9)];points[4]=[200,0]
        self.assertFalse(head.valid_mesh(bounds,{'vertices':points},2,2))
        with self.assertRaises(ValueError):head.validate_setting({'scale_x':0},9)

    def test_rounded_import_weights_match_runtime_near_joins_and_limits(self):
        coordinates=[(x,y) for x in [-1.2,-1,-.999,-.95,-.9,-.1,-.05,-.001,0,.001,.05,.1,.5,.9,.95,.999,1,1.2] for y in [-1,-.95,-.05,0,.05,.95,1]]
        script="""const fs=require('node:fs'),vm=require('node:vm');const context=vm.createContext({PROJECT:{},structuredClone,crypto:{getRandomValues:a=>a}});vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);process.stdout.write(JSON.stringify(JSON.parse(process.argv[2]).map(([x,y])=>context.headWeights(x,y))));"""
        result=subprocess.run(['node','-e',script,str(ROOT/'template/workspace/runtime/head_pose.js'),json.dumps(coordinates)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        for point,runtime in zip(coordinates,json.loads(result.stdout)):
            weights=head.pose_weights(*point)
            for name in head.DIRECTIONS:self.assertAlmostEqual(weights[name],runtime[name],places=14,msg=f'{point}/{name}')

    def test_expression_layer_import_uses_its_owner_lattice(self):
        parts={
            'eye':{'role':'eye','kind':'normal','x':20,'y':20,'w':100,'h':100,'sha256':'eye'},
            'iris':{'role':'eye','kind':'eye_iris','x':55,'y':50,'w':10,'h':10,'sha256':'iris','transform_from':'eye'},
        }
        offsets=[[0,0],[-50,0],[0,0],[-50,0]]
        poses={name:{'parts':{'iris':{'vertices':copy.deepcopy(offsets)}}} for name in head.DIRECTIONS}
        result=head.build_head_pose({'head_pose':{'columns':1,'rows':1,'poses':poses}},parts,{'width':200,'height':200})
        self.assertEqual(result['poses']['left']['parts']['iris']['vertices'],offsets)
        self.assertTrue(head.valid_mesh(parts['eye']['head_bounds'],{'vertices':offsets},1,1))
        self.assertFalse(head.valid_mesh(parts['iris']['head_bounds'],{'vertices':offsets},1,1))

    def test_neck_import_rejects_folded_endpoint_and_collapsing_interpolation(self):
        parts={'face':{'role':'face','kind':'normal','x':40,'y':30,'w':100,'h':120}}
        baseline=head.build_neck_sway({},parts,{'width':240,'height':300})
        bad=copy.deepcopy(baseline);bad['poses']['left']['vertices'][0]=bad['poses']['left']['vertices'][1]
        with self.assertRaisesRegex(ValueError,'fold'):
            head.build_neck_sway({'neck_sway':bad},parts,{'width':240,'height':300})
        bad=copy.deepcopy(baseline);pivot=bad['pivot']
        for name,sign in [('center',-1),('left',1)]:
            bad['poses'][name]['vertices']=[[pivot['x']-sign*(y-pivot['y']),pivot['y']+sign*(x-pivot['x'])] for x,y in bad['mesh']['points']]
        for name in ['center','left']:
            points=np.asarray(bad['poses'][name]['vertices'])
            for i,j,k in bad['mesh']['triangles']:
                u=points[j]-points[i];v=points[k]-points[i];self.assertGreater(u[0]*v[1]-u[1]*v[0],.0001)
        with self.assertRaisesRegex(ValueError,'fold'):
            head.build_neck_sway({'neck_sway':bad},parts,{'width':240,'height':300})

    def test_sample_profile_is_absolute_repeatable_and_preserves_sources_and_attachment(self):
        sample=ROOT/'characters/milkc0de';script=sample/'toolbox/author_head_layout.py'
        spec=importlib.util.spec_from_file_location('sample_head_authoring',script);authoring=importlib.util.module_from_spec(spec);spec.loader.exec_module(authoring)
        project=json.loads((sample/'rig.project.json').read_text());plan=json.loads((sample/'rig.plan.json').read_text());profile=json.loads((sample/'head-layout.profile.json').read_text())
        before=json.dumps([project,plan],sort_keys=True)
        candidate,candidate_plan=authoring.author(profile,project,plan)
        repeated,repeated_plan=authoring.author(profile,candidate,candidate_plan)
        self.assertEqual(candidate,repeated);self.assertEqual(candidate_plan,repeated_plan)
        self.assertEqual(json.dumps([project,plan],sort_keys=True),before)
        self.assertEqual(candidate['parts'],project['parts'])
        self.assertEqual(candidate['head_pose']['pose_space'],profile['pose_space'])
        self.assertEqual(candidate['neck_sway']['layout_mode'],'authored-25-v1')
        endpoint_fingerprints={json.dumps([candidate['head_pose']['poses'][name],candidate['neck_sway']['poses'][name]],sort_keys=True) for name in head.DIRECTIONS}
        self.assertEqual(len(endpoint_fingerprints),9)
        source=np.asarray(candidate['neck_sway']['mesh']['points']);pinned=source[:,1]>=profile['attachment_band']['end_y']
        self.assertGreater(int(pinned.sum()),0)
        for pose in candidate['neck_sway']['poses'].values():self.assertTrue(np.array_equal(np.asarray(pose['vertices'])[pinned],source[pinned]))

        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            clone=Path(td)/'character'
            shutil.copytree(sample,clone,ignore=shutil.ignore_patterns('checks','eight-direction','eight-direction-original','player','generated_references','index.html','runtime-check.html','__pycache__'))
            def source_hashes():
                return {str(path.relative_to(clone)):hashlib.sha256(path.read_bytes()).hexdigest() for folder in ['input','work/aligned'] for path in (clone/folder).rglob('*') if path.is_file()}
            hashes=source_hashes();snapshots=[]
            self.assertFalse((clone/'work/eight-direction-original').exists())
            for _ in range(2):
                result=subprocess.run([sys.executable,str(clone/'toolbox/author_head_layout.py'),'--apply'],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                shutil.rmtree(clone/'work/eight-direction-original')
                result=subprocess.run([sys.executable,str(clone/'toolbox/build_project.py')],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                built=json.loads((clone/'rig.project.json').read_text())
                snapshots.append({'head_pose':built['head_pose'],'neck_sway':built['neck_sway']})
                self.assertEqual(source_hashes(),hashes)
                self.assertEqual({pid:p['sha256'] for pid,p in built['parts'].items()},{pid:p['sha256'] for pid,p in project['parts'].items()})
            self.assertEqual(snapshots[0],snapshots[1])
    def test_sclera_underpaint_preserves_surroundings(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td);source=Image.new('RGBA',(20,20),'#fff8f0');d=ImageDraw.Draw(source);d.ellipse((7,6,13,14),fill='#332244')
            white=Image.new('L',source.size);ImageDraw.Draw(white).ellipse((2,2,18,18),fill=255)
            iris=Image.new('L',source.size);ImageDraw.Draw(iris).ellipse((7,6,13,14),fill=255);iris.save(root/'iris.png')
            result,color=head.fill_sclera(root,{'id':'white','iris_part':'iris'},{'iris':{'mask':'iris.png'}},source,white)
            self.assertEqual(color,[255,248,240]);a=np.array(source);b=np.array(result);mask=np.array(iris)>0
            self.assertTrue(np.array_equal(a[~mask],b[~mask]));self.assertTrue(np.all(b[mask,:3]==color))
            Image.new('L',source.size,255).save(root/'iris.png')
            with self.assertRaises(ValueError):head.fill_sclera(root,{'id':'white','iris_part':'iris'},{'iris':{'mask':'iris.png'}},source,white)
    def test_neck_membership_and_pivot_validation(self):
        parts={k:{'role':role,'kind':'normal','x':10,'y':20,'w':80,'h':100} for k,role in [('face','face'),('hair','hair'),('eye','eye'),('body','torso'),('bow','ribbon')]}
        parts['bow']['head']=True
        result=head.build_neck_sway({},parts,{'width':200,'height':300})
        self.assertEqual(result['pivot'],{'x':50,'y':120})
        self.assertEqual(set(result['part_ids']),{'face','hair','eye','bow'})
        self.assertEqual(result['anchor_part'],'face')
        for pivot in [{'x':float('nan'),'y':20},{'x':-1,'y':20},{'x':20},{'x':True,'y':20}]:
            with self.assertRaises(ValueError):head.build_neck_sway({'neck_sway':{'pivot':pivot}},parts,{'width':200,'height':300})

    def test_demo_build_and_pose_import_roundtrip(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'work') as td:
            root=Path(td)
            result=subprocess.run([sys.executable,str(ROOT/'scripts/create-face-demo.py'),'--output',td],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            project=json.loads((root/'rig.project.json').read_text());poses=project['head_pose'];self.assertEqual(len(poses['poses']),9)
            self.assertEqual(project['parts']['left_iris']['transform_from'],'left_sclera')
            self.assertEqual(project['parts']['face']['mesh']['type'],'face_grid')
            poses['poses']['left']['parts']['face']['x']=-12.5
            file=root/'head-poses.json';file.write_text(json.dumps(poses))
            command=[sys.executable,str(root/'toolbox/import_head_poses.py'),'--file',str(file)]
            result=subprocess.run(command,capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
            result=subprocess.run([sys.executable,str(root/'toolbox/build_project.py')],capture_output=True,text=True);self.assertEqual(result.returncode,0,result.stderr)
            rebuilt=json.loads((root/'rig.project.json').read_text());self.assertEqual(rebuilt['head_pose']['poses']['left']['parts']['face']['x'],-12.5)
            poses['layout_signature']='wrong';file.write_text(json.dumps(poses));result=subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            poses['layout_signature']=rebuilt['head_pose']['layout_signature'];poses['pose_space']='stale'
            file.write_text(json.dumps(poses));result=subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(json.loads((root/'rig.plan.json').read_text())['head_pose'].get('pose_space'),rebuilt['head_pose'].get('pose_space'))

if __name__=='__main__':unittest.main()
