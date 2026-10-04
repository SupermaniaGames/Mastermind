let mp;
try{mp=await import('./multiplayer.js')}catch(e){
  console.error('Firebase setup problem:',e);
  const why=String(e&&e.message||'').includes('Firebase config')?e.message:'Online play is not set up. Check firebase-config.js';
  const off=()=>{throw new Error(why)};
  mp={me:()=>null,onUser(cb){setTimeout(()=>cb(null))},signIn:off,signUp:off,guest:off,logout:async()=>{},createRoom:off,joinRoom:off,txRoom:off,watchRoom:off,setRoom:off,sendChat:off,watchChat:off,saveProfile:async()=>{},loadProfile:async()=>null};
}

const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const COLN=['Red','Blue','Green','Yellow','Orange','Purple','Teal','Pink'];
const ONLINE=false;   // friends mode is built in step 3; this flag switches it on
const S={mode:'pass',len:4,nc:6,rep:'on',max:10,how:'basics',swap:false};
let g=null,ctx={},upd=false,pendingRoom=null;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

const show=id=>$$('.sc').forEach(s=>s.hidden=s.id!=id);
const say=(id,m)=>$('#'+id).textContent=m||'';
const fe=e=>({'auth/email-already-in-use':'That username is taken','auth/invalid-credential':'Wrong username or password','auth/user-not-found':'Wrong username or password','auth/wrong-password':'Wrong username or password','auth/operation-not-allowed':'Turn on Email/Password sign-in in Firebase','auth/network-request-failed':'No connection','auth/admin-restricted-operation':'Turn on Anonymous sign-in in Firebase','permission-denied':'The database rules are blocking this. Add the mastermindRooms rules in Firebase.'}[e.code]||e.message||String(e));

/* ---------- rules (pure functions, reused by the computer and the online patches) ---------- */
// A code or a guess is an array of colour numbers 1..nc. In a row that is still being filled, 0 is an empty hole.
// Feedback: b = black pegs (right colour, right place), w = white pegs (right colour, wrong place).
// Black pegs are counted first, then every colour that is left over is matched at most once, so duplicates are never counted twice.
function score(code,guess){
  const cc=Array(10).fill(0),gc=Array(10).fill(0);let b=0;
  for(let i=0;i<code.length;i++){if(code[i]===guess[i])b++;else{cc[code[i]]++;gc[guess[i]]++}}
  let w=0;for(let c=1;c<10;c++)w+=Math.min(cc[c],gc[c]);
  return {b,w};
}
function randomCode(len,nc,rep){
  if(rep)return Array.from({length:len},()=>1+Math.floor(Math.random()*nc));
  const pool=Array.from({length:nc},(_,i)=>i+1);
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]]}
  return pool.slice(0,len);
}
const validCode=(c,len,nc,rep)=>Array.isArray(c)&&c.length==len&&c.every(x=>Number.isInteger(x)&&x>=1&&x<=nc)&&(rep||new Set(c).size==len);

/* ---------- sound: your files if present, otherwise synthesised ---------- */
let ac=null,muted=false,soundsLoaded=false;const bufs={};
try{muted=localStorage.getItem('mm_mute')=='1'}catch{}
const audio=()=>{
  if(!ac){try{ac=new(window.AudioContext||window.webkitAudioContext)()}catch{return null}}
  if(ac.state=='suspended')ac.resume();return ac;
};
async function loadSounds(){
  if(soundsLoaded)return;soundsLoaded=true;
  const a=audio();if(!a)return;
  for(const n of ['peg','submit','tick','win','lose','start']){
    try{const r=await fetch(n+'.mp3');if(!r.ok)continue;bufs[n]=await a.decodeAudioData(await r.arrayBuffer())}catch{}
  }
}
document.addEventListener('pointerdown',()=>{audio();loadSounds()},{passive:true});
function playBuf(n,v=1){
  const a=audio(),b=bufs[n];if(!a||muted||!b)return false;
  const s=a.createBufferSource(),gn=a.createGain();gn.gain.value=v;s.buffer=b;s.connect(gn).connect(a.destination);s.start();return true;
}
function tone(f,t0,d,type,v){
  const a=audio();if(!a||muted)return;
  const o=a.createOscillator(),gn=a.createGain(),t=a.currentTime+t0;
  o.type=type;o.frequency.setValueAtTime(f,t);gn.gain.setValueAtTime(v,t);gn.gain.exponentialRampToValueAtTime(.001,t+d);
  o.connect(gn).connect(a.destination);o.start(t);o.stop(t+d);
}
function slide(f0,f1,t0,d,type,v){
  const a=audio();if(!a||muted)return;
  const o=a.createOscillator(),gn=a.createGain(),t=a.currentTime+t0;
  o.type=type;o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+d);
  gn.gain.setValueAtTime(v,t);gn.gain.exponentialRampToValueAtTime(.001,t+d);
  o.connect(gn).connect(a.destination);o.start(t);o.stop(t+d);
}
// short plastic "clack": muffled noise tick plus a low thump
function clack(t0,v,f){
  const a=audio();if(!a||muted)return;
  const t=a.currentTime+t0,n=Math.floor(a.sampleRate*.04),buf=a.createBuffer(1,n,a.sampleRate),ch=buf.getChannelData(0);
  for(let i=0;i<n;i++)ch[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);
  const s=a.createBufferSource(),lp=a.createBiquadFilter(),gn=a.createGain();
  lp.type='lowpass';lp.frequency.value=f;gn.gain.value=v;s.buffer=buf;
  s.connect(lp).connect(gn).connect(a.destination);s.start(t);
  const o=a.createOscillator(),og=a.createGain();
  o.type='sine';o.frequency.setValueAtTime(150+f/12,t);o.frequency.exponentialRampToValueAtTime(70,t+.06);
  og.gain.setValueAtTime(v*.6,t);og.gain.exponentialRampToValueAtTime(.001,t+.08);
  o.connect(og).connect(a.destination);o.start(t);o.stop(t+.09);
}
const sfx={
  peg(){if(playBuf('peg'))return;clack(0,.4,1500)},
  submit(){if(playBuf('submit'))return;clack(0,.35,1100);clack(.09,.28,1700)},
  tick(){if(playBuf('tick',.6))return;clack(0,.12,3200)},
  start(){if(playBuf('start'))return;[392,523,659,784].forEach((f,i)=>tone(f,i*.11,.22,'triangle',.2));tone(1047,.5,.6,'triangle',.22)},
  win(){if(playBuf('win'))return;[523,659,784,1047,784,1047,1319].forEach((f,i)=>tone(f,i*.13,.32,'triangle',.22));tone(262,0,1,'sine',.14)},
  lose(){if(playBuf('lose'))return;slide(440,110,0,.6,'sawtooth',.13);slide(330,80,.3,.7,'sawtooth',.13)}
};
const setMuteLabel=()=>$('#mute').textContent=muted?'Muted':'Sound';
setMuteLabel();
$('#mute').onclick=()=>{muted=!muted;try{localStorage.setItem('mm_mute',muted?'1':'0')}catch{}setMuteLabel();if(!muted)sfx.peg()};

/* ---------- characters ---------- */
const AVS=['🦁','🐯','🐼','🦊','🐸','🐵','🦄','🐲','🤖','👑','🥷','🧙','👻','🐧','🦖','🐙'];
const myAv=()=>{try{return localStorage.getItem('mm_av')||AVS[0]}catch{return AVS[0]}};
const setAv=a=>{try{localStorage.setItem('mm_av',a)}catch{}if(mp.me())mp.saveProfile(a).catch(()=>{})};
function buildAvGrid(){
  const gr=$('#avgrid');gr.innerHTML='';
  AVS.forEach(a=>{
    const b=document.createElement('button');b.textContent=a;b.setAttribute('aria-label','Character '+a);
    b.classList.toggle('on',a==myAv());
    b.onclick=()=>{setAv(a);buildAvGrid()};gr.append(b);
  });
}

/* ---------- menu ---------- */
function markSeg(){
  $$('.seg').forEach(sg=>[...sg.children].forEach(b=>b.classList.toggle('on',String(S[sg.dataset.k])==b.dataset.v)));
  $$('.hp').forEach(p=>p.hidden=p.dataset.t!=S.how);
}
$$('.seg').forEach(sg=>sg.onclick=e=>{const b=e.target.closest('button');if(!b)return;S[sg.dataset.k]=isNaN(b.dataset.v)?b.dataset.v:+b.dataset.v;markSeg()});
markSeg();
// small diagrams on the How to play screen. Lines are split by /, a line is C: (code) or G: (guess), then the pegs,
// then | and the feedback. Pegs: R red, B blue, G green, Y yellow, O orange, P purple, T teal, K pink. Feedback: k black, w white, . empty.
const MINI={R:1,B:2,G:3,Y:4,O:5,P:6,T:7,K:8};
$$('.mx[data-s]').forEach(x=>{x.innerHTML=x.dataset.s.split('/').map(l=>{
  const [pg,fb]=l.slice(2).split('|');
  return '<div class="mr"><span class="ml">'+(l[0]=='C'?'Code':'Guess')+'</span>'+[...pg].map(c=>'<i class="mp c'+MINI[c]+'"></i>').join('')+
    (fb==null?'':'<span class="fb">'+[...fb].map(c=>'<i class="fp'+(c=='.'?'':' '+c)+'"></i>').join('')+'</span>')+'</div>';
}).join('')});

function renderMe(){
  const u=mp.me(),m=$('#me');m.innerHTML='';
  const ab=document.createElement('button');ab.className='avbtn';ab.textContent=myAv();ab.setAttribute('aria-label','Choose your character');
  ab.onclick=()=>{buildAvGrid();show('chars')};m.append(ab);
  const un=document.createElement('span');un.className='uname';un.textContent=u?u.name:'Not signed in';m.append(un);
  const b=document.createElement('button');b.className='btn';
  if(u){b.textContent='Log out';b.onclick=async()=>{await mp.logout();renderMe()}}
  else{b.textContent='Sign in';b.onclick=()=>show('auth')}
  m.append(b);
}
async function syncProfile(){
  try{const p=await mp.loadProfile();if(p&&p.mmav&&p.mmav!=myAv()){try{localStorage.setItem('mm_av',p.mmav)}catch{}renderMe()}}catch{}
}
mp.onUser(u=>{renderMe();if(u)syncProfile();tryPending()});
renderMe();
try{const lu=localStorage.getItem('mm_user');if(lu)$('#u').value=lu}catch{}

function leave(){
  [ctx.ru,ctx.cu].forEach(f=>{if(f)try{f()}catch{}});
  ['t1','t2','bt','bk','nx','rr','rt','nt'].forEach(k=>clearTimeout(ctx[k]));clearInterval(ctx.tt);
  (ctx.fx||[]).forEach(clearTimeout);ctx={};g=null;
  $('#result').hidden=true;closeDlg();$('#chat').hidden=true;$('#chatbtn').hidden=true;$('#chatbtn').classList.remove('new');
  $('#series').hidden=true;$('#note').textContent='';
  $('#rreplay').textContent='Replay';$('#rreplay').disabled=false;
}
function home(){leave();show('home');renderMe();applyUpdate()}

$$('[data-go]').forEach(b=>b.onclick=()=>{
  const v=b.dataset.go;
  if(v=='how'){S.how='basics';markSeg();return show('how')}
  if(v=='friends'){
    if(!ONLINE)return ask('Coming soon','Playing with friends online is not switched on in this version yet.','OK',()=>{},true);
    return show(mp.me()?'friends':'auth');
  }
  S.mode=v;markSeg();show('setup');
});

async function doAuth(create){
  const u=$('#u').value.trim(),p=$('#p').value;
  if(!/^[A-Za-z0-9_]{3,14}$/.test(u))return say('aerr','Username: 3-14 letters, numbers or _');
  if(p.length<6)return say('aerr','Password needs 6 or more characters');
  try{
    create?await mp.signUp(u,p):await mp.signIn(u,p);
    try{localStorage.setItem('mm_user',u)}catch{}
    say('aerr');$('#p').value='';
    if(create)mp.saveProfile(myAv()).catch(()=>{});else await syncProfile();
    afterAuth();
  }catch(e){say('aerr',fe(e))}
}
$('#guest').onclick=async()=>{
  const t=$('#u').value.trim(),name=/^[A-Za-z0-9_]{3,14}$/.test(t)?t:'Guest'+(1000+Math.floor(Math.random()*9000));
  try{await mp.guest(name);say('aerr');afterAuth()}catch(e){say('aerr',fe(e))}
};
$('#signin').onclick=()=>doAuth(false);
$('#signup').onclick=()=>doAuth(true);

function afterAuth(){renderMe();if(!ONLINE)return home();if(pendingRoom)tryPending();else if(!ctx.room)show('friends')}

/* ---------- game ---------- */
const nm=s=>g.names[s];
// timers for animations; all of them are cleared when the game is left
const later=(fn,ms)=>{(ctx.fx=ctx.fx||[]).push(setTimeout(()=>{if(g)fn()},ms))};
function note(m,ms){clearTimeout(ctx.nt);$('#note').textContent=m||'';if(m&&ms)ctx.nt=setTimeout(()=>{$('#note').textContent=''},ms)}

$('#play').onclick=()=>{S.swap=false;startGame()};
// g.phase: 'set' (the codemaker builds the code), 'cover' (phone is being passed), 'play' (guessing), 'done'
function startGame(){
  leave();
  const u=mp.me(),a1=myAv(),a2=AVS[(AVS.indexOf(a1)+1)%AVS.length],bot=S.mode=='bot';
  const maker=bot?2:(S.swap?2:1);   // seat 1 is the first player (against the computer: you), seat 2 the other
  g={mode:S.mode,bot,len:S.len,nc:S.nc,rep:S.rep=='on',max:S.max,maker,
     names:{1:u&&u.name||(bot?'You':'Player 1'),2:bot?'Computer':'Player 2'},avs:{1:a1,2:bot?'🤖':a2},
     code:[],rows:[],cur:Array(S.len).fill(0),sel:-1,pop:-1,anim:-1,busy:false,fresh:false,st:'play',phase:bot?'play':'set',win:false};
  if(bot)g.code=randomCode(g.len,g.nc,g.rep);
  show('game');$('#series').hidden=true;note('');
  buildCards();buildPalette();buildBoard();status();markCards();refreshControls();
  if(bot){sfx.start();focusRow()}
  else{
    const mk=nm(maker),br=nm(3-maker);
    ask(mk+': set the code',br+', please look away. '+mk+', tap colours to build a secret code, then tap Set code.','I am ready',()=>{sfx.start()},true,true);
  }
}

function buildCards(){
  const el=$('#cards');el.innerHTML='';
  [g.maker,3-g.maker].forEach((s,k)=>{
    const d=document.createElement('div');d.className='pc '+(k==0?'mk':'br r');d.dataset.s=s;
    d.innerHTML='<span class="av"></span><div class="pn"><b></b><small></small></div><i class="chip"></i>';
    d.querySelector('.av').textContent=g.avs[s];
    d.querySelector('b').textContent=g.names[s];
    d.querySelector('small').textContent=k==0?'Maker':'Breaker';
    el.append(d);
  });
  markCards();
}
const markCards=()=>$$('.pc').forEach(d=>{
  const s=+d.dataset.s;
  d.classList.toggle('act',!!g&&((g.phase=='set'&&s==g.maker)||(g.phase=='play'&&s!=g.maker)));
});
// the codemaker's chip shows a lock, the codebreaker's chip counts guesses used
function renderChips(){
  if(!g)return;
  $$('.pc').forEach(d=>{d.querySelector('.chip').textContent=+d.dataset.s==g.maker?'🔒':g.rows.length+'/'+g.max});
}
function status(){
  const s=$('#status');s.innerHTML='';
  if(!g)return;
  const i=document.createElement('i'),t=document.createElement('span');
  i.className=g.phase=='set'||g.phase=='cover'?'v1':'v2';
  if(g.phase=='set')t.textContent='Set the code';
  else if(g.phase=='cover')t.textContent='Pass the phone';
  else if(g.phase=='play')t.textContent='Guess '+(g.rows.length+1)+' of '+g.max;
  else t.textContent=g.win?'Code cracked':'Out of guesses';
  s.append(i,t);
}

/* ---------- board ---------- */
function buildPalette(){
  const p=$('#pal');p.innerHTML='';
  for(let c=1;c<=g.nc;c++){
    const b=document.createElement('button');b.className='pk';b.dataset.c=c;b.setAttribute('aria-label',COLN[c-1]);
    b.innerHTML='<i class="peg c'+c+'"></i>';b.onclick=()=>tapPal(c);p.append(b);
  }
}
// peg and row sizes depend on the phone: the row height from the screen height, the peg size from the width
function layout(){
  const pl=$('#plate');if(!g||!pl)return;
  const W=$('#board').clientWidth||340,n=g.max+1;
  const rh=Math.max(34,Math.min(54,Math.floor((innerHeight-390)/n)));
  const fc=Math.ceil(g.len/2),inner=W*0.86;
  const fit=p=>{const gp=p*.16,fs=Math.max(9,Math.round(p*.38));return p*.55+g.len*p+(g.len-1)*gp+fc*fs+(fc-1)*fs*.25+gp*3};
  let ps=Math.min(Math.round(rh*.8),46);
  while(ps>18&&fit(ps)>inner)ps--;
  const st=pl.style;
  st.setProperty('--rh',rh+'px');st.setProperty('--ps',ps+'px');st.setProperty('--g',(ps*.16).toFixed(1)+'px');
  st.setProperty('--fs',Math.max(9,Math.round(ps*.38))+'px');st.setProperty('--fc',fc);
}
addEventListener('resize',layout);
function buildBoard(){
  $('#board').innerHTML='<div id="plate"><div id="deck"><div id="shield"></div><div id="rows"></div></div></div>';
  layout();renderBoard();
}
function holeEl(j,val,live){
  const h=document.createElement('button');h.className='hole'+(live&&g.sel==j?' sel':'');h.dataset.j=j;h.disabled=!live;
  h.setAttribute('aria-label','Hole '+(j+1)+(val?', '+COLN[val-1]:', empty'));
  if(val){const p=document.createElement('i');p.className='peg c'+val+(live&&g.pop==j?' in':'');h.append(p)}
  if(live)h.onclick=()=>tapHole(j);
  return h;
}
// feedback pegs: black first, then white, then empty holes (their order does not point at any guess peg)
function fbEl(r,animate){
  const f=document.createElement('div');f.className='fb'+(r===0?' ghost':'');
  for(let k=0;k<g.len;k++){
    const t=r?(k<r.b?'k':k<r.b+r.w?'w':''):'';
    const p=document.createElement('i');p.className='fp'+(t?' '+t:'');
    if(t&&animate){p.classList.add('pop');p.style.setProperty('--del',(reduced?0:k*.14)+'s')}
    f.append(p);
  }
  return f;
}
function rowEl(i){
  const r=document.createElement('div'),done=i<g.rows.length,isCur=g.phase=='play'&&i==g.rows.length,live=isCur&&!g.busy;
  r.className='row'+(live?' cur':'');
  const n=document.createElement('span');n.className='num';n.textContent=i+1;
  const hs=document.createElement('div');hs.className='holes';
  for(let j=0;j<g.len;j++)hs.append(holeEl(j,done?g.rows[i].g[j]:isCur?g.cur[j]:0,live));
  r.append(n,hs,fbEl(done?g.rows[i]:null,done&&g.anim==i));
  return r;
}
// the shield row: while the code is being set it is the row you fill in; afterwards a lid covers it until the game ends
function shieldEl(){
  const r=document.createElement('div'),edit=g.phase=='set';
  r.className='row sh'+(edit?' cur':'');
  const n=document.createElement('span');n.className='num';n.textContent=edit?'✎':'🔒';
  const box=document.createElement('div');box.className='shbox';
  const hs=document.createElement('div');hs.className='holes';
  for(let j=0;j<g.len;j++)hs.append(holeEl(j,edit?g.cur[j]:g.phase=='done'?g.code[j]:0,edit&&!g.busy));
  box.append(hs);
  if(!edit){
    const lid=document.createElement('div');lid.className='lid';lid.innerHTML='<span>SECRET CODE</span>';box.append(lid);
    if(g.phase=='done'&&!g.fresh)box.classList.add('open');
  }
  r.append(n,box,fbEl(0));
  return r;
}
function renderBoard(){
  const s=$('#shield'),rw=$('#rows');if(!g||!s||!rw)return;
  s.innerHTML='';s.append(shieldEl());
  rw.innerHTML='';for(let i=0;i<g.max;i++)rw.append(rowEl(i));
  g.pop=-1;renderChips();
}
function refreshControls(){
  const ok=!!g&&!g.busy&&(g.phase=='set'||g.phase=='play');
  $('#submit').disabled=!(ok&&!g.cur.includes(0));
  $('#submit').textContent=g&&g.phase=='set'?'Set code':'Submit';
  $('#clearbtn').disabled=!(ok&&g.cur.some(x=>x));
  $$('#pal .pk').forEach(b=>{b.disabled=!ok||(g.phase=='set'&&!g.rep&&g.cur.includes(+b.dataset.c))});
}
function focusRow(){
  later(()=>{const r=$('#rows .row.cur')||$('#shield .row.cur');if(r&&r.scrollIntoView)r.scrollIntoView({block:'nearest',behavior:reduced?'auto':'smooth'})},60);
}
function shakeEl(e){if(!e)return;e.classList.remove('no');void e.offsetWidth;e.classList.add('no');later(()=>e.classList.remove('no'),400)}

/* ---------- guessing ---------- */
const canEdit=()=>!!g&&!g.busy&&(g.phase=='set'||g.phase=='play');
// tap a hole: a peg in it is taken out, and the next colour you tap goes into that hole
function tapHole(j){
  if(!canEdit())return;
  if(g.cur[j]){g.cur[j]=0;sfx.tick()}
  g.sel=j;renderBoard();refreshControls();
}
function tapPal(c){
  if(!canEdit())return;
  const i=g.sel>=0&&!g.cur[g.sel]?g.sel:g.cur.indexOf(0);
  if(i<0){note('The row is full. Tap Submit, or tap a peg to take it out.',2500);return}
  if(g.phase=='set'&&!g.rep&&g.cur.includes(c)){shakeEl($('#pal .pk[data-c="'+c+'"]'));note('Repeats are off, so the code cannot use a colour twice.',2800);return}
  g.cur[i]=c;g.sel=-1;g.pop=i;note('');sfx.peg();renderBoard();refreshControls();
}
$('#clearbtn').onclick=()=>{if(!canEdit())return;g.cur=Array(g.len).fill(0);g.sel=-1;renderBoard();refreshControls()};
$('#submit').onclick=()=>{
  if(!canEdit()||g.cur.includes(0))return;
  if(g.phase=='set')lockCode();else doGuess();
};

// Pass N Play: the code is locked in, the lid closes, and a cover screen hides everything while the phone is passed
function lockCode(){
  if(!validCode(g.cur,g.len,g.nc,g.rep))return;
  g.code=g.cur.slice();g.cur=Array(g.len).fill(0);g.sel=-1;g.phase='cover';
  renderBoard();status();markCards();refreshControls();sfx.submit();
  const mk=nm(g.maker),br=nm(3-g.maker);
  ask('Pass the phone',br+', it is your turn to crack the code. '+mk+', no peeking!','Start guessing',()=>{
    g.phase='play';renderBoard();status();markCards();refreshControls();sfx.start();focusRow();
  },true,true);
}
function doGuess(){
  const guess=g.cur.slice(),fb=score(g.code,guess);
  g.rows.push({g:guess,b:fb.b,w:fb.w});
  g.cur=Array(g.len).fill(0);g.sel=-1;g.busy=true;g.anim=g.rows.length-1;
  sfx.submit();renderBoard();status();refreshControls();
  const n=fb.b+fb.w,step=reduced?0:140;
  for(let k=0;k<n;k++)later(()=>sfx.tick(),k*step+150);
  later(afterGuess,reduced?120:n*step+330);
}
function afterGuess(){
  const r=g.rows[g.rows.length-1];g.busy=false;g.anim=-1;
  if(r.b==g.len)return finish(true);
  if(g.rows.length>=g.max)return finish(false);
  renderBoard();status();markCards();refreshControls();focusRow();
}
function finish(win){
  g.phase='done';g.st='done';g.win=win;g.busy=false;g.fresh=true;
  renderBoard();status();markCards();refreshControls();
  later(()=>{g.fresh=false;const b=$('#shield .shbox');if(b)b.classList.add('open')},150);
  if(win||!g.bot)sfx.win();else sfx.lose();
  ctx.t1=setTimeout(showResult,win?1700:1500);
}

/* ---------- online rooms (step 3) ---------- */
// an invite link (?room=1234) will join automatically once the player is signed in
(()=>{const q=new URLSearchParams(location.search).get('room');if(/^\d{4}$/.test(q||'')){pendingRoom=q;history.replaceState(null,'',location.pathname)}})();
function tryPending(){if(!pendingRoom)return;if(!ONLINE)pendingRoom=null}

/* ---- chat ---- */
function onChat(list){
  const box=$('#msgs'),u=mp.me();box.innerHTML='';
  list.forEach(m=>{
    const e=document.createElement('div');e.className='m'+(u&&m.uid==u.uid?' me':'');
    const b=document.createElement('b');b.textContent=m.name;
    const t=document.createElement('span');t.textContent=m.text;
    e.append(b,t);box.append(e);
  });
  box.scrollTop=box.scrollHeight;
  ctx.cl=list.length;
  if($('#chat').hidden){if(ctx.cl>(ctx.seen||0))$('#chatbtn').classList.add('new')}else ctx.seen=ctx.cl;
}
$('#chatbtn').onclick=()=>{$('#chat').hidden=false;ctx.seen=ctx.cl||0;$('#chatbtn').classList.remove('new');$('#msgs').scrollTop=$('#msgs').scrollHeight};
$('#cclose').onclick=()=>{$('#chat').hidden=true};
async function sendChatMsg(){
  const t=$('#ct').value.trim();if(!t||!ctx.room)return;
  $('#ct').value='';
  try{await mp.sendChat(ctx.room,t.slice(0,200))}catch(e){note(fe(e))}
}
$('#send').onclick=sendChatMsg;
$('#ct').onkeydown=e=>{if(e.key=='Enter')sendChatMsg()};

/* ---------- results ---------- */
function confetti(on){
  const cf=$('#confetti');cf.innerHTML='';
  if(on&&!reduced)for(let i=0;i<26;i++){
    const s=document.createElement('span');s.textContent=['🎉','✨','⭐','🎊'][i%4];
    s.style.left=Math.random()*100+'%';s.style.animationDuration=3+Math.random()*3+'s';s.style.animationDelay=Math.random()*3+'s';cf.append(s);
  }
}
function showResult(){
  if(!g||g.st!='done')return;
  const mk=g.maker,br=3-mk,used=g.rows.length,list=$('#rlist');list.innerHTML='';
  $('#rtitle').textContent=g.win?(g.bot?'You cracked it!':nm(br)+' cracked it!'):(g.bot?'Not this time':nm(mk)+' wins!');
  $('#rpegs').innerHTML=g.code.map(c=>'<i class="mp c'+c+'" title="'+COLN[c-1]+'"></i>').join('');
  const rows=[
    {s:br,tag:g.win?'cracked in '+used+(used==1?' guess':' guesses'):'missed · '+used+'/'+g.max},
    {s:mk,tag:'codemaker'}
  ];
  (g.win?rows:[rows[1],rows[0]]).forEach((x,i)=>{
    const row=document.createElement('div');row.className='rrow'+(i==0?' r0':'');
    const av=document.createElement('span');av.className='rav';av.textContent=g.avs[x.s];
    const n=document.createElement('span');n.className='nm';n.textContent=nm(x.s);
    const tag=document.createElement('span');tag.textContent=x.tag;
    row.append(av,n,tag);list.append(row);
  });
  confetti(g.win||!g.bot);
  $('#rreplay').textContent='Replay';$('#rreplay').disabled=false;
  $('#result').hidden=false;
}
$('#rmenu').onclick=home;
// Replay: against the computer a new code; in Pass N Play the two players swap roles
$('#rreplay').onclick=()=>{
  if(g&&g.mode=='pass')S.swap=!S.swap;
  $('#result').hidden=true;startGame();
};
$('#rshare').onclick=()=>shareApp('I just played Supermania Mastermind! Come play with me:');

/* ---------- share app ---------- */
async function shareApp(text){
  const url=location.origin+location.pathname.replace(/index\.html$/,'');
  text=text||'Play Supermania Mastermind with me!';
  if(navigator.share){try{await navigator.share({title:'Supermania Mastermind',text,url});return}catch(e){if(e.name=='AbortError')return}}
  window.open('https://wa.me/?text='+encodeURIComponent(text+'\n'+url),'_blank');
}
$('#shareapp').onclick=()=>shareApp();

/* ---------- "are you sure?" and the phone's back button ---------- */
// solid = a cover screen (Pass N Play) that hides the board while the phone is passed
function ask(title,text,yes,cb,info,solid){
  $('#dno').hidden=!!info;$('#dlg').classList.toggle('solid',!!solid);
  $('#dt').textContent=title;$('#dp').textContent=text;$('#dyes').textContent=yes;
  $('#dyes').onclick=()=>{closeDlg();cb()};$('#dno').onclick=closeDlg;$('#dlg').hidden=false;
}
const closeDlg=()=>{$('#dlg').hidden=true;$('#dlg').classList.remove('solid')};
const cur=()=>($$('.sc').find(s=>!s.hidden)||{}).id;
function leaveFlow(){
  const sc=cur();
  if(sc=='game'&&g&&g.st!='done')ask('Leave game?','Your game will be lost.','Leave',home);
  else home();
}
$$('[data-back]').forEach(b=>b.onclick=leaveFlow);
let armed=false,exiting=false;
document.addEventListener('pointerdown',()=>{if(!armed){armed=true;history.pushState({sm:1},'')}},{passive:true});
addEventListener('popstate',()=>{
  armed=false;
  if(exiting)return;
  if(!$('#dlg').hidden){if($('#dlg').classList.contains('solid'))$('#dyes').click();else closeDlg();return}
  if(!$('#result').hidden){home();return}
  if(cur()=='home')ask('Exit app?','Do you want to exit Supermania Mastermind?','Exit',()=>{exiting=true;try{window.close()}catch{}history.go(-2)});
  else leaveFlow();
});

/* ---------- updates come from the network, never a stale cache ---------- */
if('serviceWorker' in navigator){
  const had=!!navigator.serviceWorker.controller;let reloaded=false;
  navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>{
    r.update();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState=='visible')r.update()});
  });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had&&!reloaded){reloaded=true;upd=true;applyUpdate()}});
}
// Resuming an installed app does not reload it, so compare the files on the server with the ones this
// page started with. A newer version reloads the app as soon as it is on a menu screen (never mid-game).
async function fileSig(){
  let h=0;
  for(const f of ['index.html','main.js','multiplayer.js','style.css','manifest.json','firebase-config.js']){
    const r=await fetch(f,{cache:'no-store'});if(!r.ok)throw 0;
    const t=await r.text();for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))|0;
  }
  return h;
}
let sig0=null;
async function checkUpdate(){
  if(!navigator.onLine||document.visibilityState!='visible')return;
  try{const s=await fileSig();if(sig0===null)sig0=s;else if(s!==sig0)upd=true}catch{}
  applyUpdate();
}
function applyUpdate(){
  if(!upd)return;
  if(!['home','how','setup','chars','auth','friends'].includes(cur())||!$('#result').hidden||!$('#dlg').hidden)return;
  location.reload();
}
checkUpdate();
document.addEventListener('visibilitychange',checkUpdate);
setInterval(checkUpdate,120000);

/* ---------- install button ---------- */
let installEvt=null;
const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
let installedNow=false;
const showInstall=()=>{$('#install').hidden=!!standalone||installedNow};
addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;showInstall()});
addEventListener('appinstalled',()=>{installEvt=null;installedNow=true;showInstall()});
$('#install').onclick=async()=>{
  if(installEvt){installEvt.prompt();await installEvt.userChoice;installEvt=null;showInstall()}
  else if(isIOS)ask('Install on iPhone','Tap the Share button in Safari, then choose Add to Home Screen.','OK',()=>{},true);
  else installHelp();
};
// the browser has not offered its install prompt: say why it may be, and show what it sees
async function installHelp(){
  let m={};const mu=document.querySelector('link[rel=manifest]').href;
  try{m=await (await fetch(mu,{cache:'no-store'})).json()}catch{}
  const start=new URL(m.start_url||'.',mu),id=m.id?new URL(m.id,start.origin).href:'(none)',scope=new URL(m.scope||'.',mu).href;
  ask('Install app',
   'Chrome has not offered its install prompt. Try the 3 dot menu, then Install app or Add to Home screen.\n\n'+
   'If it says already installed, uninstall the older copy (long-press its icon, Uninstall), then clear this site\'s data in Chrome and reload.\n\n'+
   'This app sees:\nid: '+id+'\nscope: '+scope,'OK',()=>{},true);
}
showInstall();

