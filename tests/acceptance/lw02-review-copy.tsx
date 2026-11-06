import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {KnowledgeMaintenanceReview} from '../../app/pages/KnowledgeMaintenanceReview.tsx';
import {lwFixture} from '../lw01-fixture.ts';
const f=await lwFixture(),raw=await f.rawStore.create({title:'独验旧Raw文案',sourceType:'report',sourceName:'合成',tags:[],body:'渠道覆盖17家。'}),draft=await f.generate(raw.id);
const html=renderToStaticMarkup(<KnowledgeMaintenanceReview view={f.drafts.view(draft) as any} body={raw.body} onView={()=>{}} onBack={()=>{}} onOpenRaw={()=>{}} onCommitted={async()=>{}}/>);
assert(html.includes('来源笔记只记录本份资料，主题页积累跨来源知识。'));assert(html.includes('来源笔记'));assert(!html.includes('问答成果基于既有资料'));assert(!html.includes('全部真实依据'));console.log('Independent real Raw draft component copy preserved');
