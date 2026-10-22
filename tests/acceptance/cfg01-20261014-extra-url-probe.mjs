import {containsKnownSecret,safeBaseUrl} from '../../services/llm/config.ts';
const key='a/b';let nested='a%2fb';for(let i=0;i<10;i++)nested=encodeURIComponent(nested);
for(const [label,value]of [['invalid-utf8-run','https://example.test/%61%2f%62%ff'],['deep-encoding','https://example.test/'+nested]]){
 let urlAccepted;try{safeBaseUrl(value);urlAccepted=true;}catch{urlAccepted=false;}
 console.log(JSON.stringify({label,urlAccepted,secretDetected:containsKnownSecret(value,[key])}));
}
