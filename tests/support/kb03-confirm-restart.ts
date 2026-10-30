import {RawStore} from '../../services/raw/store.ts';
import {RawStateStore} from '../../services/raw/state.ts';
import {DraftStore} from '../../services/wiki/drafts.ts';
import {WikiStore} from '../../services/wiki/store.ts';
import {WikiCommitService} from '../../services/wiki/commits.ts';
const root=process.argv[2],raws=new RawStore(root),states=new RawStateStore(root),drafts=new DraftStore(root),wiki=new WikiStore(root,raws);
await Promise.all([raws.initialize(),states.initialize(),drafts.initialize(),wiki.initialize()]);
const commits=new WikiCommitService({root,rawStore:raws,rawStates:states,drafts,wikiStore:wiki});await commits.initialize();console.log(JSON.stringify(await commits.reconcile()));
