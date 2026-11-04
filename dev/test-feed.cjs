// End to end: real encrypted feed via #key= setup link, then a second feed to check reactions.
const { chromium } = require('playwright'); const fs=require('fs'), path=require('path'), http=require('http');
const root=path.join(__dirname,'..'), [,,feed1,feed2,key,out]=process.argv;
const srv=http.createServer((q,s)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/\/$/,'/index.html'));fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end();return}s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript'}[path.extname(f)]||'application/octet-stream'});s.end(d)})}).listen(8788);
(async()=>{const b=await chromium.launch();const errs=[];try{
 const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 p.on('pageerror',e=>errs.push(e.message));
 let cur=feed1;
 await p.route('https://raw.githubusercontent.com/**',r=>r.request().url().includes('crew-feed')?r.fulfill({status:200,contentType:'application/json',body:fs.readFileSync(cur)}):r.fulfill({status:200,contentType:'application/json',body:'{"build":1}'}));
 await p.goto('http://localhost:8788/#key='+key); await p.waitForTimeout(2500);
 console.log('h1:',await p.textContent('#floorTitle'),'| sync:',await p.textContent('#syncTxt'),'| hash:',await p.evaluate(()=>location.hash));
 await p.screenshot({path:out+'/real-1.png'});
 cur=feed2; await p.click('#sync'); await p.waitForTimeout(1500);
 console.log('after:',await p.textContent('#floorTitle'),'| toasts:',await p.$$eval('.toast',t=>t.map(x=>x.textContent.trim())));
 await p.screenshot({path:out+'/real-2.png'});
 await p.click('.tab[data-v="log"]'); await p.waitForTimeout(300);
 console.log('log rows:',await p.$$eval('#log .row',r=>r.length));
 // bad key
 await p.evaluate(()=>localStorage.setItem('crew:key','"wrong-key-123456"')); await p.reload(); await p.waitForTimeout(2000);
 console.log('badkey note:',await p.textContent('#demoNote'));
}finally{await b.close();srv.close()}console.log(errs.length?'ERRORS '+errs.join('\n'):'no errors')})();
