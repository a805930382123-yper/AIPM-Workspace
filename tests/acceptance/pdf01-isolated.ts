import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import react from '@vitejs/plugin-react';
import express from 'express';
import {build} from 'vite';
import {registerRawImportRoute} from '../../server/raw-import.ts';
import {registerRawPdfRoutes} from '../../server/raw-pdf.ts';
import type {LlmProvider} from '../../services/llm/provider.ts';
import {PromptStore} from '../../services/prompt/store.ts';
import {AssetStore} from '../../services/raw/assets.ts';
import {PdfPageService} from '../../services/raw/pdf-pages.ts';
import {RawStore} from '../../services/raw/store.ts';
import {getStats} from '../../services/stats/index.ts';
import {WikiStore} from '../../services/wiki/store.ts';

for (const key of Object.keys(process.env)) {
  if (/(?:OPENAI|ANTHROPIC|GEMINI|PROVIDER|LLM_|AI_API|API_KEY)/i.test(key)) delete process.env[key];
}
const root=await mkdtemp(path.join(os.tmpdir(),'pdf01-ui-'));
const envDir=await mkdtemp(path.join(os.tmpdir(),'pdf01-ui-empty-env-'));
const outDir=await mkdtemp(path.join(os.tmpdir(),'pdf01-ui-dist-'));
await build({configFile:false,root:process.cwd(),envDir,plugins:[react()],build:{outDir,emptyOutDir:true}});

// A PDF with a native text page, a bitmap-only page, and a real vector chart page.
const canvas=createCanvas(180,100);
const context=canvas.getContext('2d');
context.fillStyle='#fff4d5';context.fillRect(0,0,180,100);
context.fillStyle='#1e4573';context.fillRect(8,8,164,22);
context.fillStyle='#ffffff';context.font='14px sans-serif';context.fillText('SCANNED PAGE',18,24);
context.fillStyle='#1e4573';context.fillText('42 signed stores',18,52);
context.fillStyle='#e0a646';context.fillRect(18,66,144,18);
const rgba=context.getImageData(0,0,180,100).data;
const rgb=Buffer.alloc(180*100*3);
for(let pixel=0;pixel<180*100;pixel++) rgb.set(rgba.subarray(pixel*4,pixel*4+3),pixel*3);
const stream=(data:string|Buffer,attributes='')=>{
  const body=Buffer.from(data);
  return Buffer.concat([Buffer.from(`<< ${attributes} /Length ${body.length} >>\nstream\n`),body,Buffer.from('\nendstream')]);
};
const page=(content:number,resources:string)=>`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 240] /Resources << ${resources} >> /Contents ${content} 0 R >>`;
const font='/Font << /F1 9 0 R >>';
const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>',
  page(4,font),
  stream('BT /F1 20 Tf 28 195 Td (Mixed PDF - native text page) Tj /F1 14 Tf 0 -40 Td (Signed stores: 56.) Tj ET'),
  page(6,'/XObject << /Scan 10 0 R >>'),
  stream('q 286 0 0 165 37 34 cm /Scan Do Q'),
  page(8,font),
  stream('BT /F1 18 Tf 28 205 Td (Vector channel chart) Tj ET 0.93 0.95 0.99 rg 25 25 310 155 re f 0.14 0.37 0.70 rg 65 40 50 105 re f 0.10 0.58 0.39 rg 150 40 50 74 re f 0.95 0.57 0.19 rg 235 40 50 48 re f'),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  stream(rgb,'/Type /XObject /Subtype /Image /Width 180 /Height 100 /ColorSpace /DeviceRGB /BitsPerComponent 8'),
];
const parts=[Buffer.from('%PDF-1.4\n','ascii')];
const offsets:number[]=[];
let position=parts[0].length;
objects.forEach((object,index)=>{
  offsets.push(position);
  const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),Buffer.from(object),Buffer.from('\nendobj\n')]);
  parts.push(part);position+=part.length;
});
parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length+1} >>\nstartxref\n${position}\n%%EOF\n`));
const fixtures={scan:path.join(root,'合成扫描件.pdf'),mixed:path.join(root,'合成混合页.pdf')};
await Promise.all([writeFile(fixtures.scan,await readFile('tests/fixtures/b03/scan-image.pdf')),writeFile(fixtures.mixed,Buffer.concat(parts))]);

const raws=new RawStore(root),assets=new AssetStore(root),wiki=new WikiStore(root,raws),prompts=new PromptStore(root,wiki);
await Promise.all([raws.initialize(),assets.initialize(),wiki.initialize(),prompts.initialize()]);
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const modelCalls:Array<{page:number;totalPages:number;text:string;imageSha:string;imageBytes:number}>=[];
const legacyCalls:string[]=[];
let failedSecond=false;
const provider:LlmProvider={name:'fake',model:'pdf01-ui-fake',complete:async request=>{
  const payload=JSON.parse(request.user);
  if(payload.stage!=='pdf_page_understanding'||!Buffer.isBuffer(request.image))throw Error('Expected a local page PNG');
  modelCalls.push({page:payload.page,totalPages:payload.totalPages,text:payload.text,imageSha:sha(request.image),imageBytes:request.image.length});
  await new Promise(resolve=>setTimeout(resolve,400));
  request.signal?.throwIfAborted();
  if(payload.totalPages===3&&payload.page===2&&!failedSecond){failedSecond=true;throw Error('PDF01 controlled page 2 failure');}
  const answer={blank:false,content:`第 ${payload.page} 页合成内容`,visuals:payload.page===3?'三根彩色柱形，显示合成矢量图。':'此页含页面图像。',inference:'该说明为示例推断。',questions:['请核对原页。']};
  const text=JSON.stringify(answer);
  return {text,bytes:Buffer.byteLength(text),finishReason:'stop'};
}};
const service=new PdfPageService({root,raws,assets,provider:async()=>provider});
const app=express();
app.use(express.json({limit:'3mb'}));
registerRawImportRoute(app,{store:raws,assets});
registerRawPdfRoutes(app,service);
app.get('/__control/counters',(_req,res)=>res.json({modelCalls,legacyCalls,realProviderCalls:0}));
app.get('/api/raw',async(_req,res)=>res.json({items:await raws.list()}));
app.get('/api/raw/:id',async(req,res)=>{const raw=await raws.get(req.params.id);if(!raw){res.sendStatus(404);return;}res.json(raw);});
app.get('/api/stats',async(_req,res)=>res.json(await getStats(root,raws,new Date(),prompts)));
app.get(['/api/raw-processing','/api/recovery-issues','/api/knowledge/workflows','/api/drafts','/api/work/items'],(_req,res)=>res.json({items:[],overflow:false}));
app.get('/api/home/actions',(_req,res)=>res.json({items:[],sources:{}}));
app.post('/api/raw/:id/extract',(req,res)=>{legacyCalls.push(req.params.id);res.status(409).json({error:{code:'ISOLATED_LEGACY_UNAVAILABLE',message:'此隔离验证不执行旧整理。'}});});
app.use(express.static(outDir));
app.use(((error,_req,res,_next)=>{res.status(error.status??500).json({error:{code:error.code,message:error.message,details:error.details}});}) as express.ErrorRequestHandler);
const server=app.listen(0,'127.0.0.1');
await new Promise<void>(resolve=>server.once('listening',resolve));
const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const session={pid:process.pid,url,api:url,root,envDir,outDir,fixtures,provider:'fake-only',configLoader:'not-connected'};
await writeFile(path.join(root,'isolated-session.json'),JSON.stringify(session,null,2));
console.log(JSON.stringify(session,null,2));
const close=()=>server.close(()=>process.exit(0));
process.on('SIGINT',close);
process.on('SIGTERM',close);
