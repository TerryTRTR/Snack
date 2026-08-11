"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };
type Direction = "up" | "down" | "left" | "right";
type Player = { body: Point[]; dir: Direction; next: Direction; score: number; alive: boolean };
type GameState = { players: [Player, Player]; food: Point; running: boolean; winner: string; tick: number };

const COLS = 28, ROWS = 20;
const vectors: Record<Direction, Point> = { up: {x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0} };
const opposites: Record<Direction, Direction> = { up:"down", down:"up", left:"right", right:"left" };
const rtcConfig: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function initialGame(): GameState {
  return {
    players: [
      { body:[{x:6,y:10},{x:5,y:10},{x:4,y:10}], dir:"right", next:"right", score:0, alive:true },
      { body:[{x:21,y:10},{x:22,y:10},{x:23,y:10}], dir:"left", next:"left", score:0, alive:true }
    ], food:{x:14,y:10}, running:false, winner:"", tick:0
  };
}

function waitIce(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>(resolve => {
    const done = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", done); resolve(); } };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 5000);
  });
}

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const stateRef = useRef<GameState>(initialGame());
  const roleRef = useRef<0|1>(0);
  const [game, setGame] = useState(stateRef.current);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("还没有连接伙伴");
  const [code, setCode] = useState("");
  const [input, setInput] = useState("");
  const [panel, setPanel] = useState<"none"|"host"|"join">("none");

  const publish = useCallback((next: GameState) => {
    stateRef.current = next; setGame({...next});
    if (roleRef.current === 0 && channelRef.current?.readyState === "open") channelRef.current.send(JSON.stringify({type:"state", state:next}));
  }, []);

  const bindChannel = useCallback((ch: RTCDataChannel) => {
    channelRef.current = ch;
    ch.onopen = () => { setConnected(true); setStatus("已连接 · 可以开始啦"); setPanel("none"); };
    ch.onclose = () => { setConnected(false); setStatus("连接已断开"); };
    ch.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === "input" && roleRef.current === 0) {
        const s = stateRef.current, p = s.players[1];
        if (opposites[p.dir] !== msg.dir) p.next = msg.dir;
      }
      if (msg.type === "state" && roleRef.current === 1) { stateRef.current = msg.state; setGame({...msg.state}); }
      if (msg.type === "restart" && roleRef.current === 0) publish({...initialGame(), running:true});
    };
  }, [publish]);

  const makePc = useCallback(() => {
    pcRef.current?.close();
    const pc = new RTCPeerConnection(rtcConfig); pcRef.current = pc;
    pc.onconnectionstatechange = () => { if (["failed","disconnected","closed"].includes(pc.connectionState)) setStatus("连接中断，请重新建立房间"); };
    return pc;
  }, []);

  async function createRoom() {
    try {
      roleRef.current = 0; setPanel("host"); setStatus("正在生成邀请码…"); setCode("");
      const pc = makePc(), ch = pc.createDataChannel("snake", {ordered:true}); bindChannel(ch);
      await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc);
      setCode(btoa(unescape(encodeURIComponent(JSON.stringify(pc.localDescription))))); setStatus("把邀请码发给伙伴");
    } catch { setStatus("生成失败，请刷新后重试"); }
  }

  async function acceptOffer() {
    try {
      roleRef.current = 1; setStatus("正在读取邀请码…");
      const pc = makePc(); pc.ondatachannel = e => bindChannel(e.channel);
      const offer = JSON.parse(decodeURIComponent(escape(atob(input.trim()))));
      await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc);
      setCode(btoa(unescape(encodeURIComponent(JSON.stringify(pc.localDescription))))); setStatus("把应答码发回给房主");
    } catch { setStatus("邀请码无效，请重新复制完整内容"); }
  }

  async function acceptAnswer() {
    try {
      const answer = JSON.parse(decodeURIComponent(escape(atob(input.trim()))));
      await pcRef.current?.setRemoteDescription(answer); setStatus("正在建立点对点连接…");
    } catch { setStatus("应答码无效，请重新复制完整内容"); }
  }

  function copyCode() { navigator.clipboard.writeText(code); setStatus("连接码已复制"); }

  const steer = useCallback((dir: Direction) => {
    const s = stateRef.current, idx = roleRef.current, p = s.players[idx];
    if (opposites[p.dir] === dir) return;
    if (idx === 0) p.next = dir;
    else if (channelRef.current?.readyState === "open") channelRef.current.send(JSON.stringify({type:"input",dir}));
  }, []);

  function startGame() {
    if (!connected) return;
    if (roleRef.current === 0) publish({...initialGame(), running:true});
    else channelRef.current?.send(JSON.stringify({type:"restart"}));
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const map: Record<string,Direction> = {ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down",ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right"};
      if (map[e.key]) { e.preventDefault(); steer(map[e.key]); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [steer]);

  useEffect(() => {
    if (roleRef.current !== 0) return;
    const id = setInterval(() => {
      const old = stateRef.current; if (!old.running) return;
      const next: GameState = JSON.parse(JSON.stringify(old));
      const occupied = next.players.flatMap(p => p.body);
      next.players.forEach((p, idx) => {
        if (!p.alive) return; p.dir = p.next;
        const v=vectors[p.dir], head={x:p.body[0].x+v.x,y:p.body[0].y+v.y};
        const wall=head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS;
        const hit=occupied.some(q=>q.x===head.x&&q.y===head.y);
        if (wall||hit) { p.alive=false; return; }
        p.body.unshift(head);
        if (head.x===next.food.x&&head.y===next.food.y) {
          p.score++;
          const free:Point[]=[]; for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(!next.players.some(z=>z.body.some(q=>q.x===x&&q.y===y))) free.push({x,y});
          next.food=free[Math.floor(Math.random()*free.length)]||{x:14,y:10};
        } else p.body.pop();
        if (!next.players[idx].alive) return;
      });
      const alive=next.players.filter(p=>p.alive).length;
      if (alive<2) { next.running=false; next.winner=alive===0?"平局！两条小蛇撞在了一起":next.players[0].alive?"奶油蛇获胜！":"鼠尾草蛇获胜！"; }
      next.tick++; publish(next);
    }, 135); return () => clearInterval(id);
  }, [publish]);

  useEffect(() => {
    const canvas=canvasRef.current; if(!canvas) return; const ctx=canvas.getContext("2d")!;
    const dpr=Math.min(devicePixelRatio,2), rect=canvas.getBoundingClientRect(); canvas.width=rect.width*dpr; canvas.height=rect.height*dpr; ctx.scale(dpr,dpr);
    const cw=rect.width/COLS,ch=rect.height/ROWS;
    ctx.clearRect(0,0,rect.width,rect.height);
    ctx.fillStyle="#fffaf0"; ctx.fillRect(0,0,rect.width,rect.height);
    ctx.strokeStyle="rgba(93,113,83,.07)"; ctx.lineWidth=1;
    for(let x=1;x<COLS;x++){ctx.beginPath();ctx.moveTo(x*cw,0);ctx.lineTo(x*cw,rect.height);ctx.stroke()}
    for(let y=1;y<ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*ch);ctx.lineTo(rect.width,y*ch);ctx.stroke()}
    const fx=(game.food.x+.5)*cw,fy=(game.food.y+.5)*ch;
    ctx.fillStyle="#e98973";ctx.beginPath();ctx.arc(fx,fy,Math.min(cw,ch)*.32,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#6f8b61";ctx.beginPath();ctx.ellipse(fx+4,fy-7,4,2.3,-.6,0,Math.PI*2);ctx.fill();
    game.players.forEach((p,pi)=>p.body.forEach((q,i)=>{
      const pad=i===0?2:3;ctx.fillStyle=pi===0?"#d9a86c":"#738a68";ctx.beginPath();ctx.roundRect(q.x*cw+pad,q.y*ch+pad,cw-pad*2,ch-pad*2,6);ctx.fill();
      if(i===0){ctx.fillStyle="#fff";const dir=vectors[p.dir];const ox=dir.y?cw*.22:cw*.1,oy=dir.x?ch*.22:ch*.1;ctx.beginPath();ctx.arc((q.x+.5)*cw+ox,(q.y+.5)*ch+oy,1.8,0,7);ctx.arc((q.x+.5)*cw-ox,(q.y+.5)*ch-oy,1.8,0,7);ctx.fill()}
    }));
  }, [game]);

  return <main>
    <header><div className="brand"><span className="brandMark">S</span><div><b>暖窝双蛇</b><small>COZY SNAKES</small></div></div><div className={`connection ${connected?"online":""}`}><i />{connected?"伙伴在线":"等待伙伴"}</div></header>
    <section className="hero">
      <div className="intro"><span className="eyebrow">✦ 两个人，一场轻松较量</span><h1>隔着屏幕，<br/><em>一起长大。</em></h1><p>一款温柔的双人贪吃蛇。创建房间，把连接码递给朋友，不经过游戏服务器，快乐直接抵达。</p>
        <div className="actions"><button className="primary" onClick={createRoom}>创建房间 <span>→</span></button><button className="secondary" onClick={()=>{setPanel("join");setCode("");setInput("");setStatus("粘贴朋友发来的邀请码")}}>加入朋友</button></div>
        <div className="privacy"><span>⌁</span><div><b>点对点连接</b><small>游戏数据只在你们两人的浏览器间流动</small></div></div>
      </div>
      <div className="gameCard">
        <div className="scorebar"><div><i className="cream"/><span>奶油蛇</span><strong>{game.players[0].score.toString().padStart(2,"0")}</strong></div><div className="round">{game.running?"游戏中":game.winner||"好友对战"}</div><div className="right"><strong>{game.players[1].score.toString().padStart(2,"0")}</strong><span>鼠尾草蛇</span><i className="sage"/></div></div>
        <div className="board"><canvas ref={canvasRef}/>{!game.running&&<div className="overlay"><div className="leaf">❦</div><h2>{game.winner||"等待一位朋友"}</h2><p>{connected?"准备好后，开启你们的这一局":"连接成功后，游戏就会在这里开始"}</p><button disabled={!connected} onClick={startGame}>{connected?"开始游戏":"尚未连接"}</button></div>}</div>
        <div className="gameFooter"><span>方向键 / WASD 控制</span><div className="dpad"><button onClick={()=>steer("left")}>←</button><button onClick={()=>steer("up")}>↑</button><button onClick={()=>steer("down")}>↓</button><button onClick={()=>steer("right")}>→</button></div><span>先吃到 10 颗也很了不起</span></div>
      </div>
    </section>
    {panel!=="none"&&<div className="modalBackdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setPanel("none")}}><section className="modal"><button className="close" onClick={()=>setPanel("none")}>×</button><span className="eyebrow">{panel==="host"?"你的温暖小房间":"加入朋友的房间"}</span><h2>{panel==="host"?"邀请一位伙伴":"收到连接码了吗？"}</h2><p className="status">{status}</p>
      {panel==="host"&&<><label>你的邀请 / 连接码</label><textarea readOnly value={code} placeholder="正在准备…"/><button className="wide" disabled={!code} onClick={copyCode}>复制这段连接码</button><div className="divider"><span>收到伙伴的应答码后</span></div><label>粘贴应答码</label><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="在这里粘贴伙伴发回的内容"/><button className="outline wide" disabled={!input} onClick={acceptAnswer}>完成连接</button></>}
      {panel==="join"&&<><label>粘贴房主的邀请码</label><textarea value={input} onChange={e=>setInput(e.target.value)} placeholder="在这里粘贴朋友发来的内容"/><button className="wide" disabled={!input} onClick={acceptOffer}>生成应答码</button>{code&&<><div className="divider"><span>最后一步</span></div><label>把这段应答码发回房主</label><textarea readOnly value={code}/><button className="outline wide" onClick={copyCode}>复制应答码</button></>}</>}
    </section></div>}
  </main>;
}
