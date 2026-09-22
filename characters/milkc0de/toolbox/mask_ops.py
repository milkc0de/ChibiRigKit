# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Small mask helpers for the Codex auto-rig agent.
All masks are full-canvas L-mode PNGs. Sources remain unchanged.
"""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter,ImageChops,ImageOps
import cv2,numpy as np

def blank(size):return Image.new('L',size,0)
def polygon(size,points,blur=0,grow=0):
    m=blank(size);ImageDraw.Draw(m).polygon(points,fill=255)
    if grow:m=m.filter(ImageFilter.MaxFilter(grow*2+1))
    if blur:m=m.filter(ImageFilter.GaussianBlur(blur))
    return m
def ellipse(size,box,blur=0):
    m=blank(size);ImageDraw.Draw(m).ellipse(box,fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m
def rounded(size,box,radius,blur=0):
    m=blank(size);ImageDraw.Draw(m).rounded_rectangle(box,radius=radius,fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m
def union(*ms):
    out=blank(ms[0].size)
    for m in ms:out=ImageChops.lighter(out,m)
    return out
def subtract(a,b):return ImageChops.subtract(a,b)
def intersect(a,b):return ImageChops.darker(a,b)
def diff_mask(source,reference,region,threshold=7,dark_threshold=None,saturation_threshold=None,grow=1,blur=.65):
    A=np.array(source.convert('RGBA'));B=np.array(reference.convert('RGBA'));reg=np.array(region)>0
    diff=np.max(np.abs(A[:,:,:3].astype(np.int16)-B[:,:,:3].astype(np.int16)),axis=2);sel=(diff>=threshold)&reg&(A[:,:,3]>10)
    if dark_threshold is not None or saturation_threshold is not None:
        rgb=A[:,:,:3];hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV);lum=rgb[:,:,0]*.299+rgb[:,:,1]*.587+rgb[:,:,2]*.114;extra=np.zeros(sel.shape,bool)
        if dark_threshold is not None:extra|=lum<=dark_threshold
        if saturation_threshold is not None:extra|=hsv[:,:,1]>=saturation_threshold
        sel|=extra&reg&(A[:,:,3]>10)
    m=np.uint8(sel)*255;m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8),iterations=1)
    if grow:m=cv2.dilate(m,np.ones((3,3),np.uint8),iterations=grow)
    return Image.fromarray(m,'L').filter(ImageFilter.GaussianBlur(blur))
def save(mask,path):Path(path).parent.mkdir(parents=True,exist_ok=True);mask.save(path)
