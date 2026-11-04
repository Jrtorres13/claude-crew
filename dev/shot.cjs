const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();try{const p=await b.newPage({viewport:{width:932,height:1000}});
await p.goto('file://'+process.argv[2]);await p.waitForTimeout(300);await p.screenshot({path:process.argv[3],fullPage:true});}finally{await b.close();}})();
