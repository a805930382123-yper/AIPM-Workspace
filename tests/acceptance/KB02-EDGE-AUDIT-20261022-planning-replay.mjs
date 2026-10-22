// Offline original seq148 schema replay; no Provider, service or writes.
import fs from 'node:fs/promises';import assert from'node:assert/strict';import{validateSchema}from'../../services/llm/schema-validator.ts';
const e=JSON.parse(await fs.readFile('docs/reports/KB02-EDGE-AUDIT-20261022-short-failure.json','utf8'));
const errors=validateSchema(e.planningResponse,e.schema);assert.deepEqual(errors,e.offlineErrors);assert.equal(errors.length,1);assert.equal(e.planningResponse.pages[1].type,'ai_application');assert(!e.schema.properties.pages.items.properties.type.enum.includes('ai_application'));assert(e.schema.properties.pages.items.properties.category.enum.includes('ai_application'));console.log(JSON.stringify({sequence:148,reproduced:true,errors,modelCalls:0}));
