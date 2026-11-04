// Hourly feed (v1) + PC live feed (v2) merge, ETag 304, and PC dedupe. Usage: node dev/test-live.cjs hourly.json live.json KEY outdir
const { chromium } = require('playwright'); const fs=require('fs'), path=require('path'), http=require('http');
const root=path.join(__dirname,'..'), [,,hourly,live,key,out]=process.argv;
const srv=http.createServer((q,s)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/\/$/,'/index.html'));fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();return}s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript'}[path.extname(f)]||'application/octet-stream'});s.end(d)})}).listen(8789);
(async()=>{const b=await chromium.launch();const errs=[];let liveHits=0,got304=0;try{
 const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 p.on('pageerror',e=>errs.push(e.message));
 await p.route('https://raw.githubusercontent.com/**',r=>r.request().url().includes('crew-feed')?r.fulfill({status:200,contentType:'application/json',body:fs.readFileSync(hourly)}):r.fulfill({status:200,contentType:'application/json',body:'{"build":2}'}));
 await p.route('https://api.github.com/**',r=>{liveHits++;const h=r.request().headers();if(h['if-none-match']==='"t1"'){got304++;return r.fulfill({status:304,headers:{'access-control-allow-origin':'*'}})}return r.fulfill({status:200,contentType:'application/json',headers:{ETag:'"t1"','access-control-allow-origin':'*','access-control-expose-headers':'ETag'},body:fs.readFileSync(live)})});
 await p.goto('http://localhost:8789/#key='+key); await p.waitForTimeout(3000);
 const titles=await p.$$eval('#lists .row .t',r=>r.map(x=>x.textContent));
 console.log('h1:',await p.textContent('#floorTitle'));
 console.log('rows:',titles.join(' / '));
 console.log('pc rows from hourly hidden:',!titles.includes('Reading device folder BBI content'));
 await p.click('#sync'); await p.waitForTimeout(1500);
 console.log('live hits',liveHits,'304s',got304);
 await p.screenshot({path:out+'/live-merge.png'});
 await p.click('#openSet'); await p.waitForTimeout(400); console.log('settings:',(await p.textContent('.ver')).replace(/\s+/g,' '));
}finally{await b.close();srv.close()}console.log(errs.length?'ERRORS '+errs.join('\n'):'no errors')})();
