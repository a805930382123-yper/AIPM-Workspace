import fs from 'node:fs/promises';import path from 'node:path';import {syncBuiltinESMExports} from 'node:module';
const read=fs.readFile.bind(fs);let seen=0;
fs.readFile=async(file,...args)=>{
 if(process.env.B09_CHANGE_FILE&&path.resolve(String(file))===path.resolve(process.env.B09_CHANGE_FILE)&&++seen===2){
  await fs.writeFile(file,'B09 independently injected concurrent change');await fs.writeFile(process.env.B09_CHANGE_OBSERVED,'second snapshot changed');
 }
 return read(file,...args);
};syncBuiltinESMExports();
