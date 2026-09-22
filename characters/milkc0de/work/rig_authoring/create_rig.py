# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Rebuild the vision-authored milkc0de masks and plan. Source images are immutable.
All coordinates are in normal.png; left/right names are viewer-relative.
"""
from pathlib import Path
import sys,json,math
import numpy as np
import cv2
from PIL import Image,ImageDraw
def distance_transform_edt(mask,return_indices=True):
    distance,labels=cv2.distanceTransformWithLabels(mask.astype('uint8'),cv2.DIST_L2,5,labelType=cv2.DIST_LABEL_PIXEL)
    yy,xx=np.where(~mask)
    lut=np.zeros((len(yy)+1,2),dtype=np.int32)
    lut[labels[yy,xx]]=np.column_stack([yy,xx])
    indices=lut[labels].transpose(2,0,1)
    return distance,indices
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'toolbox'))
from rig_contract import verify_sources
from refine_masks import refine_face,refine_character,grab,kernel
verify_sources(ROOT)
W,H=1152,1366
normal=np.array(Image.open(ROOT/'work/aligned/normal.png').convert('RGBA'))
ref=json.loads((ROOT/'reference.plan.json').read_text())
manifest=json.loads((ROOT/'work/generated_references/manifest.json').read_text())
OUT=ROOT/'work/masks';OUT.mkdir(exist_ok=True,parents=True)
PATCH=ROOT/'work/rig_authoring';PATCH.mkdir(exist_ok=True,parents=True)
raw={};meta={}

def poly(points,smooth=True):
 p=np.array(points,dtype=float)
 if smooth:
  q=[]
  for i in range(len(p)):
   a,b,c,d=[p[k%len(p)] for k in (i-1,i,i+1,i+2)]
   for t in np.linspace(0,1,max(3,int(np.linalg.norm(c-b)/3)),endpoint=False):
    q.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t**3))
  p=np.array(q)
 im=Image.new('L',(W,H));ImageDraw.Draw(im).polygon([tuple(v) for v in p],fill=255)
 return np.array(im)>0

def region(name,pts,role,pivot,head=False,holes=(),smooth=True):
 m=poly(pts,smooth)
 for hole in holes:m&=~poly(hole)
 raw[name]=m;meta[name]={'role':role,'pivot':pivot,'head':head}

# Independent rear locks. Loops are genuine background windows, not opaque hair.
region('hair_back_left',[(298,514),(344,558),(398,607),(394,674),(350,718),(321,781),(363,849),(377,881),(351,894),(330,889),(310,902),(267,909),(227,895),(214,865),(189,867),(161,854),(142,844),(115,837),(98,816),(98,785),(120,746),(118,713),(105,691),(113,661),(141,632),(185,603),(230,573),(268,548)],'hair',[319,543],True,holes=[[(224,855),(240,868),(257,880),(274,882),(279,870),(262,852),(247,847),(236,849)],[(138,769),(126,790),(124,808),(139,819),(157,821),(151,804)],[(153,674),(139,688),(140,710),(151,731),(167,714),(181,695),(196,675),(213,653),(226,638),(190,650)],[(232,760),(219,788),(244,769),(267,751),(290,728),(304,706),(275,726)]])
region('hair_back_right',[(783,451),(829,435),(868,475),(902,523),(941,565),(971,601),(1007,627),(1030,658),(1044,691),(1038,716),(1014,733),(990,736),(1019,764),(1040,798),(1039,834),(1021,858),(1043,892),(1040,924),(1024,944),(999,954),(971,951),(947,964),(914,968),(885,959),(869,982),(849,1005),(819,1008),(790,994),(776,974),(776,951),(753,966),(731,968),(704,954),(695,931),(708,901),(731,866),(754,818),(770,761),(759,710),(747,660),(761,596)],'hair',[802,489],True,holes=[[(895,510),(931,552),(952,601),(967,649),(965,680),(949,700),(929,702),(907,688),(898,659),(887,604),(880,548)],[(989,767),(1005,790),(1009,813),(1000,828),(991,836),(989,810)],[(1008,871),(1024,902),(1021,923),(1000,939),(983,942)],[(909,916),(897,941),(920,946),(944,939),(957,927)],[(818,949),(806,973),(817,986),(839,987),(856,977),(858,951),(846,962),(831,963)],[(747,904),(730,932),(738,945),(756,937),(770,912)],[(794,823),(814,847),(826,876),(817,890),(801,891),(796,869)],[(867,840),(891,867),(883,889),(870,870)]])
# The complete cap is partitioned below into cap, bangs, and two side locks.
region('hair_cap',[(220,313),(226,271),(252,224),(288,179),(333,139),(388,102),(444,76),(498,54),(545,42),(595,41),(639,55),(672,54),(711,63),(752,85),(787,114),(819,153),(844,203),(855,240),(853,284),(860,327),(876,359),(875,396),(858,436),(837,492),(809,547),(776,592),(731,626),(684,649),(655,644),(690,610),(714,579),(735,539),(752,476),(743,430),(722,376),(674,338),(622,305),(562,282),(501,275),(446,285),(407,319),(375,365),(349,415),(342,460),(343,506),(365,536),(392,557),(418,576),(409,581),(382,576),(355,561),(332,544),(310,529),(299,491),(298,447),(283,408),(265,387),(247,422),(230,453),(217,468),(196,462),(181,445),(179,425),(191,389),(215,352)],'hair',[566,232],True,holes=[[(240,348),(227,379),(214,411),(206,438),(217,452),(232,454),(247,427),(267,396),(269,373),(254,355)]])
# Cowlick loop is a separate mesh, retaining the hole inside it.
region('hair_cowlick',[(496,51),(531,25),(567,12),(606,11),(634,24),(649,47),(648,64),(633,81),(624,79),(633,61),(630,43),(609,29),(582,25),(552,32),(528,44)],'hair',[625,73],True,holes=[[(516,47),(550,31),(581,25),(609,30),(625,44),(628,54),(606,45),(573,41),(545,44)]])
# Face skin follows exposed hair boundaries, includes ear, and retains static cheek pigment.
region('face_skin',[(500,234),(482,273),(475,320),(470,356),(472,391),(489,419),(516,438),(546,443),(568,440),(590,445),(606,389),(616,346),(630,320),(641,358),(653,398),(669,432),(701,470),(721,490),(743,535),(754,555),(750,582),(729,603),(701,612),(675,610),(646,607),(615,617),(568,622),(518,622),(477,615),(437,601),(402,583),(374,560),(355,535),(341,508),(337,474),(342,433),(354,392),(377,346),(410,302),(446,263)],'face',[547,560],True)
region('hair_side_left',[(363,302),(347,353),(332,400),(330,455),(344,493),(370,513),(353,508),(326,490),(314,461),(314,497),(332,532),(353,552),(387,574),(405,580),(380,582),(389,606),(377,623),(350,631),(327,610),(310,577),(297,548),(273,540),(247,521),(235,498),(243,467),(258,435),(276,393),(308,343)],'hair',[320,368],True,holes=[[(257,465),(249,492),(254,512),(271,523),(286,523),(279,502),(275,481)],[(287,459),(278,489),(289,521),(300,535),(303,518),(297,490)]])
region('hair_side_right',[(753,267),(794,272),(823,306),(833,346),(820,402),(805,463),(791,523),(774,571),(752,599),(720,620),(684,634),(658,634),(677,620),(695,603),(700,588),(674,599),(649,599),(629,592),(612,583),(636,583),(664,570),(686,550),(705,521),(718,482),(723,442),(721,401),(716,363),(731,316)],'hair',[792,348],True)
region('hair_bangs',[(512,183),(551,137),(593,111),(627,100),(658,114),(678,150),(697,194),(711,241),(723,286),(722,330),(720,374),(714,414),(704,445),(690,455),(673,436),(660,412),(648,376),(637,341),(632,314),(620,335),(610,370),(600,405),(599,429),(588,443),(569,446),(548,443),(529,434),(510,420),(499,401),(491,373),(492,334),(496,301),(499,270),(507,221)],'hair',[594,181],True)
region('ribbon_head',[(839,281),(851,245),(875,226),(895,221),(913,243),(944,239),(967,242),(977,251),(972,282),(963,311),(966,343),(971,365),(966,375),(947,378),(923,369),(926,390),(943,416),(964,447),(982,473),(967,486),(944,503),(928,509),(946,537),(970,576),(986,617),(978,621),(951,615),(930,615),(913,593),(882,589),(863,582),(855,548),(849,511),(844,467),(846,426),(850,387),(855,352),(845,335),(832,314)],'ribbon',[864,310],True)
# Character body and actual asymmetric limbs.
region('leg_back_right',[(522,979),(577,972),(636,975),(633,1003),(618,1029),(636,1030),(650,1024),(660,1040),(679,1044),(684,1068),(671,1075),(686,1105),(707,1134),(715,1163),(713,1202),(702,1233),(683,1252),(655,1264),(625,1263),(610,1252),(603,1233),(606,1203),(609,1174),(600,1147),(572,1117),(548,1092),(527,1075),(514,1045),(512,1014)],'leg',[551,1000])
region('leg_front_left',[(451,998),(490,987),(523,1003),(521,1041),(537,1072),(544,1108),(550,1146),(563,1182),(580,1205),(592,1231),(607,1252),(619,1278),(616,1298),(600,1312),(570,1315),(545,1310),(529,1297),(516,1276),(507,1248),(498,1223),(480,1194),(467,1163),(457,1144),(441,1153),(437,1138),(420,1122),(432,1106),(430,1090),(445,1087),(449,1064),(444,1031)],'leg',[486,1032])
region('skirt',[(363,794),(408,787),(461,786),(513,786),(554,792),(592,809),(635,821),(682,832),(725,844),(754,850),(775,839),(792,847),(795,867),(782,893),(775,913),(757,935),(745,955),(724,977),(697,991),(672,1003),(642,1013),(611,1016),(581,1025),(551,1031),(526,1024),(508,1010),(487,1017),(467,1022),(448,1020),(431,1032),(412,1046),(387,1049),(363,1044),(347,1038),(326,1038),(307,1027),(294,1019),(284,1004),(270,991),(267,976),(259,963),(260,947),(273,930),(293,910),(321,885),(340,858),(354,829)],'skirt',[498,804])
region('torso_blouse',[(411,620),(434,615),(456,612),(472,614),(509,624),(548,616),(580,615),(604,630),(615,659),(601,695),(582,726),(574,757),(565,789),(539,807),(509,813),(461,819),(424,816),(398,802),(388,776),(390,740),(394,696),(395,654)],'torso',[492,774])
region('torso_neck_bow',[(390,630),(402,624),(423,629),(447,641),(461,644),(478,643),(513,647),(544,651),(555,660),(554,685),(543,704),(525,709),(520,716),(537,740),(545,756),(518,768),(492,777),(479,758),(470,733),(463,709),(450,740),(436,779),(416,771),(395,761),(400,742),(421,708),(402,703),(383,697),(385,672)],'torso',[464,667])
region('arm_left_sleeve',[(351,674),(363,679),(380,693),(400,701),(411,713),(409,738),(406,768),(395,798),(379,817),(357,829),(338,824),(317,809),(303,790),(293,766),(286,752),(294,737),(307,720),(321,701),(332,681)],'arm',[395,688])
region('hand_left',[(346,701),(346,677),(352,653),(363,636),(376,629),(391,627),(400,633),(405,642),(404,650),(409,658),(407,668),(411,677),(406,686),(400,690),(395,704),(383,717),(370,723),(353,718)],'arm',[370,710])
region('arm_right_sleeve',[(566,633),(585,622),(604,628),(622,639),(636,654),(654,671),(676,678),(692,694),(691,712),(681,731),(675,754),(676,783),(666,805),(649,815),(623,813),(605,800),(591,779),(582,753),(573,728),(562,704),(555,680)],'arm',[583,651])
region('hand_right',[(649,738),(662,717),(690,707),(718,698),(739,689),(749,688),(751,694),(747,704),(733,713),(716,724),(723,735),(742,745),(761,754),(779,767),(784,776),(780,781),(770,779),(746,769),(730,765),(730,780),(740,800),(750,817),(749,824),(744,827),(737,824),(727,811),(713,793),(705,788),(704,804),(709,825),(706,835),(699,836),(692,830),(684,808),(677,791),(665,791),(658,809),(653,827),(647,832),(641,830),(640,820),(641,800),(638,781),(639,758)],'arm',[654,752])

# Anatomical priority resolves occlusion. Front features get their own mask later.
order=['hair_back_left','hair_back_right','leg_back_right','leg_front_left','skirt','torso_blouse','face_skin','hair_cap','hair_side_left','hair_side_right','hair_bangs','hair_cowlick','ribbon_head','arm_left_sleeve','arm_right_sleeve','torso_neck_bow','hand_left','hand_right']
# Skin must own the complete blank face, including the eye corner substrate.
# The cap outline encloses some face; remove exposed face from all overlapping hair.
facial_edit=np.zeros((H,W),bool)
for f in ref['eyes']+[ref['mouth']]:
 m=np.array(Image.open(ROOT/f['mask']))>0
 facial_edit|=cv2.dilate(m.astype('uint8'),np.ones((3,3),np.uint8))>0
raw['face_skin']|=facial_edit
flat_arr=np.array(Image.open(ROOT/'work/aligned/flat.png').convert('RGBA'))
raw['face_skin']=refine_face(flat_arr,raw['face_skin'],facial_edit)
# Restore the actual fine jaw outline to skin ownership.
jaw=Image.new('L',(W,H));ImageDraw.Draw(jaw).line([(350,521),(363,546),(387,570),(416,591),(450,607),(482,616),(520,620),(568,621),(608,616),(642,604)],fill=255,width=4,joint='curve')
raw['face_skin']|=(np.array(jaw)>0)
# The exposed left brow lies on skin, not on the side lock.
brow_skin=Image.new('L',(W,H));ImageDraw.Draw(brow_skin).line([(414,312),(427,309),(441,307),(454,307),(466,308),(476,310)],fill=255,width=7,joint='curve');raw['face_skin']|=np.array(brow_skin)>0
# The tied lock passes in front of the white ribbon.
ribbon_hair=poly([(869,329),(891,337),(915,361),(920,385),(908,411),(890,437),(878,427),(866,388)])
raw['ribbon_head']&=~ribbon_hair
raw['hair_cap']|=ribbon_hair
for pid in ['hair_cap','hair_side_left','hair_side_right','hair_bangs']:
 raw[pid]&=~raw['face_skin']
# Eyebrows are source pigment only; small polylines follow the actual asymmetric visible art.
brows={}
for name,pts in [('brow_left',[(414,312),(427,309),(441,307),(454,307),(466,308),(476,310)]),('brow_right',[(616,338),(626,340),(638,344),(649,350),(660,356),(670,363)])]:
 im=Image.new('L',(W,H));ImageDraw.Draw(im).line(pts,fill=255,width=5,joint='curve');brows[name]=np.array(im)>0
 # Keep normal art below its anti-aliased pigment mask; tiny exposed gaps are extended underneath.

# Skin hands: keep their outlines but exclude hair showing between the fingers.
for pid in ['hand_left','hand_right']:
 m=raw[pid];allowed=cv2.dilate(m.astype('uint8'),kernel(3))>0
 dark=(normal[:,:,0]<205)&(normal[:,:,1]<150)&allowed
 raw[pid]=grab(normal,m,inner=4,outer=3,bg=dark)&allowed

# Assign every visible character pixel to exactly one body/head material.
visible={};covered=np.zeros((H,W),bool)
for pid in reversed(order):
 visible[pid]=raw[pid]&~covered;covered|=raw[pid]
character=refine_character(normal,covered,poly)
# Hair-window subtraction must never delete the neighboring cuff, skirt frill or ribbon bell.
for pid in order:
 if meta[pid]['role']!='hair':character|=raw[pid]
# Restore observed strands along the inner edges of two left-side hair loops.
for pts in [[(227,374),(245,350),(258,346),(248,382),(233,419),(219,458),(211,469),(217,438)],[(248,460),(246,487),(254,510),(270,523),(278,524),(272,535),(258,529),(246,515),(237,495)]]:character|=poly(pts)
# Retain the thin antialiased silhouette in the moving cutout.
character=cv2.dilate(character.astype('uint8'),kernel(1))>0
# Refined new edge pixels inherit nearest visible material, not the static base.
owner=np.zeros((H,W),np.int16)
for i,pid in enumerate(order,1):owner[visible[pid]]=i
_,idx=distance_transform_edt(owner==0,return_indices=True)
owner[owner==0]=owner[idx[0][owner==0],idx[1][owner==0]]
for i,pid in enumerate(order,1):visible[pid]=(owner==i)&character
# Newly recovered brown pixels near fingers belong to the surrounding rear lock.
for pid in ['hand_left','hand_right']:
 bad=visible[pid]&~(cv2.dilate(raw[pid].astype('uint8'),kernel(1))>0)
 visible[pid]&=~bad
 visible['hair_back_left' if pid=='hand_left' else 'hair_back_right']|=bad
# Keep newly recovered face material consistent with the refined skin contour.
face_bad=visible['face_skin']&~raw['face_skin']&~facial_edit
visible['face_skin']&=~face_bad
visible['hair_side_left']|=face_bad&(np.indices((H,W))[1]<540)
visible['hair_side_right']|=face_bad&(np.indices((H,W))[1]>=540)
# The eye substrates are required to cover every source difference.
character|=facial_edit
visible['face_skin']|=facial_edit
for pid in order:
 if pid!='face_skin':visible[pid]&=~facial_edit
Image.fromarray(character.astype('uint8')*255).save(PATCH/'character_silhouette.png')
# Remove facial pigment from its underlying skin/hair material, but retain a derived underpaint there.
parts=[];masks={};zero={'rot_deg':0,'x_px':0,'y_px':0,'scale_x_pct':0,'scale_y_pct':0,'phase':0,'freq':1}

def save(name,m):
 path=OUT/(name+'.png');Image.fromarray((m.astype('uint8')*255) if m.dtype==bool else m).save(path);masks[name]=m
 return str(path.relative_to(ROOT))

def spec(name,mask,source,role,kind='normal',head=False,pivot=None,mesh=None,motion=None):
 p={'id':name,'source':source,'mask':save(name,mask),'role':role,'kind':kind,'head':head,'pad':16,'pivot':pivot or [W/2,H/2],'motion':dict(zero)}
 if motion:p['motion'].update(motion)
 if mesh:p['mesh']=mesh
 parts.append(p);return p

# Stationary background is genuinely empty of moving character art.
base=spec('background',~character,'normal','base','static')
# A narrow occluded background margin is extrapolated only from actual background pixels.
# The center is filled too, but remains occluded by the character during this modest 2D motion.
_,nearest=distance_transform_edt(character,return_indices=True)
bgpatch=normal.copy();bgpatch[character,:3]=normal[nearest[0][character],nearest[1][character],:3]
bgpatch[~character,3]=0
Image.fromarray(bgpatch).save(PATCH/'background_underpaint.png')
under=spec('background_hidden_margin',character,'normal','background',pivot=[W/2,H/2]);under['texture_repair']={'file':'work/rig_authoring/background_underpaint.png','mask':under['mask']}

# Layer margins extend under later parts only, so visible source pixels stay exact.
for i,pid in enumerate(order):
 m=visible[pid];info=meta[pid];role=info['role']
 if not m.any():raise ValueError('Empty '+pid)
 later=np.logical_or.reduce([visible[p] for p in order[i+1:]]) if i+1<len(order) else np.zeros_like(m)
 ext=(cv2.dilate(m.astype('uint8'),np.ones((13,13),np.uint8))>0)&later
 # Head materials can extend beneath forelocks, but never across exposed background.
 full=m|ext
 brow_region=np.logical_or.reduce(list(brows.values()))&m if info['head'] else np.zeros_like(m)
 source='flat' if pid=='face_skin' else 'normal'
 mesh={'type':'face_grid'} if role=='face' else {'type':'bend_vertical' if role in ('hair','ribbon','skirt') else 'soft_body','slices':10 if role=='hair' else 8,'amp_px':.35 if role=='hair' else .2,'squash_pct':.02}
 # Shared small bodily breathing, plus independently editable sway.
 motion={'rot_deg':.10 if role=='hair' else .06,'x_px':.18,'y_px':.16,'phase':.12+i*.025}
 if role=='ribbon':motion={'rot_deg':.18,'x_px':.18,'y_px':.14,'phase':.27}
 p=spec(pid,full,source,role,head=info['head'],pivot=info['pivot'],mesh=mesh,motion=motion)
 p['parent']='head_sway' if info['head'] else 'body_sway'
 if ext.any() or brow_region.any():
  original=np.array(Image.open(ROOT/f'work/aligned/{source}.png').convert('RGBA'))
  _,idx=distance_transform_edt(~m,return_indices=True)
  patch=original.copy();patch[ext,:3]=original[idx[0][ext],idx[1][ext],:3]
  if brow_region.any():
   prediction=cv2.inpaint(np.ascontiguousarray(original[:,:,:3]),brow_region.astype('uint8')*255,3,cv2.INPAINT_TELEA);patch[brow_region,:3]=prediction[brow_region]
  ext=ext|brow_region;patch[~ext,3]=0
  Image.fromarray(patch).save(PATCH/(pid+'_margin.png'))
  path=save(pid+'_margin_region',ext)
  p['texture_repair']={'file':f'work/rig_authoring/{pid}_margin.png','mask':path}

# Eyes use the full aperture with lashes and separate actual iris art, clipped by that aperture.
for f in ref['eyes']:
 side='left' if 'left' in f['id'] else 'right'
 aperture=cv2.dilate((np.array(Image.open(ROOT/f['mask']))>0).astype('uint8'),np.ones((3,3),np.uint8))>0
 if side=='left':
  iris=poly([(426,401),(447,406),(463,418),(470,439),(470,464),(461,483),(449,496),(428,499),(409,495),(397,483),(389,461),(388,441),(397,420),(411,408)])
 else:
  iris=poly([(626,457),(646,459),(662,472),(670,489),(671,512),(662,532),(647,546),(627,550),(607,542),(589,533),(581,521),(582,501),(590,482),(605,465)])
 iris = (cv2.dilate(iris.astype("uint8"),kernel(2))>0) & aperture
 curve=np.array(f['closed_curve']);coeff=np.polyfit(curve[:,0],curve[:,1],2);a,b,c=coeff;xc=-b/(2*a);yc=np.polyval(coeff,xc)
 pivot=[float(curve[:,0].mean()),float(curve[:,1].mean())]
 e=spec('eye_'+side+'_sclera',aperture,'normal','eye','eye_sclera',True,pivot,{'type':'blink_eye_radial','rings':5,'spokes':64,'min_open':.015,'gaze_x_ratio':.055,'gaze_y_ratio':.045,'center':{'x':float(np.where(aperture)[1].mean()),'y':float(np.where(aperture)[0].mean())},'close_curve':{'x':float(xc),'y':float(yc),'curvature':float(a)} })
 e.update(iris_part='eye_'+side+'_iris',closed_part='eye_'+side+'_closed',parent='head_sway')
 e['sclera_fill']=[253,243,236] if side=='left' else [253,245,236]
 ir=spec('eye_'+side+'_iris',iris,'normal','eye','eye_iris',True,pivot,{'type':'soft_strip','squash_pct':0});ir.update(clip_to=e['id'],parent='head_sway')
 # Preserve the actual lashes above a moving iris; no synthetic recoloring.
 line=aperture&~(cv2.dilate(iris.astype('uint8'),kernel(1))>0)&(normal[:,:,0]<162)&(normal[:,:,1]<120)
 li=spec('eye_'+side+'_line',line,'normal','eye','eye_line',True,pivot,{'type':'soft_strip','squash_pct':0});li.update(clip_to=e['id'],parent='head_sway')
 cm=np.array(Image.open(ROOT/manifest['masks'][f['id']+'_closed']))>0
 cm=cv2.dilate(cm.astype('uint8'),np.ones((3,3),np.uint8))>0
 cl=spec('eye_'+side+'_closed',cm,'blink','eye','drawn_eye_closed',True,pivot,{'type':'soft_strip','squash_pct':0});cl['parent']='head_sway'

mouth=ref['mouth'];mm=cv2.dilate((np.array(Image.open(ROOT/mouth['mask']))>0).astype('uint8'),np.ones((3,3),np.uint8))>0
curve=np.array(mouth['closed_curve']);closedcenter=curve.mean(axis=0);slope=(curve[-1,1]-curve[0,1])/(curve[-1,0]-curve[0,0])
p=spec('mouth_open',mm,'normal','mouth','mouth_open',True,[503,554],{'type':'mouth_open_close','center':{'x':503,'y':557},'closed_center':{'x':float(closedcenter[0]),'y':float(closedcenter[1])},'closed_width_ratio':.89,'closed_slope':float(slope)});p.update(closed_part='mouth_closed',parent='head_sway')
cm=np.array(Image.open(ROOT/manifest['masks']['mouth_closed']))>0
cm=cv2.dilate(cm.astype('uint8'),np.ones((3,3),np.uint8))>0
p=spec('mouth_closed',cm,'mouth_closed','mouth','mouth_closed',True,[503,554],{'type':'soft_strip','squash_pct':0});p['parent']='head_sway'
# Independent source-colored brow strokes; underpaint is restricted to their exact footprint.
for pid,bm in brows.items():
 bm &= character
 yy,xx=np.where(bm)
 p=spec(pid,bm,'normal','brow','brow',True,[float(xx.mean()),float(yy.mean())],{'type':'soft_strip','squash_pct':0})
 p['parent']='head_sway'

# Explicit small-range nine-direction poses. Shared rigid head shift plus shallow face-grid warp.
# Coherent motion avoids pretending this single illustration contains profile artwork.
dirs={'center':(0,0),'left':(-1,0),'right':(1,0),'up':(0,-1),'down':(0,1),'up_left':(-1,-1),'up_right':(1,-1),'down_left':(-1,1),'down_right':(1,1)}
poses={}
for name,(yaw,pitch) in dirs.items():
 settings={}
 for p in parts:
  if not p['head'] or p['kind'] in ('eye_iris','eye_line','drawn_eye_closed','mouth_closed'):continue
  role=p['role'];x=yaw*(3.0 if role=='hair' else 3.4);y=pitch*2.5
  s={'x':x,'y':y,'rotation':yaw*.08,'scale_x':1,'scale_y':1,'vertices':[[0,0] for _ in range(25)]}
  if p['kind']=='eye_sclera':
   side=1 if 'right' in p['id'] else -1;s['scale_x']=1+yaw*side*.012;s['x']+=yaw*1.0
  if role=='mouth':s['x']+=yaw*.7
  if role=='face':
   for r in range(5):
    for col in range(5):s['vertices'][r*5+col]=[round(yaw*1.8*math.sin(col*math.pi/4)*math.sin(r*math.pi/4),4),round(pitch*1.1*math.sin(col*math.pi/4)*math.sin(r*math.pi/4),4)]
  settings[p['id']]=s
 poses[name]={'parts':settings,'status':'authored'}
plan={'name':'milkc0de','duration_seconds':5,'groups':{'body_sway':{'pivot':{'x':520,'y':970},'motion':{'rot_deg':.04,'x_px':.08,'y_px':.22,'phase':0}},'head_sway':{'pivot':{'x':550,'y':610},'motion':{'rot_deg':.045,'x_px':.08,'y_px':.15,'phase':0}}},'parts':parts,'draw_order':[p['id'] for p in parts],'head_pose':{'columns':4,'rows':4,'autoplay':True,'poses':poses},'provenance':{'expressions':'Estimated single-image references, not artist-supplied endpoints.','hidden_material':'Nearest source-colored pixels extend only occluded joints and background margins.','head_range':'Shallow 2D deformation; no invented profile/back views.'}}
(ROOT/'rig.plan.json').write_text(json.dumps(plan,indent=2)+'\n')
# Material and isolated-part views for semantic review.
colors=[(239,91,94),(72,192,171),(250,199,88),(106,126,214),(216,118,199),(133,185,85)]
over=normal.copy();
for i,pid in enumerate(order):
 m=visible[pid];over[m,:3]=(normal[m,:3]*.48+np.array(colors[i%len(colors)])*.52).astype('uint8')
Image.fromarray(over).save(ROOT/'checks/semantic_overlay.png')
thumb=240;sheet=Image.new('RGBA',(thumb*6,320*math.ceil(len(order)/6)),'#32343b');d=ImageDraw.Draw(sheet)
for i,pid in enumerate(order):
 im=Image.fromarray(flat_arr.copy() if pid=='face_skin' else normal.copy());im.putalpha(Image.fromarray(visible[pid].astype('uint8')*255));box=im.getbbox();im=im.crop(box);im.thumbnail((230,286));x=(i%6)*thumb+(thumb-im.width)//2;y=(i//6)*320+26;sheet.alpha_composite(im,(x,y));d.text(((i%6)*thumb+5,(i//6)*320+6),pid,fill='white')
sheet.save(ROOT/'checks/parts_sheet.png')
print(json.dumps({'parts':len(parts),'counts':{role:sum(p['role']==role for p in parts) for role in ('hair','ribbon','arm','torso','leg','skirt')},'character_pixels':int(character.sum())}))
