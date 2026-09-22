const {ROOT,CHARACTER,RUNTIME,playerHTML}=require('./paths.cjs');
const fs=require('node:fs'),vm=require('node:vm');
function browserHarness(html=playerHTML()){
 const elements=new Map(),directions=[],contexts=[];
 function element(tag='div',id=''){
  const e={tagName:tag.toUpperCase(),id,value:'',type:'',checked:false,hidden:false,disabled:false,textContent:'',children:[],style:{},dataset:{},width:1152,height:1366,listeners:{},classList:{add(){},remove(){},toggle(){}},
   addEventListener(name,f){(this.listeners[name]??=[]).push(f)},removeEventListener(){},setAttribute(name,value){this[name]=value},removeAttribute(){},append(...children){this.children.push(...children);if(tag==='select'&&this.children.length===children.length&&children.length)this.value=children[0].value},appendChild(child){this.append(child)},add(child){this.append(child)},replaceChildren(...c){this.children=[];this.append(...c)},click(){this.onclick?.({target:this});for(const f of this.listeners.click||[])f({target:this})},getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height}},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture(){return true},pause(){},play(){return Promise.resolve()}};
  let context; e.getContext=()=>context??=(contexts.push({id,draws:0}),new Proxy(contexts.at(-1),{get(t,k){if(k in t)return t[k];if(k==='drawImage')return ()=>t.draws++;if(k==='getImageData')return ()=>({data:new Uint8ClampedArray(4)});return ()=>{}},set(t,k,v){t[k]=v;return true}}));e.toBlob=cb=>cb(new Blob());return e;
 }
 for(const match of html.matchAll(/<(input|button|select|canvas|video|div|p|output|meter|section|progress)[^>]*\bid="([^"]+)"[^>]*>/g)){
  const [all,tag,id]=match,e=element(tag,id);for(const key of ['value','type','min','max','step','width','height']){const m=all.match(new RegExp('\\b'+key+'="([^\"]*)"'));if(m)e[key]=['width','height'].includes(key)?Number(m[1]):m[1]}e.checked=/\bchecked\b/.test(all);e.hidden=/\bhidden\b/.test(all);elements.set(id,e);
 }
 for(const id of ['trackingInput','backgroundMode','backgroundFit'])elements.get(id).value={trackingInput:'camera',backgroundMode:'original',backgroundFit:'cover'}[id];
 for(const name of ['up_left','up','up_right','left','center','right','down_left','down','down_right']){const e=element('button');e.dataset.headDirection=name;directions.push(e)}
 for(const match of html.matchAll(/<script id="([^"]+)"[^>]*>([\s\S]*?)<\/script>/g)){const e=element('script',match[1]);e.textContent=match[2];elements.set(match[1],e)}
 const document={getElementById:id=>elements.get(id)||null,createElement:element,addEventListener(){},querySelector:sel=>directions.find(e=>sel.includes('"'+e.dataset.headDirection+'"')),querySelectorAll:sel=>sel==='[data-head-direction]'?directions:[...elements.values()].filter(e=>['INPUT','BUTTON','SELECT'].includes(e.tagName))};
 const store=new Map(),context=vm.createContext({document,console,structuredClone,crypto:require('node:crypto').webcrypto,performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},requestAnimationFrame(){},location:{protocol:'http:',host:'127.0.0.1:5510',pathname:'/',search:''},navigator:{mediaDevices:{enumerateDevices:async()=>[],addEventListener(){}}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},Image:class{set src(v){this.width=32;this.height=32;queueMicrotask(()=>this.onload?.())}},Option:class{constructor(text,value){this.textContent=text;this.value=value}},Blob,URL,TextEncoder,TextDecoder,Uint8Array,Uint8ClampedArray,WebSocket:{OPEN:1},atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64')});
 context.window=context;context.addEventListener=()=>{};context.fetch=async url=>{if(url==='/api/tracking')return {ok:true,json:async()=>({camera:true})};throw Error('Unexpected network')};vm.runInContext(html.match(/<script>\n([\s\S]*?)<\/script>/)[1],context);vm.runInContext('prepareBrowUnderpaint=()=>0',context);
 return {context,elements,contexts};
}

module.exports={browserHarness};
