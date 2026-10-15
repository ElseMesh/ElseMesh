import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Matrix4,Vector3,Group} from '../src/engine/index.js';
import {sweptPortalCrossing,crossPortalSegment} from '../src/world/PortalProjectile.js';
import {PortalMonkeyActor} from '../src/world/PortalMonkeyActor.js';

const near=(a,b)=>assert.ok(a.distanceTo(b)<1e-9,`${a.toArray()} != ${b.toArray()}`);
const sweep=(extra={})=>sweptPortalCrossing({start:new Vector3(0,0,1),end:new Vector3(0,0,-1),velocity:new Vector3(0,0,-4),source:new Matrix4(),destination:new Matrix4().makeTranslation(10,2,3),...extra});
test('portal sweep maps translated crossing and preserves unspent step',()=>{
	const result=sweep();near(result.crossingPoint,new Vector3(10,2,3));near(result.velocity,new Vector3(0,0,4));assert.equal(result.remainingFraction,.5);
});
test('rotated source and destination transform both position and velocity',()=>{
	const source=new Matrix4().makeRotationY(Math.PI/2);source.setPosition(4,2,1);
	const destination=new Matrix4().makeRotationY(-Math.PI/2);destination.setPosition(-3,1,7);
	const start=new Vector3(.2,.1,1).applyMatrix4(source),end=new Vector3(.2,.1,-3).applyMatrix4(source);
	const result=sweep({source,destination,start,end,velocity:new Vector3(-8,0,0)});
	near(result.crossingPoint,new Vector3(-.2,.1,0).applyMatrix4(destination));near(result.velocity,new Vector3(-8,0,0));assert.equal(result.remainingFraction,.75);
});
test('aperture uses the interpolated plane point and sphere clearance',()=>{
	assert.equal(sweep({start:new Vector3(1.08,0,1),end:new Vector3(1.08,0,-1)}),null);
	assert.ok(sweep({start:new Vector3(2,0,1),end:new Vector3(-2,0,-1)}));
	assert.equal(sweep({start:new Vector3(0,0,-1),end:new Vector3(0,0,1)}),null);
});
test('mapped projectile moves away from exit without duplicate reverse crossing',()=>{
	const destination=new Matrix4().makeTranslation(10,2,3),result=sweep({destination});
	const end=result.crossingPoint.clone().addScaledVector(result.velocity,.25);
	assert.equal(sweptPortalCrossing({start:result.crossingPoint,end,velocity:result.velocity,source:destination,destination:new Matrix4()}),null);
});
test('segment API preserves oblique velocity speed and respects crossed guard',()=>{
	const args={previous:new Vector3(0,0,1),next:new Vector3(.3,.1,-1),velocity:new Vector3(2,1,-7),source:new Matrix4().makeRotationY(.25),destination:new Matrix4().makeRotationY(1.7)};
	const result=crossPortalSegment(args);assert.ok(result);assert.ok(Math.abs(result.velocity.length()-args.velocity.length())<1e-9);
	assert.equal(crossPortalSegment({...args,crossed:true}),null);
});
test('monkey keeps finite bounded anatomy and world hand through articulation',()=>{
	const scene=new Group(),actor=new PortalMonkeyActor(scene),position=new Vector3(3,0,2);
	for(const progress of [0,.3,.6,1]){
		actor.pose({position,yaw:Math.PI/2,time:progress,walk:1,throwProgress:progress});
		assert.ok(actor.handPosition().toArray().every(Number.isFinite));
		for(const batch of actor.batches){assert.ok(batch.count>0&&batch.count<=96);assert.ok(batch.instanceMatrix.array.slice(0,batch.count*16).every(Number.isFinite));}
	}
	actor.dispose();assert.equal(scene.children.length,0);
});

// Exercise the actual demo integrator without a browser or synthetic renderer.
test('demo floor contact settles once above the warehouse floor', async()=>{
 const {PortalThrowDemo}=await import('../src/world/PortalThrowDemo.js');
 const demo=Object.create(PortalThrowDemo.prototype);
 Object.assign(demo,{position:new Vector3(298,18.23,300),velocity:new Vector3(0,-.1,0),crossed:true,hit:true,released:true,landed:false,time:7,events:[],source:new Matrix4(),destination:new Matrix4(),avatarPosition:new Vector3(300,18,300),portal:{origin:new Vector3(300,18,300)}});
 for(let i=0;i<120&&!demo.landed;i++)demo.step(1/120);
 assert.equal(demo.landed,true);assert.equal(demo.position.y,18.22);
 assert.equal(demo.events.filter(e=>e.event==='landed').length,1);
 assert.equal(demo.velocity.length(),0);
});

test('stop cancels pending avatar load before any world mutation',async()=>{
 const {PortalThrowDemo}=await import('../src/world/PortalThrowDemo.js');
 let resolve;const ready=new Promise(r=>{resolve=r;});
 const demo=Object.create(PortalThrowDemo.prototype);
 Object.assign(demo,{active:false,app:{avatar:{ready,scanned:false},player:{}},portal:{}});
 const pending=demo.start('island');demo.stop();resolve();
 await assert.doesNotReject(pending);assert.equal(demo.saved,undefined);assert.equal(demo.actor,undefined);
});
test('only latest pending replay proceeds after avatar load',async()=>{
 const {PortalThrowDemo}=await import('../src/world/PortalThrowDemo.js');
 let resolve;const ready=new Promise(r=>{resolve=r;});
 const demo=Object.create(PortalThrowDemo.prototype);
 Object.assign(demo,{active:false,app:{avatar:{ready,scanned:false},player:{}},portal:{}});
 const first=demo.start('warehouse');const second=demo.start('island');resolve();
 await assert.doesNotReject(first);
 await assert.rejects(second,/Selected avatar has not loaded/);
 assert.equal(demo.saved,undefined);
});
