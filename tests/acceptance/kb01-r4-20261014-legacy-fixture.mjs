// Keep historical fixture immutable; adapt only its prompt-metadata parser.
import {fakeReply as legacy} from './b05-fake-reply.mjs';
export {bodyA,bodyB,formulaA,formulaB} from './b05-fake-reply.mjs';
export function fakeReply(wire){
 const message=wire.messages.find(m=>m.role==='user');
 if(!message?.content.includes('<<<\n')||message.content.includes('rawId 填 "'))return legacy(wire);
 const rawId=message.content.match(/当前 Raw ID：([0-9a-f-]{36})/)?.[1];
 if(!rawId)throw Error('Independent legacy fixture cannot locate actual Raw metadata');
 const adapted={...wire,messages:wire.messages.map(m=>m===message?{...m,content:m.content+`\nrawId 填 "${rawId}"`}:m)};
 return legacy(adapted);
}
