// A reversible, explicitly scripted interaction for portal inspection/capture.
// Both observer views run the same simulation and reuse the player's avatar.
import { Mesh, SphereGeometry, BoxGeometry, Vector3, Matrix4 } from '../engine/index.js';
import { standard } from '../materials/Materials.js';
import { portalFrame, mappedPortalCameraMatrix } from './PortalView.js';
import { PortalMonkeyActor } from './PortalMonkeyActor.js';
import { crossPortalSegment } from './PortalProjectile.js';

const GRAVITY = 9.81;
const RADIUS = .14;
const clamp = x => Math.max(0,Math.min(1,x));
export function monkeyPortalPose(time, source, destination, ground, floor) {
  const f=clamp(time/4), approach=f*f*(3-2*f), follow=clamp((time-7)/6);
  const travel=follow*follow*(3-2*follow), z=7-4*approach-6.2*travel;
  const sourceY=ground-source.elements[13]+.4*clamp((3-z)/1.6);
  const position=new Vector3(.15,sourceY,z).applyMatrix4(source);
  const mapping=mappedPortalCameraMatrix(new Matrix4(),source,destination);
  const insidePosition=position.clone().applyMatrix4(mapping);
  // Keep the rigid mapping until the complete tail has cleared, then descend
  // the temporary warehouse ramp. The same pose drives both clipped halves.
  insidePosition.y += (floor-insidePosition.y)*clamp((-z-1.6)/1.6);
  const direction=new Vector3(0,0,-1).transformDirection(source);
  const insideDirection=direction.clone().transformDirection(mapping);
  return {position,insidePosition,yaw:Math.atan2(direction.x,direction.z),insideYaw:Math.atan2(insideDirection.x,insideDirection.z),
    walk:time<4?Math.sin(Math.PI*f)**.4:time>7&&time<13?Math.sin(Math.PI*follow)**.25:0,
    throwWeight:1-clamp((time-6)/.7),throwProgress:clamp((time-4)/1.2),z,done:time>=13};
}
function clipPlane(frame) {
  const e=frame.elements;return [e[8],e[9],e[10],-(e[8]*e[12]+e[9]*e[13]+e[10]*e[14])];
}
function walkway(scene,frame,start,end,nearHeight,farHeight,bottom) {
  const geometry=new BoxGeometry(1.2,1,end-start),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const z=p.getZ(i)+(start+end)/2,t=(z-start)/(end-start);
    p.setXYZ(i,p.getX(i),p.getY(i)>0?nearHeight+(farHeight-nearHeight)*t:bottom,z);
  }
  geometry.computeVertexNormals();geometry.applyMatrix4(frame);
  const mesh=new Mesh(geometry,standard({name:'Temporary portal walkway',color:0x65594c,roughness:.95}));
  mesh.castShadow=true;scene.add(mesh);return mesh;
}
const belongsTo = (object, root) => {
  for (let node = object; node; node = node.parent) if (node === root) return true;
  return false;
};

export class PortalThrowDemo {
  constructor(app, portal) {
    this.app = app; this.portal = portal; this.active = false;
    this.panel = document.createElement('section');
    this.panel.setAttribute('aria-label', 'Portal coconut demonstration');
    this.panel.style.cssText = 'position:fixed;left:12px;bottom:65px;z-index:40;background:#10272deb;color:#eafcff;padding:10px;border:1px solid #518a98;border-radius:10px;font:12px system-ui;max-width:310px';
    this.panel.innerHTML = '<b>Portal coconut demo · scripted</b><div data-stage>Choose a camera to watch the same throw.</div>';
    for (const [label, action] of [['Watch from warehouse', () => this.start('warehouse')], ['Watch from island', () => this.start('island')], ['Stop demo', () => this.stop()]]) {
      const button = document.createElement('button'); button.textContent = label;
      button.style.cssText = 'margin:6px 5px 0 0;padding:6px;border-radius:6px;border:1px solid #6595a0;background:#1c414b;color:white;cursor:pointer';
      button.onclick = () => { Promise.resolve(action()).catch(error => { this.status.textContent = error.message; }); };
      this.panel.append(button);
    }
    this.status = this.panel.querySelector('[data-stage]');
    document.body.append(this.panel);
    this.position = new Vector3(); this.velocity = new Vector3();
  }

  async start(viewSide) {
    this.stop();
    const startToken = this.startToken = (this.startToken || 0) + 1;
    const a = this.app, p = a.player, portal = this.portal;
    await a.avatar.ready;
    if (startToken !== this.startToken) return;
    if (!a.avatar.scanned) throw Error('Selected avatar has not loaded; the demo is unavailable.');
    this.saved = { position:p.position.clone(), velocity:p.velocity.clone(), yaw:p.yaw, pitch:p.pitch, mode:p.mode, grounded:p.grounded,
      freeCam:a.freeCam, camera:a.camera.position.clone(), cameraQuaternion:a.camera.quaternion.clone(),
      cinematic:a.avatar.cinematic, inside:portal.inside, returnState:portal.returnState };
    const g = portal.exterior.position;
    this.source = portalFrame(g.x, g.y + 1.35, g.z + .17);
    this.destination = portal.portalView.insideFrame();
    this.ground = g.y;
    this.avatarPosition = new Vector3(portal.origin.x + .1, portal.origin.y + .05, portal.origin.z);
    if (!portal.inside) {
      p.mode = 'walk'; p.position.set(g.x, g.y, g.z+3); portal.enter();
    }
    portal.returnState = { position:new Vector3(g.x,g.y,g.z+3), yaw:0, landscape:false };
    p.position.copy(this.avatarPosition); p.velocity.set(0,0,0); p.yaw = Math.PI/2; p.pitch = 0;
    a.avatar.cinematic = { x:p.position.x,y:p.position.y,z:p.position.z,yaw:-Math.PI/2 };
    this.actor = new PortalMonkeyActor(a.scene,clipPlane(this.source));
    this.insideActor = new PortalMonkeyActor(a.scene,clipPlane(this.destination));
    const sy=this.ground-this.source.elements[13],dy=sy+.4,floor=portal.origin.y+.08-this.destination.elements[13];
    this.walkways=[walkway(a.scene,this.source,0,1.4,sy+.4,sy+.4,sy-.08),walkway(a.scene,this.source,1.4,3,sy+.4,sy,sy-.08),
      walkway(a.scene,this.destination,0,1.6,dy,dy,floor-.08),walkway(a.scene,this.destination,1.6,3.2,dy,floor,floor-.08)];
    this.coconut = new Mesh(new SphereGeometry(RADIUS,16,12), standard({name:'Thrown coconut husk',color:0x704326,roughness:.95,
      surface:'let grain = .7 + .3 * sin(in.uv.x * 115.0 + sin(in.uv.y * 31.0)); s.albedo *= grain;'}));
    this.coconut.name='Portal demo coconut'; this.coconut.castShadow=true; a.scene.add(this.coconut);
    this.time=0; this.crossed=false; this.released=false; this.hit=false; this.landed=false; this.monkeyCrossed=false; this.monkeyArrived=false; this.events=[];
    this.viewSide=viewSide; this.active=true;
    a.setFreeCam(true); a.fly.velocity.set(0,0,0);
    // The camera is an observer; changing it never moves the avatar or projectile.
    if (viewSide==='warehouse') a.fly.setPose(new Vector3(portal.origin.x+7,portal.origin.y+2.4,portal.origin.z+.9),Math.atan2(11,.9),-.035);
    else a.fly.setPose(new Vector3(g.x-.7,g.y+2.15,g.z+10),-.071,-.07);
    this.update(0);
  }

  isInteriorObject(object) {
    return belongsTo(object,this.app.avatar.group) || belongsTo(object,this.insideActor?.group) || this.walkways?.slice(2).includes(object) || (this.crossed && object===this.coconut);
  }

  update(dt) {
    if (!this.active) return;
    this.time += Math.min(dt,.1);
    const pose=monkeyPortalPose(this.time,this.source,this.destination,this.ground,this.portal.origin.y+.08);
    const {throwProgress}=pose;
    this.actor.pose({...pose,time:this.time});
    this.insideActor.pose({...pose,position:pose.insidePosition,yaw:pose.insideYaw,time:this.time});
    if(pose.z<=0&&!this.monkeyCrossed){this.monkeyCrossed=true;this.events.push({event:'monkey-crossing',time:this.time,position:pose.insidePosition.toArray()});}
    if(pose.done&&!this.monkeyArrived){this.monkeyArrived=true;this.events.push({event:'monkey-arrived',time:this.time,position:pose.insidePosition.toArray()});}
    if (!this.released) {
      this.actor.handPosition(this.position);
      if (throwProgress>=.8) {
        this.released=true;
        const target=this.avatarPosition.clone().add(new Vector3(0,1.25,0));
        // Aim at the actual avatar's chest through the inverse portal mapping.
        const inverse=mappedPortalCameraMatrix(new Matrix4(),this.source,this.destination).invert();
        target.applyMatrix4(inverse);
        const flightTime=1.1;
        this.velocity.copy(target).sub(this.position).multiplyScalar(1/flightTime);
        this.velocity.y+=.5*GRAVITY*flightTime;
        this.events.push({event:'release',time:this.time,position:this.position.toArray()});
      }
    } else if (!this.landed) {
      let remaining=Math.min(dt,.1);
      while(remaining>0&&!this.landed) { const step=Math.min(remaining,1/120); this.step(step); remaining-=step; }
    }
    this.coconut.position.copy(this.position);
    if(this.released&&!this.landed){this.coconut.rotation.x+=dt*7;this.coconut.rotation.z+=dt*4;}
    this.status.textContent = this.monkeyArrived ? 'Monkey inside warehouse · choose either view to replay' : this.monkeyCrossed ? 'Monkey walking into warehouse' : this.time>=7 ? 'Monkey following coconut through portal' : this.hit ? 'Coconut reached avatar · monkey preparing to follow' : this.crossed ? 'Coconut inside warehouse' : this.released ? 'Coconut flying towards portal' : this.time<4 ? 'Monkey approaching on island' : 'Monkey winding up';
  }

  step(dt) {
    const previous=this.position.clone();
    const next=previous.clone().addScaledVector(this.velocity,dt); next.y-=.5*GRAVITY*dt*dt;
    const crossing=crossPortalSegment({previous,next,velocity:this.velocity,source:this.source,destination:this.destination,radius:RADIUS,crossed:this.crossed});
    if(crossing) {
      this.crossed=true; this.position.copy(crossing.position); this.velocity.copy(crossing.velocity);
      const used=dt*(1-crossing.remainingFraction); this.velocity.y-=GRAVITY*used;
      const rest=dt*crossing.remainingFraction;
      this.position.addScaledVector(this.velocity,rest);this.position.y-=.5*GRAVITY*rest*rest;this.velocity.y-=GRAVITY*rest;
      this.events.push({event:'portal-crossing',time:this.time,position:this.position.toArray()});
    } else { this.position.copy(next); this.velocity.y-=GRAVITY*dt; }
    if(this.crossed) {
      const chest=this.avatarPosition.clone().add(new Vector3(0,1.25,0));
      if(!this.hit&&this.position.distanceTo(chest)<.4) {
        this.hit=true;this.velocity.x=-Math.abs(this.velocity.x)*.3;this.velocity.y=1.5;
        this.events.push({event:'avatar-contact',time:this.time,position:this.position.toArray()});
      }
      const floor=this.portal.origin.y+.08+RADIUS;
      if(this.position.y<floor) {
        this.position.y=floor;this.velocity.y=Math.abs(this.velocity.y)*.3;this.velocity.x*=.55;this.velocity.z*=.55;
        if(this.velocity.length()<.5){this.landed=true;this.velocity.set(0,0,0);this.events.push({event:'landed',time:this.time,position:this.position.toArray()});}
      }
    } else if(this.position.y<this.ground+RADIUS&&this.released) {
      this.position.y=this.ground+RADIUS;this.landed=true;this.events.push({event:'missed-portal',time:this.time});
    }
  }

  stop() {
    this.startToken = (this.startToken || 0) + 1;
    if(!this.active)return;
    this.active=false;
    const a=this.app,p=a.player,s=this.saved;
    this.actor.dispose();this.insideActor.dispose();
    for(const mesh of this.walkways){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();}
    this.coconut.removeFromParent();this.coconut.geometry.dispose();this.coconut.material.dispose();
    if(!s.inside)this.portal.exit();
    this.portal.returnState=s.returnState;
    a.avatar.cinematic=s.cinematic;
    a.setFreeCam(s.freeCam);
    p.position.copy(s.position);p.velocity.copy(s.velocity);p.yaw=s.yaw;p.pitch=s.pitch;p.mode=s.mode;p.grounded=s.grounded;
    a.camera.position.copy(s.camera);a.camera.quaternion.copy(s.cameraQuaternion);
    if(s.freeCam){const e=a.camera.rotation;a.fly.setPose(s.camera,e.y,e.x);}
    this.status.textContent='Demo stopped; previous player state restored.';
  }
}
