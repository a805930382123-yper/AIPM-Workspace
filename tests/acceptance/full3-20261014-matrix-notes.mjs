import fs from 'node:fs/promises';
const notes={R20:'真实双来源综合90秒超时，未获得一致观点/冲突/待确认结构',R22:'真实提取60秒超时，未能核验AI来源等级判断；历史人工编辑能力保留',R23:'真实多主题提取60秒超时，拆页粒度与按主题分离质量未获得',R24:'重复候选/决策机械能力沿用历史；真实更新依赖提取草稿未执行，预览与冲突质量不足'};
for(const file of ['docs/delivery-matrix.md','docs/reports/FULL3-20261014-spec-matrix.md']){const lines=(await fs.readFile(file,'utf8')).split('\n').map(l=>{const m=l.match(/^\| (R\d+) \|/);if(!m||!notes[m[1]])return l;const c=l.split(' | ');c[4]=notes[m[1]];return c.join(' | ')});await fs.writeFile(file,lines.join('\n'));}
