import * as THREE from "three";
import {PointerLockControls} from "three/addons/controls/PointerLockControls.js";

const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0x9bc9e8,28,125);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,180);
camera.position.set(0,18,0);
const renderer=new THREE.WebGLRenderer({antialias:false});
renderer.setSize(innerWidth,innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.querySelector("#game").appendChild(renderer.domElement);

const hemi=new THREE.HemisphereLight(0xbfe7ff,0x493c2c,1.5); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffffff,2.1); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-55;sun.shadow.camera.right=55;sun.shadow.camera.top=55;sun.shadow.camera.bottom=-55; scene.add(sun);

const controls=new PointerLockControls(camera,document.body);
const blocks={grass:{c:0x55a83d},dirt:{c:0x8b5a36},stone:{c:0x777a7c},sand:{c:0xd7c27b},wood:{c:0x76502e},leaves:{c:0x3d8f42},plank:{c:0xa87845},glass:{c:0x9dd9e8,t:.42},coal:{c:0x272727},iron:{c:0xb7a99a},gold:{c:0xe7bd3d},diamond:{c:0x48d8e8},brick:{c:0x9b473b},glow:{c:0xf3c451},water:{c:0x3c83d1,t:.5}};
const keys=Object.keys(blocks);
const mats={}; for(const [k,b] of Object.entries(blocks)){mats[k]=new THREE.MeshLambertMaterial({color:b.c,transparent:!!b.t,opacity:b.t||1});}
const geo=new THREE.BoxGeometry(1,1,1), world=new Map(), meshes=new Map();
const CHUNK=16, R=3, SEA=7, MAXY=30;
const key=(x,y,z)=>x+","+y+","+z;
const hash=(x,z)=>{let n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n)};
function noise(x,z){let v=0,a=1,s=0;for(let i=0;i<4;i++){v+=Math.sin(x*a*.055+z*a*.041)*a+s; a*=2;s+=a}return v*.55+Math.sin(x*.19)*1.2+Math.cos(z*.17)*1.1}
function height(x,z){let h=Math.floor(11+noise(x,z)); return Math.max(3,Math.min(MAXY-4,h))}
function setBlock(x,y,z,t){const k=key(x,y,z);if(t)world.set(k,t);else world.delete(k);syncBlock(x,y,z)}
function syncBlock(x,y,z){const k=key(x,y,z),old=meshes.get(k);if(old){scene.remove(old);meshes.delete(k)}const t=world.get(k);if(!t)return;const m=new THREE.Mesh(geo,mats[t]);m.position.set(x+.5,y+.5,z+.5);m.castShadow=true;m.receiveShadow=true;m.userData.block={x,y,z,t};scene.add(m);meshes.set(k,m)}
function generate(){for(let x=-CHUNK*R;x<=CHUNK*R;x++)for(let z=-CHUNK*R;z<=CHUNK*R;z++){let h=height(x,z);for(let y=0;y<=h;y++){let t=y===h?(h<=SEA?"sand":"grass"):y>h-3?"dirt":"stone";if(y>2&&y<h-3){let r=hash(x*7+y,z*11+y);if(r>.982)t="diamond";else if(r>.965)t="gold";else if(r>.94)t="iron";else if(r>.91)t="coal"}setBlock(x,y,z,t)}if(h<SEA)for(let y=h+1;y<=SEA;y++)setBlock(x,y,z,"water");if(h>SEA+2&&hash(x,z)>.972)tree(x,h+1,z)}} 
function tree(x,y,z){for(let i=0;i<4;i++)setBlock(x,y+i,z,"wood");for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=2;dy<=4;dy++)if(Math.abs(dx)+Math.abs(dz)+(dy===4?1:0)<5)setBlock(x+dx,y+dy,z+dz,"leaves")}
generate();

const player={vel:new THREE.Vector3(),onGround:false,health:20};
const pressed={}; addEventListener("keydown",e=>{pressed[e.code]=true;if(e.code==="KeyE")toggleInv();if(/^Digit[1-9]$/.test(e.code)){selected=+e.code.slice(5)-1;renderHotbar()}});
addEventListener("keyup",e=>pressed[e.code]=false);
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
const ray=new THREE.Raycaster(); let selected=0,invOpen=false;
const inventory={grass:64,dirt:64,stone:64,wood:32,plank:32,sand:32,coal:16,iron:16,gold:8,diamond:4,brick:32,glass:16,glow:8};
const hot=["grass","dirt","stone","wood","plank","sand","glass","brick","glow"];
function renderHotbar(){const el=document.querySelector("#hotbar");el.innerHTML=hot.map((t,i)=>`<div class="slot ${i===selected?"selected":""}"><span class="key">${i+1}</span><div class="swatch" style="background:#${blocks[t].c.toString(16).padStart(6,"0")}"></div><span class="count">${inventory[t]||0}</span></div>`).join("")}
renderHotbar();
function renderInv(){document.querySelector("#inventory-grid").innerHTML=Object.keys(inventory).map(t=>`<div class="invslot"><div class="swatch" style="background:#${blocks[t].c.toString(16).padStart(6,"0")}"></div><span class="count">${inventory[t]}</span></div>`).join("")}
function toggleInv(){invOpen=!invOpen;document.querySelector("#inventory").classList.toggle("hidden",!invOpen);if(invOpen)controls.unlock();else if(!document.querySelector("#menu").classList.contains("hidden")){}renderInv()}
document.querySelector("#play").onclick=()=>{document.querySelector("#menu").classList.add("hidden");controls.lock()};
controls.addEventListener("lock",()=>document.querySelector("#hint").style.opacity=.75);
controls.addEventListener("unlock",()=>{if(!invOpen)document.querySelector("#hint").textContent="Paused · click to resume"});
renderer.domElement.addEventListener("click",()=>{if(!invOpen&&!controls.isLocked&&!document.querySelector("#menu").classList.contains("hidden")===false)controls.lock()});
addEventListener("mousedown",e=>{if(!controls.isLocked||invOpen)return;ray.setFromCamera({x:0,y:0},camera);const hits=ray.intersectObjects([...meshes.values()]);if(!hits.length)return;const hit=hits[0],b=hit.object.userData.block;if(e.button===0){setBlock(b.x,b.y,b.z,null);inventory[b.t]=(inventory[b.t]||0)+1;flash("+"+b.t)}if(e.button===2){const n=hit.face.normal;const x=b.x+n.x,y=b.y+n.y,z=b.z+n.z,t=hot[selected];if(!world.has(key(x,y,z))&&(inventory[t]||0)>0){setBlock(x,y,z,t);inventory[t]--;flash(t)}}renderHotbar()});
addEventListener("contextmenu",e=>e.preventDefault());
function flash(s){const el=document.querySelector("#status");el.textContent=s;el.style.opacity=1;clearTimeout(flash.t);flash.t=setTimeout(()=>el.style.opacity=0,700)}

let gameTime=6*60, last=performance.now();
function solidAt(x,y,z){return world.has(key(Math.floor(x),Math.floor(y),Math.floor(z)))&&world.get(key(Math.floor(x),Math.floor(y),Math.floor(z)))!=="water"}
function collide(pos){const r=.32,h=1.7;return [[pos.x-r,pos.y,pos.z-r],[pos.x+r,pos.y,pos.z+r],[pos.x-r,pos.y+h,pos.z-r],[pos.x+r,pos.y+h,pos.z+r]].some(p=>solidAt(p[0],p[1],p[2]))}
function move(dt){if(!controls.isLocked||invOpen)return;let dir=new THREE.Vector3((pressed.KeyD?1:0)-(pressed.KeyA?1:0),0,(pressed.KeyS?1:0)-(pressed.KeyW?1:0));if(dir.lengthSq())dir.normalize();dir.applyQuaternion(camera.quaternion);dir.y=0;const speed=pressed.ShiftLeft?7.2:4.7;player.vel.x=THREE.MathUtils.lerp(player.vel.x,dir.x*speed,12*dt);player.vel.z=THREE.MathUtils.lerp(player.vel.z,dir.z*speed,12*dt);player.vel.y-=24*dt;if(pressed.Space&&player.onGround){player.vel.y=9;player.onGround=false}const old=camera.position.clone();camera.position.x+=player.vel.x*dt;if(collide(camera.position))camera.position.x=old.x;camera.position.z+=player.vel.z*dt;if(collide(camera.position))camera.position.z=old.z;camera.position.y+=player.vel.y*dt;player.onGround=false;for(let y=-2;y<=2;y++){if(collide(camera.position)){camera.position.y=old.y;if(player.vel.y<0)player.onGround=true;player.vel.y=0;break}}if(camera.position.y<1)camera.position.set(camera.position.x,20,camera.position.z)}
function updateSky(dt){gameTime=(gameTime+dt*2)%1440;const a=(gameTime/1440)*Math.PI*2-Math.PI/2;sun.position.set(Math.cos(a)*50,Math.sin(a)*50,20);sun.intensity=Math.max(.15,Math.sin(a)*1.8+.3);hemi.intensity=Math.max(.25,Math.sin(a)*.8+.7);const day=Math.max(0,Math.sin(a));scene.background=new THREE.Color().setHSL(.56,.55,.16+day*.34);scene.fog.color=scene.background;const h=Math.floor(gameTime/60),m=Math.floor(gameTime%60);document.querySelector("#time").textContent=`DAY 1 · ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function updateHud(){document.querySelector("#coords").textContent=`XYZ ${Math.floor(camera.position.x)} / ${Math.floor(camera.position.y)} / ${Math.floor(camera.position.z)}`}
function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;move(dt);updateSky(dt);updateHud();renderer.render(scene,camera);requestAnimationFrame(loop)}
camera.position.set(.5,height(0,0)+2,.5); requestAnimationFrame(loop);
