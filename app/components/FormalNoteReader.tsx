import Markdown from 'react-markdown';
import {parseNoteGrid} from '../../services/wiki/structured-note';
/** Only the paired writer's deep-note table grammar is rendered as a grid. */
export function FormalNoteReader({body}:{body:string}){
  const marker='## 深度整理笔记\n',position=body.indexOf(marker);
  if(position<0)return <pre className="wiki-body-view">{body}</pre>;
  const lines=body.slice(position+marker.length).split('\n'),parts:React.ReactNode[]=[];let prose:string[]=[];
  const flush=()=>{if(prose.length){parts.push(<Markdown key={'p'+parts.length} skipHtml>{prose.join('\n')}</Markdown>);prose=[];}};
  for(let i=0;i<lines.length;){const grid=parseNoteGrid(lines,i);if(!grid){prose.push(lines[i++]);continue;}flush();parts.push(<div key={'t'+i} className="note-table-scroll"><table><thead><tr>{grid.headings.map((h,j)=><th key={j}><Markdown skipHtml>{h}</Markdown></th>)}</tr></thead><tbody>{grid.rows.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k}><Markdown skipHtml>{cell}</Markdown></td>)}</tr>)}</tbody></table></div>);i=grid.end;}flush();
  return <div className="formal-note-reader"><pre className="wiki-body-view">{body.slice(0,position)}</pre><h2>深度整理笔记</h2>{parts}</div>;
}
