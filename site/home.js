// SPDX-License-Identifier: Apache-2.0
'use strict';
const demo=document.getElementById('character-demo'),toggle=document.getElementById('motion-toggle');
let paused=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function updateDemo(){demo.src=paused?'characters/milkc0de/input/normal.png':'template/workspace/demo.gif';toggle.textContent=paused?'▷ 動きを見る':'Ⅱ 動きを止める';toggle.setAttribute('aria-pressed',String(paused));demo.alt=paused?'サンプルキャラクターの元イラスト':'ChibiRigKitで制作した、髪や体がゆっくり動くキャラクターのサンプル'}
toggle.hidden=false;toggle.addEventListener('click',()=>{paused=!paused;updateDemo()});if(paused)updateDemo();
const copy=document.getElementById('copy-commands'),status=document.getElementById('copy-status');
copy.hidden=false;copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('commands').textContent);copy.textContent='コピーしました';status.textContent='起動コマンドをコピーしました。';setTimeout(()=>{copy.textContent='コピー'},2200)}catch{copy.textContent='選択してコピー';status.textContent='コマンドを選択してコピーしてください。';const selection=getSelection(),range=document.createRange();range.selectNodeContents(document.getElementById('commands'));selection.removeAllRanges();selection.addRange(range)}});
