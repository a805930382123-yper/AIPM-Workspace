import { fetchNewsSource } from '../automation/context.ts';
import type { SourceDiagnosis, SourceError, SourceHealth } from './types.ts';

export const sourceNeedsRetry=(source:SourceHealth)=>source.diagnosis
  ? ['partial','failed'].includes(source.diagnosis.outcome)
  : source.status==='failed'||!!source.error;

class SourceReadError extends Error {
  constructor(readonly type:SourceError['type'], message:string, readonly httpStatus?:number) {super(message);}
}

function safeError(value:unknown,stage:SourceError['stage']):SourceError {
  if(value instanceof SourceReadError) return {type:value.type,stage,message:value.message,...(value.httpStatus ? {httpStatus:value.httpStatus} : {})};
  if(stage==='parse') return {type:'parse',stage,message:'来源内容格式无法解析。'};
  const error=value as {name?:string;code?:string;cause?:{code?:string}}|null;
  const code=error?.cause?.code||error?.code||'';
  if(['TimeoutError','AbortError'].includes(error?.name||'')||/TIMEOUT|ETIMEDOUT/u.test(code)) return {type:'timeout',stage,message:'来源请求超时。'};
  if(/^(ERR_(TLS|SSL)|CERT_|DEPTH_|SELF_SIGNED|UNABLE_TO_|HOSTNAME_MISMATCH)/u.test(code)) return {type:'tls',stage,message:'来源安全连接验证失败。'};
  if(value instanceof TypeError||/^(EAI_|ENOTFOUND|ECONN|EHOST|ENET|UND_ERR_SOCKET)/u.test(code)) return {type:'network',stage,message:'无法连接来源或读取响应。'};
  return {type:'unknown',stage,message:'来源读取失败。'};
}

export function sourceAttempt(source:{id:string;name:string}, now:Date) {
  const started=Date.now();
  const counts:SourceDiagnosis['counts']={candidates:0,qualified:0,duplicates:0,rejected:0,failed:0};
  let error:SourceError|undefined;
  return {
    stage:'list' as SourceError['stage'],
    counts,
    fail(value:unknown,stage:SourceError['stage']) {
      counts.failed++;
      error??=safeError(value,stage);
    },
    finish(qualified:number):SourceHealth {
      counts.qualified=qualified;
      const finished=Date.now(),finishedAt=new Date(finished).toISOString();
      const status=qualified?'ok':error?'failed':'empty';
      const outcome=error&&qualified?'partial':status;
      return {
        name:source.name,sourceId:source.id,checkedAt:now.toISOString(),status,
        ...(error?{error:error.message}:{}),
        diagnosis:{startedAt:new Date(started).toISOString(),finishedAt,elapsedMs:Math.max(0,finished-started),outcome,counts,
          ...(error?{error}:{lastSuccessAt:finishedAt})},
      };
    },
  };
}

export async function readSourceBytes(url:string,allowed:(url:URL)=>boolean,accept:string,contentType:RegExp,limit:number,timeoutMs:number,keepSignal=false) {
  let target=new URL(url);
  const sharedSignal=keepSignal?AbortSignal.timeout(timeoutMs):undefined;
  for(let hop=0;hop<=3;hop++) {
    if(!allowed(target)) throw new SourceReadError('unknown','来源地址不在允许范围。');
    const response=await fetchNewsSource(target,{redirect:'manual',signal:sharedSignal??AbortSignal.timeout(timeoutMs),headers:{Accept:accept}});
    if([301,302,303,307,308].includes(response.status)) {
      const location=response.headers.get('location');
      if(!location||hop===3) throw new SourceReadError('http','来源跳转无效。',response.status);
      target=new URL(location,target);
      continue;
    }
    if(!response.ok) throw new SourceReadError('http',`来源返回 HTTP ${response.status}。`,response.status);
    if(!contentType.test(response.headers.get('content-type')||'')) throw new SourceReadError('parse','来源响应类型不支持。');
    if(Number(response.headers.get('content-length'))>limit) throw new SourceReadError('parse','来源响应超过大小限制。');
    const reader=response.body?.getReader();
    if(!reader) throw new SourceReadError('parse','来源响应没有正文。');
    const parts:Uint8Array[]=[];
    let size=0;
    for(;;) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.length;
      if(size>limit) {
        await reader.cancel();
        throw new SourceReadError('parse','来源响应超过大小限制。');
      }
      parts.push(value);
    }
    return Buffer.concat(parts);
  }
  throw new SourceReadError('http','来源跳转无效。');
}
