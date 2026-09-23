// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
// Remove the stationary eyebrow strokes from underlying head layers at load time.
// Only the duplicate stroke pixels are filled; original image bytes stay untouched.
function prepareBrowUnderpaint(){
  const brows=Object.values(PROJECT.parts).filter(p=>p.kind==='brow');
  const masks=brows.map(p=>{const c=document.createElement('canvas');c.width=p.w;c.height=p.h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(images[p.file],0,0);return {p,data:g.getImageData(0,0,p.w,p.h).data}});
  let repaired=0;
  for(const part of Object.values(PROJECT.parts)){
    if(!PROJECT.neck_sway?.part_ids.includes(part.name)||['eye','mouth','brow'].includes(part.role))continue;
    for(const file of [part.file,...(part.seam?[part.seam.file]:[])]){
      const im=images[file],c=document.createElement('canvas');c.width=im.width;c.height=im.height;
      const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(im,0,0);const frame=g.getImageData(0,0,c.width,c.height),rgba=frame.data;
      const marks=new Set();
      for(const {p,data} of masks)for(let y=0;y<p.h;y++)for(let x=0;x<p.w;x++){
        if(data[(y*p.w+x)*4+3]<32)continue;
        const xx=p.x-part.x+x,yy=p.y-part.y+y;
        for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
          const px=xx+dx,py=yy+dy;if(px<1||py<1||px>=c.width-1||py>=c.height-1)continue;
          const i=py*c.width+px;if(rgba[i*4+3]>32)marks.add(i);
        }
      }
      if(!marks.size)continue;
      // Harmonic interpolation in the narrow stroke mask, with fixed texture boundary.
      const ids=[...marks],rgb=Float32Array.from(rgba),next=new Float32Array(rgba.length);
      for(let pass=0;pass<180;pass++){
        for(const i of ids)for(let channel=0;channel<3;channel++){
          let sum=0,count=0;for(const j of [i-1,i+1,i-c.width,i+c.width])if(rgba[j*4+3]>32){sum+=rgb[j*4+channel];count++}
          next[i*4+channel]=count?sum/count:rgb[i*4+channel];
        }
        for(const i of ids)for(let channel=0;channel<3;channel++)rgb[i*4+channel]=next[i*4+channel];
      }
      for(const i of ids)for(let channel=0;channel<3;channel++)rgba[i*4+channel]=Math.round(rgb[i*4+channel]);
      g.putImageData(frame,0,0);images[file]=c;repaired++;
    }
  }
  return repaired;
}
