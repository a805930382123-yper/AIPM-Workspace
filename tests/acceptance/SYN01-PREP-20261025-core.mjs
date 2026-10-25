import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';

export const PREFIX='SYN01-PREP-20261025-';
export const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export const readJson=async file=>JSON.parse(await fsp.readFile(file,'utf8'));
export const writeJson=async(file,value)=>fsp.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
export class GateError extends Error {constructor(code){super(code);this.code=code;this.status=403;}}
export function must(condition,code){if(!condition)throw new GateError(code);}
export function offlineOptions(options={}) {
  must(options&&typeof options==='object'&&!Array.isArray(options),'INVALID_OPTIONS');
  must(Object.keys(options).every(k=>['mode','root'].includes(k)),'UNSUPPORTED_OPTION');
  must(['fake','offline'].includes(options.mode??'fake'),'REAL_OR_UNKNOWN_MODE_DENIED');
  return options;
}
export function isolatedRoot(root){
  const resolved=path.resolve(root);
  must(path.dirname(resolved)===process.cwd()&&path.basename(resolved).startsWith('.scratch-SYN01-PREP-'),'ISOLATED_ROOT_REQUIRED');
  return resolved;
}
export async function fileMap(root){
  const result=[];
  async function walk(dir){for(const item of await fsp.readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await walk(file);else if(item.isFile())result.push({path:path.relative(root,file).replaceAll('\\','/'),sha256:sha(await fsp.readFile(file))});}}
  await walk(root);return result.sort((a,b)=>a.path.localeCompare(b.path));
}
export async function sourceFreeze(){
  const files=[];
  for(const dir of ['app','services','server','rules'])for(const item of await fileMap(dir))files.push({path:dir+'/'+item.path,sha256:item.sha256});
  for(const name of await fsp.readdir('tests/acceptance'))if(name.startsWith(PREFIX))files.push({path:'tests/acceptance/'+name,sha256:sha(await fsp.readFile('tests/acceptance/'+name))});
  for(const file of ['package.json','package-lock.json','tests/support/css-stub.mjs','docs/handoffs/NEXT-PREP-20261024-next-task.md','docs/handoffs/SYN01-PREP-20261025-task.md'])files.push({path:file,sha256:sha(await fsp.readFile(file))});
  files.sort((a,b)=>a.path.localeCompare(b.path));return {files,aggregateSha256:sha(files)};
}

// Defense in depth for this process. No config loader, OpenAI-compatible adapter,
// server/index, child process or configurable network transport is installed.
// Only the one owned loopback API origin can be fetched; redirects never follow.
let activeGuard;
export function installOfflineGuard(){
  if(activeGuard)return activeGuard;
  const originals=[],allowed=new Set(),observed={configReadsDenied:0,networkDenied:0};
  const replace=(obj,key,value)=>{const before=obj[key];obj[key]=value;originals.push(()=>{obj[key]=before;});return before;};
  const deny=code=>{observed.networkDenied++;throw new GateError(code);};
  const protectedFile=file=>{
    if(typeof file==='number')return false;
    const text=file instanceof URL?file.pathname:String(file),absolute=path.resolve(text),base=path.basename(absolute).toLowerCase();
    return /^\.env(?:\.|$)/.test(base)||absolute.toLowerCase().startsWith((path.resolve('workspace')+path.sep).toLowerCase())||absolute.toLowerCase()===path.resolve('workspace').toLowerCase();
  };
  for(const [obj,key]of [[fsp,'readFile'],[fsp,'open'],[fs,'readFile'],[fs,'readFileSync'],[fs,'open'],[fs,'openSync'],[fs,'createReadStream']]){
    const original=obj[key];replace(obj,key,function(file,...args){if(protectedFile(file)){observed.configReadsDenied++;throw new GateError('CONFIG_OR_OFFICIAL_DATA_READ_DENIED');}return original.call(this,file,...args);});
  }
  const nativeFetch=globalThis.fetch;
  replace(globalThis,'fetch',async(input,init={})=>{
    const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
    if(!allowed.has(url.origin)||url.username||url.password)deny('NETWORK_TARGET_DENIED');
    if(input instanceof Request||Object.keys(init).some(k=>!['method','body','headers','signal','redirect'].includes(k)))deny('FETCH_OPTIONS_DENIED');
    return nativeFetch(url,{...init,redirect:'manual'});
  });
  for(const obj of [http,https])for(const key of ['request','get'])replace(obj,key,()=>deny('HTTP_TRANSPORT_DENIED'));
  const validSocket=opts=>opts&&typeof opts==='object'&&!Array.isArray(opts)&&!opts.path&&opts.host==='127.0.0.1'&&allowed.has(`http://127.0.0.1:${opts.port}`);
  for(const key of ['connect','createConnection']){const original=net[key];replace(net,key,function(...args){if(!validSocket(args[0]))deny('NET_TRANSPORT_DENIED');return original.apply(this,args);});}
  replace(tls,'connect',()=>deny('TLS_TRANSPORT_DENIED'));replace(dgram,'createSocket',()=>deny('UDP_TRANSPORT_DENIED'));
  const socketConnect=net.Socket.prototype.connect;
  replace(net.Socket.prototype,'connect',function(...args){
    // Node normalizes net.connect arguments into [options, callback].
    const opts=Array.isArray(args[0])?args[0][0]:args[0];
    if(!validSocket(opts))deny('SOCKET_TARGET_DENIED');
    return socketConnect.apply(this,args);
  });
  syncBuiltinESMExports();
  activeGuard={allowed,observed,restore(){for(const undo of originals.reverse())undo();syncBuiltinESMExports();activeGuard=undefined;}};
  return activeGuard;
}

export function fakeOutput(raws){
  const quote=(raw,text)=>{const start=raw.body.indexOf(text);must(start>=0,'FAKE_QUOTE_NOT_FOUND');return {text,rawId:raw.id,quote:text,start,end:start+text.length};};
  return {title:'演示数据｜虚构清禾区域9月双来源综合',category:'metric',
    agreement:raws.flatMap(raw=>['2026年9月，虚构清禾区域目标门店100家。','铺货率口径为在售门店数除以目标门店数。','AI辅助审批仅为未来分析建议，尚未上线，收益未知。'].map(text=>quote(raw,text))),
    conflicts:[quote(raws[0],'资料A记录在售门店20家，铺货率20%。'),quote(raws[1],'资料B记录在售门店30家，铺货率30%。')],
    suggestedAdditions:[],inferences:['两份资料的数值差异原因尚不能由原文确定。'],openQuestions:['异常审批负责人尚未确认。','两个资料的采样日是否一致尚未确认。']};
}
