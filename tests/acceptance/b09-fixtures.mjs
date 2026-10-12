import {reply as promptReply} from './b08-fixtures.mjs';
export function reply(wire){
 const text=wire.messages.find(m=>m.role==='user').content;
 if(text.includes('<<<\n')){
  const rawId=/rawId 填 "([0-9a-f-]{36})"/.exec(text)?.[1];
  const quote=text.split('<<<\n')[1].split('\n>>>')[0];
  return {document:{title:'B09独立浏览器来源',main_topic:'经销商订货流程',summary:'固定本地夹具，只用于接线验收'},suggested_pages:[{title:'B09经销商订货流程',type:'business_process',category:'distributor',one_line_definition:'整理订货流程的参与角色与核对步骤',source_facts:[{text:quote,evidenceIds:['ev1']}],ai_organized:['订货时先核对库存，再由负责人确认。'],ai_inferences:['可能存在人工核对成本，需进一步访谈验证。'],related_pages:[],open_questions:['异常订单由谁处理？'],source_evidence:[{id:'ev1',rawId,quote}]}]};
 }
 const u=JSON.parse(text);
 if(u.audit)return {replacement:'B09人工确认后的订货流程：先核对库存，再由负责人确认。',rationale:'固定本地夹具依据原文核对，仅用于流程验收。',evidence:[{rawId:u.raws[0].id,quote:u.raws[0].body}]};
 return promptReply(wire);
}
