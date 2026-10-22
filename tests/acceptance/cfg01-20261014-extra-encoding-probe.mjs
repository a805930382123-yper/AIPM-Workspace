import {encodeConfigValue,parseLocalEnvText,validateModel,validateApiKey} from '../../services/llm/config.ts';
const value='fixture-\ud800';
const model=validateModel(value),key=validateApiKey(value);
console.log(JSON.stringify({scope:'synthetic lone-surrogate serialization only',modelAccepted:true,keyAccepted:true,modelPreserved:parseLocalEnvText('FMCG_LLM_MODEL='+encodeConfigValue(model)).FMCG_LLM_MODEL===model,keyPreserved:parseLocalEnvText('FMCG_LLM_API_KEY='+encodeConfigValue(key)).FMCG_LLM_API_KEY===key}));
