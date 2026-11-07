import { WebGLRadix2FFT } from '../engine/render/WebGLRadix2FFT.js';
import {
	WAKE_CELL_SIZE as CELL, WAKE_DOMAIN_SIZE as SIZE,
	WAKE_GRID_SIZE as N, WAKE_SPONGE_CELLS as SPONGE,
} from './WakeConstants.js';

const vertexShader = /* glsl */`in vec3 position;
void main() { gl_Position = vec4( position, 1.0 ); }
`;

const fullscreen = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D uFFTSource;
uniform sampler2D uNearSource;
uniform sampler2D uState;
uniform sampler2D uAeration;
uniform sampler2D uTerrain;
uniform sampler2D uHull;
uniform sampler2D uPiles;
uniform vec2 uOrigin;
uniform vec2 uPrevOrigin;
uniform vec2 uBoatPos;
uniform vec2 uBoatRot;
uniform vec3 uTrim;
uniform vec4 uPileBox;
uniform vec4 uHullBox;
uniform vec4 uTerrainBox;
uniform float uTerrainRes;
uniform float uSeaLevel;
uniform float uTime;
uniform float uDt;
uniform float uReset;
uniform float uSpeed;
uniform float uAmount;
uniform float uPressureGain;
uniform float uWash;
uniform float uBow;
uniform float uWashW;
uniform float uDyn;
uniform float uHollow;
uniform float uHollowK;
uniform float uFoamGain;
uniform float uAerGain;
uniform float uVisc;
uniform float uBoil;
uniform float uNearRate;
uniform vec2 uNearRange;
uniform vec2 uNearBoat;
uniform vec2 uNearRot;
uniform float uNearReset;
uniform float uPass;
layout(location=0) out vec4 outValue;

const float PI = 3.141592653589793;
const float G = 9.80665;
const float WAKE_CELL = ${CELL.toFixed(1)};
const float WAKE_SIZE = ${SIZE.toFixed(1)};
const float WAKE_N = ${N.toFixed(1)};
const float WAKE_MASK = ${N - 1}.0;

float hash2(vec2 p) {
  uvec2 q=uvec2(ivec2(floor(p)));
  uint v=(q.x*0x8da6b343u)^(q.y*0xd8163841u);
  v=(v^(v>>13u))*0x5bd1e995u; v=v^(v>>15u);
  return float(v>>8u)*(1.0/16777216.0);
}
float noise2(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1.0,0.0)),f.x),mix(hash2(i+vec2(0.0,1.0)),hash2(i+1.0),f.x),f.y);
}
float smoothstepInv(float edgeNear,float edgeFar,float x) { return 1.0-smoothstep(edgeFar,edgeNear,x); }
ivec2 wrapI(ivec2 p) { return ivec2((p.x%${N}+${N})%${N},(p.y%${N}+${N})%${N}); }
vec2 worldCell(ivec2 texel) {
  vec2 origin=floor(uOrigin+0.5);
  vec2 offset=mod(vec2(texel)-mod(origin,WAKE_N)+WAKE_N,WAKE_N);
  return origin+offset;
}
vec2 worldPos(ivec2 texel) { return (worldCell(texel)+0.5)*WAKE_CELL; }
bool previousValid(vec2 cell) {
  vec2 prev=floor(uPrevOrigin+0.5);
  return uReset<0.5 && all(greaterThanEqual(cell,prev)) && all(lessThan(cell,prev+WAKE_N));
}
float terrainAt(vec2 p) {
  vec2 f=(p-uTerrainBox.xy)/uTerrainBox.zw*uTerrainRes-0.5;
  if(any(lessThan(f,vec2(0.0)))||any(greaterThan(f,vec2(uTerrainRes-1.0)))) return -90.0;
  vec2 fc=clamp(f,vec2(0.0),vec2(uTerrainRes-1.001));
  return texture2D(uTerrain,(fc+0.5)/uTerrainRes).r;
}
float immersionAt(vec2 boatLocal) {
  vec2 uv=vec2(abs(boatLocal.x)/uHullBox.x,(boatLocal.y-uHullBox.y)/(uHullBox.z-uHullBox.y));
  float D=texture2D(uHull,uv).r;
  return max(D+uTrim.x+uTrim.y*boatLocal.x+uTrim.z*boatLocal.y,0.0)*smoothstep(0.0,0.04,D);
}
float pressureAt(vec2 p) {
  vec2 rel=p-uBoatPos;
  vec2 boat=vec2(rel.x*uBoatRot.x-rel.y*uBoatRot.y,rel.x*uBoatRot.y+rel.y*uBoatRot.x);
  float Ph=immersionAt(boat), e=0.7;
  float entry=max((immersionAt(boat-vec2(0.0,e))-immersionAt(boat+vec2(0.0,e)))/(2.0*e),0.0);
  float aft=uHullBox.w-boat.y;
  float hollow=immersionAt(vec2(boat.x,uHullBox.w+0.25))*exp(-max(aft,0.0)/uHollow)*smoothstep(-0.3,0.3,aft);
  return (max(Ph,hollow*uHollowK)+entry*uDyn)*uPressureGain;
}
vec4 depthWeights(float d) {
  float t0=1.0-exp((d-6.0)/-9.0);
  float t1=pow(clamp((d-1.8)/4.2,0.0,1.0),0.8);
  float t2=pow(clamp((d-0.6)/1.2,0.0,1.0),0.85);
  float w0=d>6.0?t0:0.0;
  float w1=d>6.0?1.0-t0:(d>1.8?t1:0.0);
  float w2=d>6.0?0.0:(d>1.8?1.0-t1:(d>0.6?t2:0.0));
  float w3=d>1.8?0.0:(d>0.6?1.0-t2:clamp(d/0.6,0.0,1.0));
  return sqrt(max(vec4(w0,w1,w2,w3),vec4(0.0)));
}
float pileCover(vec2 p) {
  vec2 uv=(p-uPileBox.xy)/uPileBox.zw;
  if(any(lessThan(uv,vec2(0.0)))||any(greaterThan(uv,vec2(1.0)))) return 0.0;
  return texture2D(uPiles,uv).r;
}
vec4 loadWakeState(ivec2 texel) {
  ivec2 wrapped=wrapI(texel);
  return previousValid(worldCell(wrapped))?texelFetch(uState,wrapped,0):vec4(0.0);
}
float loadWakeAeration(ivec2 texel) {
  ivec2 wrapped=wrapI(texel);
  return previousValid(worldCell(wrapped))?texelFetch(uAeration,wrapped,0).r:0.0;
}
vec4 evaluateWakeCell(ivec2 texel,out float aer) {
  vec2 p=worldPos(texel);
  ivec2 left=wrapI(texel+ivec2(-1,0)),right=wrapI(texel+ivec2(1,0));
  ivec2 down=wrapI(texel+ivec2(0,-1)),up=wrapI(texel+ivec2(0,1));
  vec4 prev=loadWakeState(texel),sL=loadWakeState(left),sR=loadWakeState(right),sD=loadWakeState(down),sU=loadWakeState(up);
  float aC=loadWakeAeration(texel),aL=loadWakeAeration(left),aR=loadWakeAeration(right),aD=loadWakeAeration(down),aU=loadWakeAeration(up);
  vec2 rel=p-uBoatPos;
  vec2 boat=vec2(rel.x*uBoatRot.x-rel.y*uBoatRot.y,rel.x*uBoatRot.y+rel.y*uBoatRot.x);
  float Ph=immersionAt(boat),e=0.7;
  float entry=max((immersionAt(boat-vec2(0.0,e))-immersionAt(boat+vec2(0.0,e)))/(2.0*e),0.0);
  float aft=uHullBox.w-boat.y;
  float hollow=immersionAt(vec2(boat.x,uHullBox.w+0.25))*exp(-max(aft,0.0)/uHollow)*smoothstep(-0.3,0.3,aft);
  float P=(max(Ph,hollow*uHollowK)+entry*uDyn)*uPressureGain;
  float h=uReset>0.5?-P:prev.x;
  float d=uSeaLevel-terrainAt(p),pile=pileCover(p);
  float wet=smoothstep(0.0,0.05,d),keep=wet*clamp(1.0-pile*2.5,0.0,1.0);
  float gx=(sR.x-sL.x)/(2.0*WAKE_CELL),gz=(sU.x-sD.x)/(2.0*WAKE_CELL),slope=length(vec2(gx,gz));
  float brk=clamp((slope-0.2)/0.2,0.0,1.0)*(1.0-smoothstep(0.0,0.03,P));
  float surf=clamp((h-d*0.42)/max(d*0.3,0.03),0.0,1.0)*wet;
  float turb=prev.w;
  float inWash=smoothstep(-0.6,0.3,aft)*smoothstepInv(7.0,1.5,aft)*smoothstepInv(uWashW+max(aft,0.0)*0.1,(uWashW+max(aft,0.0)*0.1)*0.3,abs(boat.x));
  float patchN=noise2(p*0.45+uTime*0.13),streak=noise2(vec2(boat.x*1.7,uTime*0.9));
  float race=smoothstepInv(7.0,0.0,aft)*0.9;
  float along=p.x*uBoatRot.y+p.y*uBoatRot.x,across=p.x*uBoatRot.x-p.y*uBoatRot.y;
  float streaks=noise2(vec2(along*0.12,across*0.9))*0.7+noise2(vec2(along*0.3,across*1.9)+5.3)*0.3;
  float mottle=clamp((streaks-0.5)*3.2,-0.85,0.85)+1.0;
  float washGen=inWash*uWash*(uSpeed+1.5)*(streak*patchN*0.6+race+0.08)*mix(mottle,1.0,smoothstepInv(3.0,0.0,aft)*0.7);
  float outside=1.0-smoothstep(0.0,0.03,Ph);
  float nearHull=smoothstep(0.0,0.03,immersionAt(vec2(max(abs(boat.x)-0.9,0.0),boat.y)));
  float bowBand=outside*nearHull*smoothstep(-0.5,1.2,boat.y)*smoothstepInv(4.2,3.2,boat.y);
  float bowGen=bowBand*uBow*(uSpeed+1.0)*(noise2(vec2(boat.y*1.5,uTime*3.0))*1.4+0.1)*0.35;
  float nuC=min(turb*0.6,1.0)+uVisc;
  float flux=((nuC+min(sL.w*0.6,1.0)+uVisc)*(sL.y-prev.y)+(nuC+min(sR.w*0.6,1.0)+uVisc)*(sR.y-prev.y)
    +(nuC+min(sD.w*0.6,1.0)+uVisc)*(sD.y-prev.y)+(nuC+min(sU.w*0.6,1.0)+uVisc)*(sU.y-prev.y))*(0.5/(WAKE_CELL*WAKE_CELL));
  float boil=0.0;
  if(turb+sL.w+sR.w+sD.w+sU.w>0.02){
    vec2 drift=vec2(uTime*0.5,uTime*-0.35);
    float c0=(noise2(p*0.45+drift)-0.5)*min(turb,1.5);
    boil=(noise2((p-vec2(WAKE_CELL,0.0))*0.45+drift)-0.5)*min(sL.w,1.5)
      +(noise2((p+vec2(WAKE_CELL,0.0))*0.45+drift)-0.5)*min(sR.w,1.5)
      +(noise2((p-vec2(0.0,WAKE_CELL))*0.45+drift)-0.5)*min(sD.w,1.5)
      +(noise2((p+vec2(0.0,WAKE_CELL))*0.45+drift)-0.5)*min(sU.w,1.5)-c0*4.0;
  }
  float w1=(prev.y+flux*uDt+boil*(uDt*uBoil))*exp(uDt*-0.006)*keep;
  float lapF=(sL.z+sR.z+sD.z+sU.z-prev.z*4.0)/(WAKE_CELL*WAKE_CELL);
  float f0=max(prev.z+lapF*min(uDt*(turb*0.3+0.04),0.03),0.0);
  float gen=(washGen+bowGen+brk*3.0+surf*4.0)*uFoamGain;
  float breakup=noise2(p*0.17+vec2(13.1,7.3))*0.65+noise2(p*0.55+vec2(3.7,1.9))*0.35;
  float clearRate=smoothstep(0.3,0.72,breakup)*2.6+0.2;
  float foam=min(f0*exp(-uDt*(f0*f0*0.6+clearRate/35.0))+gen*uDt,3.0);
  float turb1=min(turb*exp(uDt*-1.0/6.0)+(inWash*uWash*(uSpeed+1.5)*0.5+brk*4.0+surf*6.0)*uDt,3.0);
  float lapA=aL+aR+aD+aU-aC*4.0;
  float a0=max(aC+lapA*min((turb*0.35+0.07)*uDt/(WAKE_CELL*WAKE_CELL),0.2),0.0);
  float wA=uWashW*(noise2(p*0.22+uTime*0.05)*0.8+0.8);
  float aerBand=smoothstep(-0.6,0.3,aft)*smoothstepInv(9.0,2.0,aft)*smoothstepInv(wA,wA*0.2,abs(boat.x));
  float aerGen=(aerBand*uWash*(uSpeed+1.5)*((race*1.2+0.15)*(patchN*1.3+streak*0.5+0.1))*(mottle*mottle*0.55)+bowGen*0.6+brk*1.5+surf*2.0)*uAerGain;
  float rise=smoothstep(0.25,0.75,breakup*0.6+patchN*0.4)*1.3+0.45;
  aer=min(a0*exp(-uDt*(a0*0.06+rise/25.0))+aerGen*uDt,3.0)*wet;
  return vec4(h,w1,foam,turb1);
}
`;

const physicsShader = fullscreen + /* glsl */`
void main() {
  ivec2 px=ivec2(gl_FragCoord.xy);
  float aer;
  outValue=evaluateWakeCell(px,aer);
}
`;

const spectrumShader = fullscreen + /* glsl */`
void main() {
  ivec2 px=ivec2(gl_FragCoord.xy);
  vec2 p=worldPos(px);
  vec4 s=texelFetch(uState,px,0);
  vec4 w=depthWeights(uSeaLevel-terrainAt(p));
  outValue=w*(s.x+pressureAt(p));
}
`;

const operatorShader = fullscreen + /* glsl */`
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy), m=ivec2((512-p.x)%512,(512-p.y)%512);
  vec4 z=texelFetch(uFFTSource,p,0), zm=texelFetch(uFFTSource,m,0);
  float kx=float(p.x<256?p.x:p.x-512)*6.28318530718/WAKE_SIZE;
  float kz=float(p.y<256?p.y:p.y-512)*6.28318530718/WAKE_SIZE;
  float k=length(vec2(kx,kz));
  float l0=k,l1=k*tanh(min(k*6.0,12.0)),l2=k*tanh(min(k*1.8,12.0)),l3=k*tanh(min(k*0.6,12.0));
  vec2 a=vec2((l0+l1)*0.5,(l0-l1)*0.5)/(512.0*512.0);
  vec2 b=vec2((l2+l3)*0.5,(l2-l3)*0.5)/(512.0*512.0);
  outValue=vec4(z.x*a.x+zm.x*a.y,z.y*a.x-zm.y*a.y,z.z*b.x+zm.z*b.y,z.w*b.x-zm.w*b.y);
}
`;

const stepShader = fullscreen + /* glsl */`
void main() {
  ivec2 px=ivec2(gl_FragCoord.xy);
  vec4 y=texelFetch(uFFTSource,px,0);
  vec2 p=worldPos(px), cell=worldCell(px);
  vec4 w=depthWeights(uSeaLevel-terrainAt(p));
  float lu=dot(w,y);
  vec4 old=previousValid(cell)?texelFetch(uState,px,0):vec4(0.0);
  // The physics pass stores the pressure-initialized height in the physical target.
  vec4 physical=texelFetch(uState,px,0);
  float vel=(physical.y-lu*(uDt*G));
  float nextH=physical.x+vel*uDt;
  vec2 d=abs(cell-uOrigin);
  float edge=min(min(d.x,WAKE_N-d.x),min(d.y,WAKE_N-d.y));
  float sponge=exp(uDt*pow(1.0-smoothstep(0.0,${SPONGE.toFixed(1)},edge),2.0)*-6.0);
  outValue=vec4(nextH*sponge,vel*sponge,physical.z,physical.w);
}
`;

const displayShader = fullscreen + /* glsl */`
void main() {
  ivec2 px=ivec2(gl_FragCoord.xy), l=ivec2((px.x+511)%512,px.y), r=ivec2((px.x+1)%512,px.y);
  ivec2 d=ivec2(px.x,(px.y+511)%512), u=ivec2(px.x,(px.y+1)%512);
  vec4 s=texelFetch(uState,px,0);
  float sx=uReset>0.5?0.0:(texelFetch(uState,r,0).x-texelFetch(uState,l,0).x)/(2.0*WAKE_CELL);
  float sz=uReset>0.5?0.0:(texelFetch(uState,u,0).x-texelFetch(uState,d,0).x)/(2.0*WAKE_CELL);
  outValue=vec4(s.x,sx,sz,s.z);
}
`;

const nearShader = fullscreen + /* glsl */`
void main() {
  ivec2 px=ivec2(gl_FragCoord.xy);
  vec2 local=vec2(mix(uNearRange.x,uNearRange.y,(float(px.x)+0.5)/32.0),mix(-4.4,4.4,(float(px.y)+0.5)/88.0));
  vec2 world=uNearBoat+vec2(local.x*uNearRot.x+local.y*uNearRot.y,local.y*uNearRot.x-local.x*uNearRot.y);
  vec4 field=texture2D(uState,world/WAKE_SIZE);
  float prior=texture(uNearSource,(vec2(px)+0.5)/vec2(32.0,88.0)).r;
  float mean=field.x;
  if(uNearReset<0.5)mean=mix(prior,field.x,uNearRate);
  float mask=smoothstep(0.0,0.03,texture2D(uHull,vec2(abs(local.x)/uHullBox.x,(local.y-uHullBox.y)/(uHullBox.z-uHullBox.y))).r);
  if(px.x==0||px.x==31||px.y==0||px.y==87) mask=0.0;
  outValue=vec4(mean,mask,0.0,0.0);
}
`;

const aerationShader = fullscreen + /* glsl */`
void main(){
  float aer;
  evaluateWakeCell(ivec2(gl_FragCoord.xy),aer);
  outValue=vec4(aer,0.0,0.0,1.0);
}
`;

// GLSL 1 reader. Bind display and aeration with REPEAT + LINEAR filtering, and the
// 32x88 near-field with CLAMP_TO_EDGE + NEAREST filtering (the latter is manually addressed).
export const WEBGL_WAKE_READER_GLSL = /* glsl */`
uniform sampler2D uWakeDisplay;
uniform sampler2D uWakeAeration;
uniform sampler2D uWakeNearField;
uniform vec2 uWakeCenter;
uniform vec2 uWakeBoatPos;
uniform vec2 uWakeBoatRot;
uniform float uWakeAmount;
uniform float uWakeAmplitude;
uniform float uWakeAerOut;
uniform float uWakeTime;
uniform vec2 uWakeDead;
struct WebGLWakeFragment { vec2 slopes; float foam; float aeration; };
float webglWakeEdgeDist(vec2 xz){vec2 r=abs(xz-uWakeCenter);return ${SIZE.toFixed(1)}*0.5-max(r.x,r.y);}
float webglWakeFade(vec2 xz){return smoothstep(4.0,16.0,webglWakeEdgeDist(xz))*uWakeAmount;}
float webglWakeFadeLong(vec2 xz){return smoothstep(4.0,45.0,webglWakeEdgeDist(xz))*uWakeAmount;}
float webglWakeHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float webglWakeNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=webglWakeHash(i),b=webglWakeHash(i+vec2(1.0,0.0)),c=webglWakeHash(i+vec2(0.0,1.0)),d=webglWakeHash(i+vec2(1.0,1.0));return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float webglWakeAeration(vec2 xz){if(uWakeAmount<=0.0||webglWakeEdgeDist(xz)<=4.0)return 0.0;float a=texture2D(uWakeAeration,xz/${SIZE.toFixed(1)}).r;if(a<=0.01)return 0.0;float m=webglWakeNoise(xz*0.3+vec2(uWakeTime*0.02,0.0))*0.55+webglWakeNoise(xz*0.85+17.3)*0.45;float aN=(1.0-exp(a*-0.5))*(m*0.8+0.6);return smoothstep(m*0.2+0.03,m*0.2+0.55,aN)*uWakeAerOut*webglWakeFadeLong(xz);}
vec2 webglWakeNearCoord(vec2 xz){vec2 r=xz-uWakeBoatPos;vec2 b=vec2(r.x*uWakeBoatRot.x-r.y*uWakeBoatRot.y,r.x*uWakeBoatRot.y+r.y*uWakeBoatRot.x);return vec2((b.x-(-1.6))*(32.0/3.2),(b.y-(-4.4))*(88.0/8.8))-0.5;}
vec4 webglWakeNearBilerp(vec2 tc){vec2 i=floor(tc),f=fract(tc),inv=vec2(32.0,88.0);vec4 a=texture2D(uWakeNearField,(i+0.5)/inv),b=texture2D(uWakeNearField,(i+vec2(1.0,0.0)+0.5)/inv),c=texture2D(uWakeNearField,(i+vec2(0.0,1.0)+0.5)/inv),d=texture2D(uWakeNearField,(i+1.0+0.5)/inv);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float webglWakeHeight(vec2 xz){if(uWakeAmount<=0.0||webglWakeEdgeDist(xz)<=4.0)return 0.0;float h=texture2D(uWakeDisplay,xz/${SIZE.toFixed(1)}).r;vec2 tc=webglWakeNearCoord(xz);if(tc.x>0.0&&tc.y>0.0&&tc.x<31.0&&tc.y<87.0){vec4 n=webglWakeNearBilerp(tc);float r=h-n.r;h=mix(h,r*smoothstep(uWakeDead.x,uWakeDead.y,abs(r)),n.g);}return h*webglWakeFade(xz)*uWakeAmplitude;}
vec4 webglWakeSample(vec2 xz){if(uWakeAmount<=0.0||webglWakeEdgeDist(xz)<=4.0)return vec4(0.0);vec4 s=texture2D(uWakeDisplay,xz/${SIZE.toFixed(1)})*vec4(webglWakeFade(xz),webglWakeFade(xz),webglWakeFade(xz),webglWakeFadeLong(xz));vec2 tc=webglWakeNearCoord(xz);if(tc.x>0.0&&tc.y>0.0&&tc.x<31.0&&tc.y<87.0){float m=texture2D(uWakeNearField,(floor(tc+0.5)+0.5)/vec2(32.0,88.0)).g;s.yz*=1.0-m;}return s;}
WebGLWakeFragment webglWakeFragment(vec2 xz){vec4 s=webglWakeSample(xz);WebGLWakeFragment f;f.slopes=s.yz*uWakeAmplitude;f.foam=s.a;f.aeration=webglWakeAeration(xz);return f;}
`;

// WebGL2 implementation of the shared dispersive wake field. The simulation state remains in
// GPU float textures; CPU work is limited to immutable hull/pile/terrain uploads and controller
// uniforms. This first port deliberately keeps the costly, safety-critical FFT transform visible
// instead of substituting a renderer-specific analytic wake.
export class WebGLWakeSim {
	constructor( THREE, renderer, { terrain, boat, colliders = null, seaLevel = 0 } = {} ) {
		if ( ! renderer?.capabilities?.isWebGL2 || ! renderer.extensions.has( 'EXT_color_buffer_float' ) || ! renderer.extensions.has( 'OES_texture_float_linear' ) ) throw new Error( 'WebGLWakeSim requires WebGL2 float render targets and float linear filtering' );
		if ( ! terrain?.heights || ! terrain?.res || ! boat?.design?.lines ) throw new TypeError( 'WebGLWakeSim requires terrain height data and a boat design' );
		this.THREE=THREE; this.renderer=renderer; this.terrain=terrain; this.boat=boat; this.seaLevel=seaLevel;
		this.lines=boat.design.lines; this.destroyed=false; this.center={x:0,y:0}; this.hasWindow=false; this.sleeping=true; this.idleTime=1e9; this.primed=false; this.stepCount=0; this.settleTime=40; this.time=0;
		this.uniforms=this._uniforms();
		// Match the WebGPU reader textures' rgba16float precision. State, physical, and
		// spectrum remain 32-bit to match the WebGPU storage buffers.
		this.targets={state:this._target(N,N),physical:this._target(N,N),spectrum:this._target(N,N),display:this._target(N,N,{linear:true,halfFloat:true}),aeration:this._target(N,N,{linear:true,halfFloat:true}),aerationNext:this._target(N,N,{linear:true,halfFloat:true}),nearA:this._target(32,88,{repeat:false,halfFloat:true}),nearB:this._target(32,88,{repeat:false,halfFloat:true})};
		this.fft=new WebGLRadix2FFT(THREE,renderer,{size:N});
		this._staticTextures(colliders);
		this.materials={physics:this._material(physicsShader),spectrum:this._material(spectrumShader),operator:this._material(operatorShader),step:this._material(stepShader),display:this._material(displayShader),near:this._material(nearShader),aeration:this._material(aerationShader)};
		this.scene=new THREE.Scene(); this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,2); this.camera.position.z=1;
		this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.materials.physics); this.scene.add(this.mesh);
		this.nearIndex=0;
		this.uniformHandles={
			uWakeDisplay:{value:this.targets.display.texture},uWakeAeration:{value:this.targets.aeration.texture},uWakeNearField:{value:this.targets.nearA.texture},
			uWakeCenter:{value:new THREE.Vector2()},uWakeBoatPos:this.uniforms.uBoatPos,uWakeBoatRot:this.uniforms.uBoatRot,
			uWakeAmount:this.uniforms.uAmount,uWakeAmplitude:{value:1},uWakeAerOut:{value:0.3},uWakeTime:{value:0},uWakeDead:{value:new THREE.Vector2(0.03,0.08)},
		};
		this.uniforms.uNearRange.value.set(-1.6,1.6);
		this.readerUniforms=this.uniformHandles;
		this.displayTexture=this.targets.display.texture;
		this.aerationTexture=this.targets.aeration.texture;
		this.nearFieldTexture=this.targets.nearA.texture;
	}

	_target(width,height,{linear=false,repeat=true,halfFloat=false}={}){const T=this.THREE;return new T.WebGLRenderTarget(width,height,{format:T.RGBAFormat,type:halfFloat?T.HalfFloatType:T.FloatType,internalFormat:halfFloat?'RGBA16F':'RGBA32F',minFilter:linear?T.LinearFilter:T.NearestFilter,magFilter:linear?T.LinearFilter:T.NearestFilter,wrapS:repeat?T.RepeatWrapping:T.ClampToEdgeWrapping,wrapT:repeat?T.RepeatWrapping:T.ClampToEdgeWrapping,depthBuffer:false,stencilBuffer:false});}
	_material(fragmentShader){return new this.THREE.RawShaderMaterial({glslVersion:this.THREE.GLSL3,vertexShader,fragmentShader:fragmentShader.replaceAll('texture2D(','texture('),uniforms:this.uniforms,depthTest:false,depthWrite:false,blending:this.THREE.NoBlending,toneMapped:false});}
	_uniforms(){const T=this.THREE;const val=(v)=>({value:v});return {uFFTSource:val(null),uNearSource:val(null),uState:val(null),uAeration:val(null),uTerrain:val(null),uHull:val(null),uPiles:val(null),uOrigin:val(new T.Vector2()),uPrevOrigin:val(new T.Vector2()),uBoatPos:val(new T.Vector2()),uBoatRot:val(new T.Vector2(1,0)),uTrim:val(new T.Vector3()),uPileBox:val(new T.Vector4(0,0,1,1)),uHullBox:val(new T.Vector4()),uTerrainBox:val(new T.Vector4()),uTerrainRes:val(1),uSeaLevel:val(this.seaLevel),uTime:val(0),uDt:val(1/60),uReset:val(1),uSpeed:val(0),uAmount:val(0),uPressureGain:val(0.72),uWash:val(0),uBow:val(0),uWashW:val(0.7),uDyn:val(0),uHollow:val(1),uHollowK:val(0),uFoamGain:val(0.35),uAerGain:val(1),uVisc:val(0.006),uBoil:val(1.2),uNearRate:val(1),uNearRange:val(new T.Vector2(-1.6,1.6)),uNearBoat:val(new T.Vector2()),uNearRot:val(new T.Vector2(1,0)),uNearReset:val(1),uPass:val(0)};}
	_staticTextures(colliders){
		const T=this.THREE,terrain=this.terrain;
		this.terrainTexture=new T.DataTexture(terrain.heights,terrain.res,terrain.res,T.RedFormat,T.FloatType);this.terrainTexture.minFilter=T.LinearFilter;this.terrainTexture.magFilter=T.LinearFilter;this.terrainTexture.wrapS=this.terrainTexture.wrapT=T.ClampToEdgeWrapping;this.terrainTexture.needsUpdate=true;
		const L=this.lines,NX=24,NZ=112,X1=1.9,Z0=L.zAft-0.8,Z1=L.wlEnd+0.8,data=new Float32Array(NX*NZ);
		for(let z=0;z<NZ;z++)for(let x=0;x<NX;x++){const bx=(x+0.5)/NX*X1,bz=Z0+(z+0.5)/NZ*(Z1-Z0);let sum=0,ws=0;for(let a=-3;a<=3;a++)for(let b=-3;b<=3;b++){const dx=a/3*0.55,dz=b/3*0.55,w=Math.exp(-(dx*dx+dz*dz)/(0.55*0.55*0.4)),h=L.bottomAt(bx+dx,bz+dz);sum+=w*(Number.isFinite(h)?Math.max(0,-h):0);ws+=w;}data[z*NX+x]=x===NX-1||z===0||z===NZ-1?0:sum/ws;}
		this.hullTexture=new T.DataTexture(data,NX,NZ,T.RedFormat,T.FloatType);this.hullTexture.minFilter=T.LinearFilter;this.hullTexture.magFilter=T.LinearFilter;this.hullTexture.needsUpdate=true;
		this._bakePiles(colliders);
		const u=this.uniforms;u.uTerrain.value=this.terrainTexture;u.uHull.value=this.hullTexture;u.uPiles.value=this.pileTexture;u.uTerrainBox.value.set(terrain.origin,terrain.origin,terrain.size,terrain.size);u.uTerrainRes.value=terrain.res;u.uHullBox.value.set(X1,Z0,Z1,L.zAft);u.uPileBox.value.set(this.pileBox.x,this.pileBox.z,this.pileBox.w,this.pileBox.h);
	}
	_bakePiles(colliders){
		const T=this.THREE,piles=colliders?.cylinders?.filter(c=>c.tag==='pile'&&c.yMin<-.1&&c.yMax>.2)||[];
		let x0=0,z0=0,x1=1,z1=1;
		if(piles.length){x0=Math.min(...piles.map(c=>c.x-c.radius))-1;x1=Math.max(...piles.map(c=>c.x+c.radius))+1;z0=Math.min(...piles.map(c=>c.z-c.radius))-1;z1=Math.max(...piles.map(c=>c.z+c.radius))+1;}
		const res=Math.max(0.1,(x1-x0)/2048,(z1-z0)/2048),W=Math.max(2,Math.ceil((x1-x0)/res)),H=Math.max(2,Math.ceil((z1-z0)/res)),cover=new Float32Array(W*H),sub=4;
		for(const c of piles){const ia=Math.floor((c.x-c.radius-x0)/res),ib=Math.ceil((c.x+c.radius-x0)/res),ja=Math.floor((c.z-c.radius-z0)/res),jb=Math.ceil((c.z+c.radius-z0)/res);
			for(let j=Math.max(0,ja);j<=Math.min(H-1,jb);j++)for(let i=Math.max(0,ia);i<=Math.min(W-1,ib);i++){let n=0;for(let a=0;a<sub;a++)for(let b=0;b<sub;b++){const px=x0+(i+(a+0.5)/sub)*res,pz=z0+(j+(b+0.5)/sub)*res;if((px-c.x)**2+(pz-c.z)**2<c.radius*c.radius)n++;}cover[j*W+i]=Math.min(1,cover[j*W+i]+n/(sub*sub));}
		}
		const k=Math.max(1,Math.round(CELL/res/2)),data=new Float32Array(W*H);
		for(let j=0;j<H;j++)for(let i=0;i<W;i++){let sum=0,n=0;for(let b=-k;b<k;b++)for(let a=-k;a<k;a++){const ii=i+a,jj=j+b;if(ii>=0&&jj>=0&&ii<W&&jj<H)sum+=cover[jj*W+ii];n++;}data[j*W+i]=sum/n;}
		this.pileBox={x:x0,z:z0,w:x1-x0,h:z1-z0};this.pileTexture=new T.DataTexture(data,W,H,T.RedFormat,T.FloatType);this.pileTexture.minFilter=T.LinearFilter;this.pileTexture.magFilter=T.LinearFilter;this.pileTexture.needsUpdate=true;
	}
	_draw(material,target){const r=this.renderer,old=r.getRenderTarget();this.mesh.material=material;r.setRenderTarget(target);try{r.render(this.scene,this.camera);}finally{r.setRenderTarget(old);}}
	_set(material,values){Object.assign(material.uniforms,{...this.uniforms,...values});}
	_forwardAndOperator(){let tex=this.fft.forwardX(this.targets.spectrum.texture);tex=this.fft.forwardZ(tex);const u=this.materials.operator.uniforms;u.uFFTSource.value=tex;this._draw(this.materials.operator,this.targets.spectrum);let out=this.fft.inverseZ(this.targets.spectrum.texture);return this.fft.inverseX(out);}
	update(dt,simulationTime=null){
		if(this.destroyed)return;const b=this.boat,speed=Math.hypot(b.velocity?.x||0,b.velocity?.z||0),moving=speed>.5||(b.driven&&Math.abs(b.throttle)>.04);this.idleTime=moving?0:this.idleTime+dt;this.time=Number.isFinite(simulationTime)?simulationTime:this.time+dt;
		this.uniforms.uTime.value=this.time;this.uniformHandles.uWakeTime.value=this.time;
		if(this.idleTime>this.settleTime){this.sleeping=true;this.uniforms.uAmount.value=0;if(!this.primed)this._prime(this.time);return;}
		if(this.sleeping){this.sleeping=false;this.hasWindow=false;this.uniforms.uReset.value=1;}
		const q=b.quaternion,yaw=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.z*q.z));
		const u=this.uniforms,h=Math.min(Math.max(dt,1/240),1/30),bx=b.position.x/CELL,bz=b.position.z/CELL,c=this.center;
		if(!this.hasWindow||Math.abs(bx-c.x)>N||Math.abs(bz-c.y)>N){c.x=Math.round(bx);c.y=Math.round(bz);this.hasWindow=true;u.uReset.value=1;}
		const box=170;if(bx-c.x>box)c.x=Math.ceil(bx-box);if(c.x-bx>box)c.x=Math.floor(bx+box);if(bz-c.y>box)c.y=Math.ceil(bz-box);if(c.y-bz>box)c.y=Math.floor(bz+box);
		u.uPrevOrigin.value.copy(u.uOrigin.value);u.uOrigin.value.set(c.x-N/2,c.y-N/2);if(u.uReset.value>.5)u.uPrevOrigin.value.copy(u.uOrigin.value);u.uAmount.value=Math.min(1,(this.settleTime-this.idleTime)/4);u.uDt.value=h;u.uBoatPos.value.set(b.position.x,b.position.z);u.uBoatRot.value.set(Math.cos(yaw),Math.sin(yaw));this.uniformHandles.uWakeCenter.value.set(c.x*CELL,c.y*CELL);const smooth=(x,a,z)=>{const t=Math.max(0,Math.min(1,(x-a)/(z-a)));return t*t*(3-2*t);};const trimPlane=smooth(speed,3,10),plane=smooth(speed,2,9);u.uTrim.value.set(-.08*trimPlane,0,-.035*trimPlane);u.uSpeed.value=speed;u.uDyn.value=.35*speed*speed/(2*9.80665);u.uHollow.value=.35+.015*speed*speed;u.uHollowK.value=.3*plane;u.uPressureGain.value=.72*(1+.2*plane);u.uWash.value=(b.driven?Math.abs(b.throttle)*b.rpm:0)+smooth(speed,1.5,7)*.5;u.uWashW.value=.7+.6*plane;u.uBow.value=smooth(speed,3.5,9);
		// Preserve WakeSim ordering: derive cell physics/display/aeration from the same old state,
		// then apply the spectral operator and integrate the next simulation state.
		const pm=this.materials.physics;pm.uniforms.uState.value=this.targets.state.texture;pm.uniforms.uAeration.value=this.targets.aeration.texture;this._draw(pm,this.targets.physical);
		const dm=this.materials.display;dm.uniforms.uState.value=this.targets.physical.texture;this._draw(dm,this.targets.display);
		const am=this.materials.aeration;am.uniforms.uState.value=this.targets.state.texture;am.uniforms.uAeration.value=this.targets.aeration.texture;this._draw(am,this.targets.aerationNext);[this.targets.aeration,this.targets.aerationNext]=[this.targets.aerationNext,this.targets.aeration];this.uniformHandles.uWakeAeration.value=this.targets.aeration.texture;this.aerationTexture=this.targets.aeration.texture;
		const spectrum=this.materials.spectrum;spectrum.uniforms.uState.value=this.targets.physical.texture;this._draw(spectrum,this.targets.spectrum);
		const accelerated=this._forwardAndOperator();
		const sm=this.materials.step;sm.uniforms.uFFTSource.value=accelerated;sm.uniforms.uState.value=this.targets.physical.texture;this._draw(sm,this.targets.state);
		const nm=this.materials.near,write=this.nearIndex?this.targets.nearA:this.targets.nearB,read=this.nearIndex?this.targets.nearB:this.targets.nearA;nm.uniforms.uState.value=this.targets.display.texture;nm.uniforms.uNearSource.value=read.texture;nm.uniforms.uNearBoat.value.copy(u.uBoatPos.value);nm.uniforms.uNearRot.value.copy(u.uBoatRot.value);nm.uniforms.uNearRate.value=1-Math.exp(-h/.25);nm.uniforms.uNearReset.value=u.uReset.value;this._draw(nm,write);this.nearIndex=1-this.nearIndex;this.uniformHandles.uWakeNearField.value=write.texture;this.nearFieldTexture=write.texture;
		this.primed=true;u.uReset.value=0;this.stepCount++;
	}
	_prime(simulationTime=this.time){
		const idle=this.idleTime;
		this.primed=true;this.idleTime=0;this.sleeping=true;this.uniforms.uReset.value=1;
		this.update(1/60,simulationTime);
		this.idleTime=idle;this.sleeping=true;this.uniforms.uAmount.value=0;
	}
	dispose(){if(this.destroyed)return;this.destroyed=true;this.fft.dispose();for(const t of Object.values(this.targets))t.dispose();for(const m of Object.values(this.materials))m.dispose();this.mesh.geometry.dispose();this.terrainTexture.dispose();this.hullTexture.dispose();this.pileTexture.dispose();}
}
