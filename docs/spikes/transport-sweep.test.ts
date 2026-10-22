import { describe, it } from 'vitest';
import { KeyLink, packetise } from '../src/core/link';
import { marksFrom, decode, type KeyEvent } from '../src/core/decoder';
import { schedule } from '../src/core/timing';
import { seeded } from '../src/core/random';
const TIMING = { characterWpm: 18, effectiveWpm: 18, weighting: 3 };
const OFF = 1234567;
const NETS = [
  { name: 'same city, wired ', baseMs: 12, jitterMs: 6,  spikeRate: 0.001, spikeMs: 60,  lossRate: 0 },
  { name: 'home wifi        ', baseMs: 25, jitterMs: 25, spikeRate: 0.01,  spikeMs: 120, lossRate: 0.001 },
  { name: 'across Europe    ', baseMs: 45, jitterMs: 20, spikeRate: 0.005, spikeMs: 150, lossRate: 0.001 },
  { name: 'mobile, moving   ', baseMs: 60, jitterMs: 60, spikeRate: 0.04,  spikeMs: 300, lossRate: 0.01 },
  { name: 'hotel wifi, eve  ', baseMs: 90, jitterMs: 90, spikeRate: 0.08,  spikeMs: 450, lossRate: 0.02 },
];
const MSG = 'CQ CQ CQ DE A65XY A65XY K = UR RST 599 = NAME MOHAMMAD = QTH DUBAI = HW? = 73';
function keying(m){const e=[];for(const t of schedule(m,TIMING).tones){e.push({down:true,t:t.atMs});e.push({down:false,t:t.atMs+t.durationMs});}return e;}
function go(net, buf, seed, reliable){
  const sent = keying(MSG); const link = new KeyLink({bufferMs:buf}); const r:KeyEvent[]=[];
  const random = seeded(seed); const arr=[];
  for (const p of packetise(sent)) {
    const spike = random.next() < net.spikeRate ? random.next()*net.spikeMs : 0;
    let delay = net.baseMs + random.next()*net.jitterMs + spike;
    if (random.next() < net.lossRate) {
      // Unreliable: the packet is simply gone. Reliable (SCTP's default for a
      // data channel): it is retransmitted and arrives about one round trip
      // later, which the play-out buffer may well absorb.
      if (!reliable) continue;
      delay += 2 * net.baseMs + random.next()*net.jitterMs;
    }
    arr.push({p, at: p.t + OFF + delay});
  }
  arr.sort((a,b)=>a.at-b.at);
  for (const {p,at} of arr){ const s=link.receive(p,at); if(s) r.push({down:s.down,t:s.playAtMs}); }
  r.sort((a,b)=>a.t-b.t);
  const A=marksFrom(sent),B=marksFrom(r); const n=Math.min(A.length,B.length); let w=0;
  for(let i=0;i<n;i++) w=Math.max(w,Math.abs(A[i].durationMs-B[i].durationMs));
  const ok = decode(r,{tolerance:0.35}).text === decode(sent,{tolerance:0.35}).text;
  const st=link.stats;
  return {w, ok, lost: st.latePlayed+st.lateDropped, missing: st.missing, total: st.received};
}
describe('sweep',()=>{ it('prints',()=>{
  for (const reliable of [false, true]) {
   for (const buf of [200, 250]) {
    console.log(`\n--- ${reliable?'RELIABLE channel':'unreliable channel'}, buffer ${buf} ms ---`);
    for (const net of NETS) {
      let worst=0, lost=0, missing=0, bad=0, total=0;
      for (let s=1;s<=20;s++){ const r=go(net,buf,s,reliable); worst=Math.max(worst,r.w); lost+=r.lost; missing+=r.missing; total+=r.total; if(!r.ok) bad++; }
      console.log(`${net.name} worst err ${worst.toFixed(1).padStart(6)} ms | late ${String(lost).padStart(3)}/${total} | never arrived ${String(missing).padStart(3)} | runs wrong ${bad}/20`);
    }
   }
  }
});});
