import {createRoot} from 'react-dom/client';
import {DraftReviewPage} from '../../app/pages/DraftReviewPage';
import '../../app/styles.css';
import '../../app/wiki.css';
import '../../app/b04.css';
const draftId=new URLSearchParams(location.search).get('draftId')!;
createRoot(document.getElementById('root')!).render(<DraftReviewPage draftId={draftId} onBack={()=>location.reload()} onOpenRaw={()=>{}} onCommitted={async()=>{}}/>);
