import Markdown from 'react-markdown';
import {parseNoteGrid} from '../../services/wiki/structured-note';
const pdfTableHeading=/^### .+（(?:PDF 页图 AI 解读|原文字层)）\s*$/u;

/** Only the paired writers' deep-note and PDF table blocks are rendered as grids. */
export function FormalNoteReader({body}:{body:string}){
  const marker='## 深度整理笔记\n',position=body.indexOf(marker);
  const deepNote=position>=0;
  const lines=(deepNote?body.slice(position+marker.length):body).split('\n');
  if(!deepNote&&!lines.some(line=>pdfTableHeading.test(line)))return <div className="formal-note-reader"><Markdown skipHtml>{body}</Markdown></div>;
  const parts:React.ReactNode[]=[];
  let prose:string[]=[],pdfTable=false;
  const flush=()=>{if(prose.length){parts.push(<Markdown key={'p'+parts.length} skipHtml>{prose.join('\n')}</Markdown>);prose=[];}};
  for(let i=0;i<lines.length;){
    if(/^#{1,3} /u.test(lines[i]))pdfTable=pdfTableHeading.test(lines[i]);
    const grid=deepNote||pdfTable?parseNoteGrid(lines,i):undefined;
    if(!grid){prose.push(lines[i++]);continue;}
    flush();
    parts.push(<div key={'t'+i} className="note-table-scroll"><table><thead><tr>{grid.headings.map((h,j)=><th key={j}><Markdown skipHtml>{h}</Markdown></th>)}</tr></thead><tbody>{grid.rows.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k}><Markdown skipHtml>{cell}</Markdown></td>)}</tr>)}</tbody></table></div>);
    i=grid.end;
  }
  flush();
  return <div className="formal-note-reader">{deepNote&&<><Markdown skipHtml>{body.slice(0,position)}</Markdown><h2>深度整理笔记</h2></>}{parts}</div>;
}
