// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: MIT
const zlib=require('node:zlib');
const LIMIT=64*1024*1024;
function zipTextFile(bytes,wanted='index.html',expectedFiles){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break}
 if(end<0)throw Error('ZIPの末尾が不正です');
 if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('分割ZIPには対応していません');
 const count=bytes.readUInt16LE(end+10),matches=[],names=[];let pos=bytes.readUInt32LE(end+16);
 for(let i=0;i<count;i++){
  if(pos+46>end||bytes.readUInt32LE(pos)!==0x02014b50)throw Error('ZIPの一覧が不正です');
  const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),packed=bytes.readUInt32LE(pos+20),size=bytes.readUInt32LE(pos+24),n=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42);
  const name=bytes.subarray(pos+46,pos+46+n).toString('utf8');pos+=46+n+extra+comment;if(pos>end)throw Error('ZIPの一覧が途切れています');
  names.push(name);
  if((name===wanted||(wanted==='index.html'&&name.endsWith('/index.html')))&&!name.includes('__MACOSX/')&&!name.split('/').includes('..'))matches.push({flags,method,packed,size,offset});
 }
 if(expectedFiles&&(names.length!==expectedFiles.length||new Set(names).size!==names.length||names.some(name=>!expectedFiles.includes(name))))throw Error('完成品ZIPの内容が現在の形式と一致しません。画面を再読み込みして保存してください');
 if(matches.length!==1)throw Error(wanted+'が1つ入った完成品ZIPを選んでください');
 const f=matches[0],p=f.offset;if(f.flags&1||![0,8].includes(f.method)||f.size>LIMIT||p+30>bytes.length||bytes.readUInt32LE(p)!==0x04034b50)throw Error('このZIPの圧縮形式・サイズには対応していません');
 const start=p+30+bytes.readUInt16LE(p+26)+bytes.readUInt16LE(p+28);if(start+f.packed>bytes.length)throw Error('ZIPの内容が途切れています');
 const packed=bytes.subarray(start,start+f.packed),result=f.method===8?zlib.inflateRawSync(packed,{maxOutputLength:LIMIT}):packed;
 if(result.length!==f.size)throw Error('ZIPの展開サイズが一致しません');return result.toString('utf8');
}
function zipHTML(bytes,expectedFiles){return zipTextFile(bytes,'index.html',expectedFiles)}
function jsonBlock(html,id,required=false){const re=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;for(const m of html.matchAll(re))if(new RegExp('\\bid=["\']'+id+'["\']','i').test(m[1])){if(!/\btype=["']application\/json["']/i.test(m[1]))throw Error('埋め込みデータの形式が不正です');return JSON.parse(m[2])}if(required)throw Error('完成品HTMLにキャラデータがありません');return null}
function parsePlayer(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>LIMIT)throw Error('完成品は64MB以内にしてください');
 const html=bytes[0]===80&&bytes[1]===75?zipHTML(bytes):bytes.toString('utf8'),project=jsonBlock(html,'projectData',true),snapshot=jsonBlock(html,'bundleSnapshot');
 if(!project||!project.parts||!Array.isArray(project.draw_order)||!project.canvas||!Number.isInteger(project.canvas.width)||!Number.isInteger(project.canvas.height)||project.canvas.width<32||project.canvas.height<32||project.canvas.width>8192||project.canvas.height>8192)throw Error('キャラクター構成が不正です');
 const parts=Object.values(project.parts);if(!parts.length||parts.length>1000||!project.draw_order.every(id=>Object.hasOwn(project.parts,id)))throw Error('パーツ構成が不正です');
 const image=value=>{if(typeof value!=='string'||!/^data:image\/(png|webp|jpeg);base64,[a-z0-9+/=\s]+$/i.test(value))throw Error('完成品には画像の内蔵が必要です')};
 for(const p of parts){image(p.image_data_url);if(p.seam)image(p.seam.data_url)}if(project.neck_fill)image(project.neck_fill.data_url);if(snapshot?.background?.image)image(snapshot.background.image);
 return {project,snapshot:snapshot||{motion:project,background:{version:1,mode:'original',color:'#e9dfd3',fit:'cover',image:null,name:''}}};
}
module.exports={parsePlayer,zipHTML,zipTextFile,LIMIT};
