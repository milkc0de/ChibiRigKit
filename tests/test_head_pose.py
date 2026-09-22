# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
import importlib.util,json,subprocess,sys,tempfile,unittest
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

if __name__=='__main__':unittest.main()
