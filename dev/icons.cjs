const { chromium } = require('playwright'); const path=require('path');
(async()=>{const b=await chromium.launch();try{
for (const [name,size,pad] of [['icon-512',512,0.16],['icon-192',192,0.16],['apple-touch-icon',180,0.14],['maskable-512',512,0.26]]){
 const p=await b.newPage({viewport:{width:size,height:size}});
 await p.setContent(`<html><body style="margin:0"><div id=c style="width:${size}px;height:${size}px;display:grid;place-items:center;background:radial-gradient(60% 50% at 50% 70%,rgba(217,119,87,.35),transparent 70%),#161412"></div>
 </body></html>`);
 await p.addScriptTag({path:path.resolve('sprites.js')});
 await p.evaluate(`const k=Math.floor(${size}*(1-2*${pad})/26);document.getElementById('c').innerHTML=CrewSprites.svg('forge','idle').replace('<svg ','<svg width="'+26*k+'" height="'+30*k+'" style="margin-top:'+(-k*2)+'px" ').replace('class="p-shadow"','class="p-shadow" opacity="0"');`);
 await p.waitForTimeout(200); await p.screenshot({path:`icons/${name}.png`}); await p.close();}
}finally{await b.close()}})();
