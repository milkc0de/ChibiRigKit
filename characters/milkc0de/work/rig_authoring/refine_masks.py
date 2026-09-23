# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Local color-assisted edge refinement; all semantic ownership is vision authored."""
import cv2,numpy as np
from PIL import Image

def kernel(r):return cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*r+1,2*r+1))
def grab(src,m,inner=8,outer=12,fg=None,bg=None):
 g=np.where(m,cv2.GC_PR_FGD,cv2.GC_PR_BGD).astype('uint8')
 g[cv2.erode(m.astype('uint8'),kernel(inner))>0]=cv2.GC_FGD
 g[cv2.dilate(m.astype('uint8'),kernel(outer))==0]=cv2.GC_BGD
 if fg is not None:g[fg]=cv2.GC_FGD
 if bg is not None:g[bg]=cv2.GC_BGD
 cv2.setRNGSeed(17)
 cv2.grabCut(np.ascontiguousarray(src[:,:,:3]),g,None,np.zeros((1,65)),np.zeros((1,65)),3,cv2.GC_INIT_WITH_MASK)
 return (g==cv2.GC_FGD)|(g==cv2.GC_PR_FGD)

def refine_face(flat,m,edits):
 # Skin connects around the eyes and cheeks; bright isolated hair highlights are not skin.
 allowed=cv2.dilate(m.astype('uint8'),kernel(20))>0
 dark=(flat[:,:,0]<224)&(flat[:,:,1]<183)&allowed&~edits
 skin=grab(flat,m,inner=5,outer=20,bg=dark)
 skin &= allowed
 n,labels,stats,_=cv2.connectedComponentsWithStats(skin.astype('uint8'),8)
 for i in range(1,n):
  if stats[i,cv2.CC_STAT_AREA]<100:skin[labels==i]=False
 skin |= edits
 return skin


def refine_character(normal,initial,poly):
 # Recover internal hair, clothing and fringe gaps before refining the external silhouette.
 m=initial.copy()
 for pts in [[(477,237),(480,345),(490,414),(529,442),(545,444),(510,418),(504,325),(513,232)],[(374,571),(434,609),(399,643),(369,635)],[(590,606),(735,574),(775,659),(739,693),(692,688),(658,651),(614,644)],[(280,458),(314,468),(315,546),(291,549)],[(700,378),(746,389),(744,540),(713,557)],[(287,714),(316,696),(321,739),(301,763)],[(627,993),(699,980),(701,1009),(650,1031)],[(851,487),(928,476),(978,559),(1007,620),(953,615),(899,592),(856,581)]]:m|=poly(pts)
 result=grab(normal,m,inner=12,outer=18)
 # True background windows through the hair and between the legs, traced from the source.
 holes=[
 [(229,310),(224,287),(239,251),(259,222),(284,194),(271,223),(252,258),(238,291)],
 [(189,440),(190,414),(206,381),(231,348),(221,377),(209,407),(208,435),(219,459),(211,464),(196,456)],
 [(234,490),(239,472),(253,444),(253,464),(250,489),(256,509),(274,522),(282,525),(269,532),(249,524)],
 [(151,688),(158,674),(180,659),(218,644),(200,663),(180,681),(157,710),(149,719),(146,704)],
 [(210,763),(220,744),(239,724),(267,704),(281,695),(261,719),(239,739),(218,763),(202,782)],
 [(127,783),(135,766),(131,785),(134,807),(147,820),(135,819),(120,808)],
 [(158,829),(177,835),(193,837),(181,844),(169,844)],
 [(213,859),(227,869),(246,881),(229,890),(217,883)],
 [(888,589),(890,560),(900,525),(932,556),(943,588),(953,618),(959,648),(952,674),(937,692),(918,685),(905,664)],
 [(978,590),(973,561),(965,541),(981,576),(997,613),(976,609)],
 [(990,767),(1008,786),(1015,806),(1008,823),(1001,827),(1001,801)],
 [(871,825),(885,843),(890,863),(881,879),(865,886),(873,867)],
 [(997,869),(1015,897),(1018,914),(1005,931),(985,943),(982,938),(995,920)],
 [(903,944),(923,941),(945,928),(957,921),(946,940),(926,950),(907,950)],
 [(815,954),(837,945),(852,945),(843,964),(846,982),(831,987),(815,982),(806,970)],
 [(738,920),(758,899),(751,922),(740,938),(730,943)],
 [(547,1093),(565,1118),(596,1147),(611,1170),(607,1204),(597,1233),(583,1207),(567,1177),(554,1131)]
 ]
 for pts in holes:
  hole=poly(pts)
  # A thin classification band snaps the authored hole edge without deleting adjacent brown locks.
  bounds=cv2.dilate(hole.astype('uint8'),kernel(4))>0
  bg=cv2.erode(hole.astype('uint8'),kernel(2))>0
  if bg.any():
   # Use source colors only in this small ROI with firm exterior hair and interior background.
   yy,xx=np.where(bounds);x0=max(0,xx.min()-3);x1=min(normal.shape[1],xx.max()+4);y0=max(0,yy.min()-3);y1=min(normal.shape[0],yy.max()+4)
   h=hole[y0:y1,x0:x1];g=np.where(h,cv2.GC_PR_FGD,cv2.GC_PR_BGD).astype('uint8')
   g[bg[y0:y1,x0:x1]]=cv2.GC_FGD;g[~bounds[y0:y1,x0:x1]]=cv2.GC_BGD
   cv2.grabCut(np.ascontiguousarray(normal[y0:y1,x0:x1,:3]),g,None,np.zeros((1,65)),np.zeros((1,65)),2,cv2.GC_INIT_WITH_MASK)
   result[y0:y1,x0:x1]&=~((g==cv2.GC_FGD)|(g==cv2.GC_PR_FGD))
 # Tiny fully enclosed pinholes inside the character are segmentation noise.
 n,labels,stats,_=cv2.connectedComponentsWithStats((~result).astype('uint8'),8)
 for i in range(1,n):
  if stats[i,cv2.CC_STAT_AREA]<70:result[labels==i]=True
 return result
