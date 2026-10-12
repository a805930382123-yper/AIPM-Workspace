// Independent deterministic race fixture: a new user file arrives after validation,
// immediately before the product renames an existing empty restore target.
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
const rename=fs.rename.bind(fs),target=process.env.B09_RACE_TARGET;
fs.rename=async(a,b)=>{
 if(target&&path.resolve(String(a))===path.resolve(target)&&String(b).includes('.empty-')){
  await fs.writeFile(path.join(target,'arrived-user-file.txt'),'B09 late user data must survive');
  await fs.writeFile(process.env.B09_RACE_OBSERVED,'injected before rename');
 }
 return rename(a,b);
};
syncBuiltinESMExports();
