// Opt-in experimental GLB import. Original portal, recipe, C64 and saved world
// retain their own objects and interaction ownership.
import { BufferAttribute, BufferGeometry, Group, Mesh, Vector3 } from '../engine/index.js';
import { loadGLB } from '../engine/loaders/GLTF.js';
import { standard } from '../materials/Materials.js';
import interiorReference from '../../experiments/ai-2d-to-3d/references/warehouse-interior.png?url';
import portalReference from '../../experiments/ai-2d-to-3d/references/island-portal-exterior.png?url';

const assetRoot=(import.meta.env.BASE_URL||'/')+'models/experimental/warehouse-image-guided';
const origin={x:360,y:18,z:300};

export class ImageGuidedWarehouse {
  constructor(app){
    this.app=app;this.group=new Group();this.group.name='EXPERIMENTAL · image-guided warehouse candidate';
    this.group.position.set(origin.x,origin.y,origin.z);this.group.visible=false;app.scene.add(this.group);
    this.colliders=[];this.geometries=[];this.materials=[];this.enabled=false;this.inside=false;this.returnState=null;this.disposed=false;
    this.stage='loading GLB';this.stageAt=performance.now();this.lastMetrics=0;
    this.makePanel();
    this.ready=this.load().catch(error=>{this.error=String(error);this.clearResources();if(!this.disposed)this.status.textContent='Candidate load failed: '+this.error;return null;});
  }
  async load(){
    const [gltf,response]=await Promise.all([loadGLB(assetRoot+'.glb'),fetch(assetRoot+'.json')]);
    if(this.disposed)return null;
    if(!response.ok)throw Error(`Candidate manifest HTTP ${response.status}`);
    const manifest=await response.json();
    if(this.disposed)return null;
    if(manifest.schema!=='elsemesh.image-guided-asset/v1'||gltf.nodes.length!==manifest.parts.length)throw Error('Candidate GLB/manifest mismatch');
    const materials=gltf.materials.map((source,i)=>{
      const p=source.pbrMetallicRoughness||{},rgba=p.baseColorFactor||[1,1,1,1];
      const color=(Math.round(rgba[0]*255)<<16)|(Math.round(rgba[1]*255)<<8)|Math.round(rgba[2]*255);
      const m=standard({name:`Image-guided warehouse ${source.name||i}`,color,roughness:p.roughnessFactor??1,metalness:p.metallicFactor??0,transparent:source.alphaMode==='BLEND',opacity:rgba[3],side:source.doubleSided?'double':'front'});
      m.underwaterLighting='none';m.localLightsCheap=true;return m;
    });
    this.materials=materials;
    const geometryByMesh=new Map();
    for(let i=0;i<gltf.nodes.length;i++){
      const node=gltf.nodes[i],part=manifest.parts[i];
      if(node.name!==part.name||node.mesh===undefined||node.mesh<0||node.mesh>=gltf.meshes.length)throw Error(`Invalid GLB part ${i}`);
      const primitive=gltf.meshes[node.mesh][0];
      if(primitive.mode!==4||!primitive.indices||!primitive.attributes.POSITION||!primitive.attributes.NORMAL)throw Error(`Unsupported candidate primitive ${i}`);
      let geometry=geometryByMesh.get(node.mesh);
      if(!geometry){
        geometry=new BufferGeometry();
        geometry.setAttribute('position',new BufferAttribute(primitive.attributes.POSITION.array,3));
        geometry.setAttribute('normal',new BufferAttribute(primitive.attributes.NORMAL.array,3));
        if(primitive.attributes.TEXCOORD_0)geometry.setAttribute('uv',new BufferAttribute(primitive.attributes.TEXCOORD_0.array,2));
        geometry.setIndex(new BufferAttribute(primitive.indices,1));geometry.computeBoundingSphere();
        geometryByMesh.set(node.mesh,geometry);this.geometries.push(geometry);
      }
      const mesh=new Mesh(geometry,materials[primitive.material]);mesh.name=node.name;mesh.position.set(...node.t);mesh.scale.set(...node.s);mesh.castShadow=part.material!=='glass';this.group.add(mesh);
      if(part.solid||part.walkable){
        const c=this.app.colliders.addBox(new Vector3(origin.x+node.t[0],origin.y+node.t[1],origin.z+node.t[2]),new Vector3(node.s[0]/2,node.s[1]/2,node.s[2]/2),0,{solid:false,walkable:false,tag:'experimental-ai-warehouse'});
        this.colliders.push({record:c,solid:!!part.solid,walkable:!!part.walkable});
      }
    }
    this.manifest=manifest;this.status.textContent=`Imported ${gltf.nodes.length} editable mesh parts · ${manifest.sha256.slice(0,12)} · candidate off`;
    this.construction.textContent=`Offline specification → parametric mesh → GLB import\n${gltf.nodes.length} named parts · ${manifest.sha256.slice(0,16)}\nObserved: ${manifest.observed.join(', ')}\nEstimated: ${manifest.inferred.join(', ')}`;
    this.stage='ready';this.stageAt=performance.now();
    this.buttons.forEach(button=>button.disabled=false);
    return manifest;
  }
  setEnabled(on){
    if(!on&&this.inside)this.leave();
    this.enabled=!!on;this.group.visible=this.enabled;
    this.stage=this.enabled?'candidate visible':'candidate hidden';this.stageAt=performance.now();
    for(const c of this.colliders){c.record.solid=this.enabled&&c.solid;c.record.walkable=this.enabled&&c.walkable;}
    this.status.textContent=`Imported candidate ${this.enabled?'ON':'OFF'} · ${this.colliders.length} collision boxes · original preserved`;
  }
  visit(){
    if(!this.manifest)return;
    const p=this.app.player,portal=this.app.thirdIsland.portalInterior;
    if(this.inside)return;
    if(p.mode!=='walk'||this.app.monorail?.state==='riding'||this.app.portIsland?.driving){this.status.textContent='Leave the vehicle before visiting the candidate';return;}
    if(portal.inside)portal.exit();
    // Persist the safe world position before entering the temporary gallery.
    this.app.procedural?.save();
    this.returnState={position:p.position.clone(),yaw:p.yaw};
    this.setEnabled(true);this.inside=true;
    this.stage='candidate walkaround';this.stageAt=performance.now();
    this.app.setFreeCam(false);
    p.position.set(origin.x,origin.y+.05,origin.z-this.manifest.dimensionsMetres.depth/2-4);
    p.yaw=Math.PI;p.pitch=0;p.velocity.set(0,0,0);p.grounded=true;
    this.status.textContent='Candidate entry · walk through the north doorway; use Return to island to leave';
  }
  leave(){
    if(!this.inside)return;
    const p=this.app.player;
    if(this.returnState){p.position.copy(this.returnState.position);p.yaw=this.returnState.yaw;}
    p.velocity.set(0,0,0);p.grounded=true;
    this.inside=false;this.returnState=null;
    this.stage='returned to island';this.stageAt=performance.now();
  }
  visitOriginal(){
    if(this.app.player.mode!=='walk'||this.app.monorail?.state==='riding'||this.app.portIsland?.driving){this.status.textContent='Leave the vehicle before visiting the original';return;}
    this.app.setFreeCam(false);
    this.leave();
    const portal=this.app.thirdIsland.portalInterior;
    if(portal.inside)portal.exit();
    portal.enter();
    this.stage='original warehouse';this.stageAt=performance.now();
    this.status.textContent='Original warehouse · original computers and interactions active';
  }
  makePanel(){
    const panel=document.createElement('section');panel.id='ai-warehouse-experiment';
    panel.style.cssText='position:fixed;left:14px;bottom:14px;z-index:1400;width:min(340px,40vw);max-height:70vh;overflow:auto;background:#0a1b25ed;color:#e5faf2;border:1px solid #5bddcc;border-radius:12px;padding:12px;font:12px/1.35 system-ui;box-shadow:0 8px 28px #0009';
    panel.innerHTML='<strong>2D → 3D · WAREHOUSE EXPERIMENT</strong><p>Codex image-guided GLB candidate. Hidden walls, roof and doorway are inferred. Original warehouse remains available.</p><details><summary>Source images</summary><img alt="Original island warehouse portal" style="width:100%;margin:6px 0"/><img alt="Original warehouse interior" style="width:100%;margin:6px 0"/></details><details><summary>Construction record</summary><pre style="white-space:pre-wrap"></pre></details><div class="controls" style="display:flex;flex-wrap:wrap;gap:6px"></div><p class="status" role="status">Loading candidate GLB…</p><p class="metrics">Model: Codex programmatic · stage: loading GLB</p>';
    const images=panel.querySelectorAll('img');images[0].src=portalReference;images[1].src=interiorReference;
    const controls=panel.querySelector('.controls');
    const button=(label,action)=>{const el=document.createElement('button');el.textContent=label;el.disabled=true;el.style.cssText='padding:7px;background:#1c4550;color:white;border:1px solid #7bddd1;border-radius:6px;cursor:pointer';el.onclick=action;controls.append(el);return el;};
    this.buttons=[button('Show / hide candidate',()=>this.setEnabled(!this.enabled)),button('Visit candidate',()=>this.visit()),button('Visit original',()=>this.visitOriginal()),button('Return to island',()=>{this.leave();const portal=this.app.thirdIsland.portalInterior;if(portal.inside)portal.exit();})];
    this.status=panel.querySelector('.status');this.metrics=panel.querySelector('.metrics');this.construction=panel.querySelector('pre');this.panel=panel;document.body.append(panel);
  }
  update(){
    const now=performance.now();if(now-this.lastMetrics<500)return;this.lastMetrics=now;
    const fps=Number.isFinite(this.app.fps)?this.app.fps.toFixed(1):'unavailable';
    const cpu=Number.isFinite(this.app.cpuMs)?this.app.cpuMs.toFixed(1):'unavailable';
    this.metrics.textContent=`Model: Codex programmatic · ${this.stage} · ${((now-this.stageAt)/1000).toFixed(1)} s · app FPS ${fps} · CPU ${cpu} ms`;
  }
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.leave();this.setEnabled(false);this.app.scene.remove(this.group);this.panel.remove();
    this.clearResources();
  }
  clearResources(){
    const records=new Set(this.colliders.map(c=>c.record));
    this.app.colliders.boxes=this.app.colliders.boxes.filter(c=>!records.has(c));this.app.colliders.invalidateSpatialQueries();
    for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();
    for(const mesh of [...this.group.children])this.group.remove(mesh);
    this.colliders.length=0;this.geometries.length=0;this.materials.length=0;this.manifest=null;
  }
}
