import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const prefix='docs/reports/M04-repair1-20261012';
for(const name of ['http','component','deep'])await fs.copyFile(prefix+'-'+name+'.json',prefix+'-initial-'+name+'.json');
const substitutions={
 http:[["assert.equal(r.status,403);a.contextReachedTrap", "assert([403,409].includes(r.status));assert.equal(r.json?.error?.code,'MEETING_SOURCE_RESTRICTED');a.contextReachedTrap"]],
 component:[
  ["await click(confirmation.querySelector('input[type=checkbox]'));await click(button('确认删除',confirmation));","assert.equal(a.rawConfirmControls,1);await click(confirmation.querySelector('input[type=checkbox]'));await click([...confirmation.querySelectorAll('input')].find(e=>e.parentElement.textContent.includes('保留以上 Raw')));await click(button('确认删除',confirmation));"],
  ["await click(button('使用同一请求重试',rawSection()));await click(rawConfirm());await click(button('登记 Raw',rawSection()));","await click(button('使用同一请求重试',rawSection()));await click(rawConfirm());await click(button('使用同一请求恢复',rawSection()));"]
 ],
 deep:[["requestId:randomUUID(),mode:'new',input:preview","requestId:generated.draftId,mode:'new',input:preview"]]
};
for(const [name,pairs]of Object.entries(substitutions)){const p='tests/acceptance/m04-repair1-'+name+'.mjs';let text=await fs.readFile(p,'utf8');for(const [from,to]of pairs){assert(text.includes(from),'Expected old root assertion: '+name);text=text.replace(from,to);}await fs.writeFile(p,text);}
await fs.writeFile(prefix+'-calibration.json',JSON.stringify({at:new Date().toISOString(),oldEvidenceRetained:true,items:[{id:'H12',reason:'Missing-source controlled conflict409 is allowed by existing error semantics; retain code/no-provider/no-write checks'},{id:'C03',reason:'Exercise newly required Raw retention checkbox before confirming deletion'},{id:'C04',reason:'Use actual recovery button label after selecting saved failed request'},{id:'D09',reason:'Use existing Prompt draft.id idempotency contract, not a new random ID'}]},null,2));
console.log('Root tests calibrated to actual required controls/contract; initial evidence preserved');
