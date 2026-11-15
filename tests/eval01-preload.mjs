import { appendFileSync } from 'node:fs';
globalThis.fetch=async()=>{appendFileSync(process.env.EVAL01_CALL_LOG,'call\n');return new Response(JSON.stringify({error:{message:'synthetic failure'}}),{status:500,headers:{'content-type':'application/json'}})};
