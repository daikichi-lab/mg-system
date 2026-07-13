// 実 mock(index.html) をヘッドレスで走らせ、各シナリオ・各期の st.result を golden.json に保存。
// これを TS エンジンの出力と突き合わせて数値一致（golden-master）を検証する。
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { scenarios } from './scenarios.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK = join(__dirname, '../../mock/index.html')
const SCRATCH = mkdtempSync(join(tmpdir(), 'mg-golden-'))
const CHROME = [
  join(process.env.HOME, '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
  join(process.env.HOME, '.cache/ms-playwright/chromium-1140/chrome-linux/chrome'),
].find(existsSync)
if (!CHROME) throw new Error('chromium not found in ms-playwright cache')

let h = readFileSync(MOCK, 'utf8')
h = h.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '')
h = h.replace(/<script>\s*tailwind\.config[\s\S]*?<\/script>/, '')
h = h.replace(/<link[^>]*fonts\.google[^>]*>/g, '').replace(/<link rel="preconnect"[^>]*>/g, '')

// mock スコープ内に golden ドライバを注入（描画は stub して純計算のみ）
const driver = `
;window.__gen = function(scs){
  const stub = ()=>{};
  try{ renderAll=stub }catch(e){}
  try{ renderClosing=stub }catch(e){}
  try{ renderStatement=stub }catch(e){}
  try{ renderHistory=stub }catch(e){}
  try{ renderReview=stub }catch(e){}
  try{ renderOpening=stub }catch(e){}
  try{ renderBoard=stub }catch(e){}
  try{ renderOrg=stub }catch(e){}
  try{ switchTab=stub }catch(e){}
  try{ saveLive=stub }catch(e){}
  try{ saveOrg=stub }catch(e){}
  const outAll = [];
  for(const sc of scs){
    Object.assign(st, newState());
    history.length = 0;
    if(sc.loanMult!=null) st.loanMult = sc.loanMult;
    if(sc.repayRate!=null) st.repayRate = sc.repayRate;
    st.name='X'; st.president='P'; st.org='O'; st.started=true;
    st.tx.push({id:st.seq++, label:'資本金', col:0, amount:sc.capital, isCapital:true});
    const results = [];
    sc.periods.forEach(function(acts, pi){
      acts.forEach(function(a){
        const def = ACTIONS[a.key];
        st.tx.push({id:st.seq++, key:a.key, fvals:a.fvals||{}, col:def.col, amount:(def.amount(a.fvals||{})||0)});
      });
      recompute();
      doClosingPrep();
      settle();
      const res = JSON.parse(JSON.stringify(st.result));
      delete res.rows;
      results.push(res);
      if(pi < sc.periods.length-1) nextPeriod();
    });
    outAll.push({ name: sc.name, results: results });
  }
  return outAll;
};
`
const idx = h.lastIndexOf('</script>')
h = h.slice(0, idx) + driver + h.slice(idx)

const scJson = JSON.stringify(scenarios)
const reporter = `
<div id="GEN" style="display:none"></div>
<script>
window.addEventListener('load', function(){ setTimeout(function(){
  try{ document.getElementById('GEN').textContent = JSON.stringify(window.__gen(${scJson})); }
  catch(e){ document.getElementById('GEN').textContent = 'ERR:'+e.message+'\\n'+(e.stack||''); }
}, 80); });
</script>`
h = h.replace('</body>', reporter + '</body>')

const tmp = join(SCRATCH, '_golden_mock.html')
writeFileSync(tmp, h)

const dom = execFileSync(
  CHROME,
  ['--headless=new', '--no-sandbox', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom', tmp],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)
const m = dom.match(/<div id="GEN"[^>]*>([\s\S]*?)<\/div>/)
if (!m) throw new Error('GEN element not found in dumped DOM')
let raw = m[1]
// HTMLエンティティを戻す
raw = raw.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
if (raw.startsWith('ERR:')) throw new Error('mock driver error: ' + raw)
const golden = JSON.parse(raw)
writeFileSync(join(__dirname, 'golden.json'), JSON.stringify(golden, null, 2))
console.log('golden.json written:', golden.length, 'scenarios,', golden.reduce((s, g) => s + g.results.length, 0), 'period-results')
golden.forEach((g) => console.log('  -', g.name, g.results.map((r) => `P${r.period}:G=${r.G},diff=${r.diff}`).join('  ')))
