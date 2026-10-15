import {Group, InstancedMesh, SphereGeometry, Vector3, Quaternion, Matrix4, InstancedInterleavedBuffer, InterleavedBufferAttribute} from '../engine/index.js';
import {standard} from '../materials/Materials.js';
import {TreeWildlife} from './TreeWildlife.js';

// The canopy monkey's sphere anatomy and shared limb builders, with one arm
// articulated independently for the portal demonstration.
export class PortalMonkeyActor {
	constructor(scene) {
		this.group=new Group();this.group.name='Portal coconut monkey';scene.add(this.group);
		this.batches=[0x594132,0xc4a17b,0x201b17,0xead8b7].map((color,i)=>{
			const material=standard({name:'Portal monkey '+['fur','face','eyes and hands','chest'][i],color,roughness:.88});material.localLightsCheap=true;
			const batch=new InstancedMesh(new SphereGeometry(1,12,8),material,96);
			batch.frustumCulled=false;batch.castShadow=true;batch.count=0;
			batch.previous=new InstancedInterleavedBuffer(new Float32Array(batch.instanceMatrix.array),16);
			material.attributes={};
			for(let k=0;k<4;k++){
				batch.geometry.setAttribute('previous'+k,new InterleavedBufferAttribute(batch.previous,4,k*4));
				material.attributes['previous'+k]='vec4f';
			}
			material.vertex='v.prevModel = draw.prevModel * mat4x4f(v.previous0,v.previous1,v.previous2,v.previous3);';
			this.group.add(batch);return batch;
		});
		this.pos=new Vector3();this.scale=new Vector3();this.rot=new Quaternion();this.identity=new Quaternion();this.delta=new Vector3();
		this.local=new Matrix4();this.world=new Matrix4();this.body=new Matrix4();this.rotation=new Quaternion();
		this.a=new Vector3();this.b=new Vector3();this.c=new Vector3();this.hand=new Vector3();
		this.pose({position:new Vector3(),yaw:0,time:0,walk:0,throwProgress:0});
	}
	put(...args){return TreeWildlife.prototype.put.apply(this,args);}
	segment(...args){return TreeWildlife.prototype.segment.apply(this,args);}
	pose({position,yaw=0,time=0,walk=0,throwProgress=0}) {
		const stride=Math.max(0,Math.min(1,walk)),t=time*7.5,bob=Math.sin(t*2)*.025*stride;
		const throwing=Math.max(0,Math.min(1,throwProgress));
		this.body.compose(position,this.rot.setFromAxisAngle(new Vector3(0,1,0),yaw),new Vector3(1,1,1));
		for(const batch of this.batches){batch.previousCount=batch.count;batch.previous.array.set(batch.instanceMatrix.array);batch.count=0;}
		const [fur,skin,dark,chest]=this.batches,frame=this.body;
		this.put(fur,frame,0,.66+bob,0,.22,.22,.42);
		this.put(chest,frame,0,.61+bob,.22,.16,.18,.21);
		this.put(fur,frame,0,.91+bob,.37,.21,.23,.21);
		this.put(skin,frame,0,.88+bob,.53,.155,.15,.10);
		this.put(skin,frame,0,.80+bob,.59,.105,.055,.065);
		this.put(dark,frame,0,.875+bob,.622,.034,.025,.014);
		for(const side of [-1,1]) {
			this.put(fur,frame,side*.21,.91+bob,.39,.065,.085,.045);
			this.put(skin,frame,side*.218,.912+bob,.425,.039,.053,.013);
			this.put(dark,frame,side*.069,.95+bob,.611,.025,.029,.012);
			this.put(chest,frame,side*.069-.005,.957+bob,.622,.007,.008,.005);
			for(const front of [true,false]) {
				const phase=t+(side>0?Math.PI:0)+(front?0:Math.PI),swing=Math.sin(phase)*.14*stride;
				const lift=Math.max(0,Math.cos(phase))*.105*stride,z=front?.31:-.29;
				this.a.set(side*.17,(front?.71:.6)+bob,z);
				this.b.set(side*.205,.30+lift*.5,z+(front?-.09:.12)+swing*.5);
				this.c.set(side*.13,.025+lift,z+swing);
				if(front&&side>0) {
					// Raise the hand with the coconut, draw back, then extend forwards.
					const wind=Math.sin(Math.PI*Math.min(throwing/.6,1));
					const release=Math.max(0,(throwing-.6)/.4);
					this.b.set(.27,.78+bob+.24*wind,.29-.22*wind+.25*release);
					this.c.set(.23,.87+bob+.31*wind,.56-.48*wind+.50*release);
					this.hand.copy(this.c).applyMatrix4(frame);
				}
				this.segment(fur,frame,this.a,this.b,front?.063:.09);
				this.segment(fur,frame,this.b,this.c,.047);
				this.put(dark,frame,this.c.x,this.c.y,this.c.z+.035,.053,.03,.083);
			}
		}
		this.a.set(0,.65+bob,-.32);
		for(let j=1;j<=10;j++){
			const f=j/10;this.b.set(Math.sin(time*1.7+f*3)*.10*f,.64+bob+.38*Math.sin(f*3.3),-.32-.95*f+.24*f*f);
			this.segment(fur,frame,this.a,this.b,.043*(1-f*.65));this.a.copy(this.b);
		}
		for(const batch of this.batches){
			if(batch.previousCount!==batch.count)batch.previous.array.set(batch.instanceMatrix.array);
			batch.instanceMatrix.needsUpdate=true;batch.previous.needsUpdate=true;
		}
		return this;
	}
	handPosition(out=new Vector3()){return out.copy(this.hand);}
	dispose(){this.group.removeFromParent();for(const batch of this.batches){batch.geometry.dispose();batch.material.dispose();}}
}
