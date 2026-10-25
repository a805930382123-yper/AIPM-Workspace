import {offlineOptions,installOfflineGuard} from './SYN01-PREP-20261025-core.mjs';

// No --real/--release/--config/--provider/transport option exists in this build.
let guard,lab;
try{
  const [command='selftest',...args]=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--mode'&&args[i+1])options.mode=args[++i];
    else if(args[i]==='--root'&&args[i+1])options.root=args[++i];
    else throw Error('UNSUPPORTED_ARGUMENT');
  }
  offlineOptions(options);if(!['selftest','serve'].includes(command))throw Error('UNKNOWN_COMMAND');
  if(command==='selftest'&&options.root)throw Error('SELFTEST_ROOT_OVERRIDE_DENIED');
  guard=installOfflineGuard();
  if(command==='selftest'){const {selftest}=await import('./SYN01-PREP-20261025-engineering.mjs');await selftest();}
  else{
    const {createLab}=await import('./SYN01-PREP-20261025-server.mjs');lab=await createLab(options);
    console.log(JSON.stringify({mode:'fake',simulationOnly:true,api:lab.base,root:lab.root,realCalls:0,stop:'Ctrl+C; restart with serve --root <same root>; no real mode available'}));
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});await lab.close();lab=null;
  }
}catch(error){console.error(error.code??error.message);process.exitCode=1;}
finally{if(lab)await lab.close();guard?.restore();}
