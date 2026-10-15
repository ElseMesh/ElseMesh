import { Group, Mesh, BoxGeometry, CylinderGeometry, SphereGeometry, TorusGeometry, Vector3, Color, Euler, Quaternion, Matrix4, mergeGeometries } from '../engine/index.js';
import { standard } from '../materials/Materials.js';
import { Texture } from '../engine/gpu/Texture.js';
import { generateMipmaps } from '../engine/gpu/Mipmaps.js';
import { decodeImage } from '../engine/loaders/GLTF.js';
import { buildRecipe } from './PortalInteriorRecipe.js';
import { makeKeyboardLegendMaterial, makeRetroNameplateMaterial, makeRetroScreenMaterial } from './PortalRetroScreens.js';
import { C64Computer } from './C64Computer.js';

const shapeGeometry = (shape, size) => {
  if (shape === 'cylinder') return new CylinderGeometry(size[0] * .5, size[0] * .5, size[1], 16);
  if (shape === 'sphere') return new SphereGeometry(.5, 16, 10);
  if (shape === 'torus') return new TorusGeometry(size[0] * .5, size[1] * .5, 12, 24);
  return new BoxGeometry(size[0], size[1], size[2]);
};

const pixelTexture = (label, rgba, srgb=false) => new Texture({label,width:1,height:1,format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:new Uint8Array(rgba),sampler:'anisoRepeat'});
const loadPortalTexture = async (name, srgb=false) => {
  const url=(import.meta.env.BASE_URL||'/')+'textures/portal-warehouse/'+name;
  const response=await fetch(url); if(!response.ok)throw new Error(`${url}: ${response.status}`);
  const image=await decodeImage(new Uint8Array(await response.arrayBuffer()),'image/jpeg');
  const texture=new Texture({label:name,width:image.width,height:image.height,format:srgb?'rgba8unorm-srgb':'rgba8unorm',data:image.data,mips:true,usage:['sample','copyDst'],sampler:'anisoRepeat'});
  texture.getGPU();generateMipmaps(texture);return texture;
};

// Deterministic world-space detail keeps the merged batches small while retaining
// credible metre scale. The warm term is intentionally material-scoped: the global
// local-light pass is night-gated, so this restrained diffuse approximation preserves
// daytime task-light pools without changing the island sun or clock.
const portalSurface = (name, lights, origin) => {
  const fill = lights.map((light, i) => {
    const p = light.position.map((v, axis) => v + [origin.x, origin.y, origin.z][axis]);
    const c = new Color(light.color);
    return `let lp${i}=vec3f(${p[0]},${p[1]},${p[2]}); let lv${i}=lp${i}-in.P; let ld${i}=length(lv${i}); let la${i}=max(0.0,1.0-ld${i}/${light.range}); warm+=vec3f(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})*max(0.0,dot(in.N,normalize(lv${i})))*la${i}*la${i}*${(light.intensity * .018).toFixed(4)};`;
  }).join('');
  let detail = '';
  if (name === 'brick' || name === 'brickDark') detail = `let wallU=select(in.P.x,in.P.z,abs(in.N.x)>abs(in.N.z));let puv=vec2f(wallU/3.0,in.P.y/3.0);let bc=textureSample(portalBrickAlbedo,smpAnisoRepeat,puv);let arm=textureSample(portalBrickArm,smpAnisoRepeat,puv);let nm=textureSample(portalBrickNormal,smpAnisoRepeat,puv).xyz*2.0-1.0;s.albedo*=bc.rgb;s.ao*=arm.r;s.roughness=clamp(arm.g*.9+.08,.35,1.0);s.normal=perturbNormalByMap(in.P,in.N,puv,nm);`;
  else if (name === 'polishedTile') detail = `let puv=in.P.xz/3.15;let bc=textureSample(portalFloorAlbedo,smpAnisoRepeat,puv);let arm=textureSample(portalFloorArm,smpAnisoRepeat,puv);let nm=textureSample(portalFloorNormal,smpAnisoRepeat,puv).xyz*2.0-1.0;let slabUv=(in.P.xz+vec2f(in.P.z*.07,0.0))/vec2f(4.8,4.05);let slab=fract(slabUv);let slabCell=floor(slabUv);let edge=min(min(slab.x,1.0-slab.x),min(slab.y,1.0-slab.y));let joint=1.0-smoothstep(.004,.017,edge);let slabVariation=fract(sin(dot(slabCell,vec2f(12.9898,78.233)))*43758.5453);let broad=.5+.24*sin(in.P.x*.21+sin(in.P.z*.17)*1.7)+.18*sin(in.P.z*.37-in.P.x*.09);let damp=smoothstep(.58,.8,broad);let crackWave=abs(sin(in.P.x*.39+sin(in.P.z*.71)*2.3));let hairline=(1.0-smoothstep(.008,.026,crackWave))*smoothstep(.62,.9,slabVariation);let wornPath=exp(-abs(in.P.x+2.1)*.28)*(.5+.5*sin(in.P.z*.13));let base=s.albedo*bc.rgb*(.58+slabVariation*.13+wornPath*.04);s.albedo=mix(base,base*.68,joint);s.albedo*=1.0-hairline*.08;s.albedo=mix(s.albedo,s.albedo*.72,damp*.58);s.ao*=arm.r;s.roughness=clamp(mix(.33,.53,arm.g)-damp*.24-wornPath*.035+joint*.26,.09,.86);s.normal=perturbNormalByMap(in.P,in.N,puv,nm);s.envIntensity=1.55;`;
  else if (name === 'concrete' || name === 'concreteDark') detail = `let p=in.P.xz; let a=fract(sin(dot(floor(p*.7),vec2f(12.9898,78.233)))*43758.5453); let b=fract(sin(dot(floor(p*.7)+vec2f(1.0,0.0),vec2f(12.9898,78.233)))*43758.5453); let c=fract(sin(dot(floor(p*.7)+vec2f(0.0,1.0),vec2f(12.9898,78.233)))*43758.5453); let d=fract(sin(dot(floor(p*.7)+vec2f(1.0,1.0),vec2f(12.9898,78.233)))*43758.5453); var f=fract(p*.7); f=f*f*(3.0-2.0*f); let n=mix(mix(a,b,f.x),mix(c,d,f.x),f.y); let ripple=.5+.5*sin(p.x*.31+p.y*.19+n*4.0); let damp=smoothstep(.72,.93,n*.72+ripple*.28); s.albedo*=.9+n*.12-damp*.1; s.roughness=clamp(.91+n*.06-damp*.13,.76,.98);`;
  else if (name === 'steel' || name === 'rust' || name === 'black') detail = `let scratch=smoothstep(.94,.985,fract(sin(dot(floor(in.P.xy*vec2f(7.0,45.0)),vec2f(19.19,73.31)))*3157.7)); s.albedo*=1.0-scratch*.28; s.roughness+=scratch*.18;`;
  else if (name === 'wood') detail = `let grain=.5+.5*sin((in.P.x+sin(in.P.z*2.3)*.12)*38.0); s.albedo*=.84+grain*.2; s.roughness=.6+grain*.12;`;
  else if (name === 'charredWood') detail = `let grain=.5+.5*sin((in.P.x+sin(in.P.z*1.7)*.08)*43.0); let char=pow(.5+.5*sin(in.P.x*7.0+sin(in.P.z*3.1)),6.0); s.albedo*=.82+grain*.14-char*.12; s.roughness=.72+grain*.08+char*.08;`;
  else if (name === 'fabric' || name === 'charcoal') detail = `let fuv=select(vec2f(in.P.x,in.P.y),in.P.xz,abs(in.N.y)>.55)/1.15;let fc=textureSample(portalFabricAlbedo,smpAnisoRepeat,fuv);let fNormal=textureSample(portalFabricNormal,smpAnisoRepeat,fuv).xyz*2.0-1.0;let fr=textureSample(portalFabricRoughness,smpAnisoRepeat,fuv).r;s.albedo*=fc.rgb;s.roughness=clamp(fr*.78+.2,.76,.99);s.normal=perturbNormalByMap(in.P,in.N,fuv,fNormal);`;
  else if (name === 'rug' || name === 'rugLight' || name === 'rugStair') detail = `let weave=.5+.5*sin(in.P.x*95.0)*sin(in.P.z*91.0);let warp=.5+.5*cos(in.P.x*8.0+sin(in.P.z*3.0));let motif=.5+.5*cos((in.P.x+in.P.z)*5.0)*cos((in.P.x-in.P.z)*5.0);let edge=smoothstep(.0,.12,abs(sin(in.P.x*1.55))*abs(sin(in.P.z*1.55)));s.albedo*=.74+weave*.08+warp*.06+motif*.08+edge*.04;s.roughness=.94+weave*.05;`;
  return `${detail} var warm=vec3f(0.0); ${fill} s.emissive+=warm;`;
};

export class PortalInterior {
  constructor(app) {
    this.app = app;
    this.recipe = buildRecipe();
    this.origin = new Vector3(300, 18, 300);
    this.group = new Group();
    this.group.name = 'Island 3 warehouse portal interior';
    this.group.position.copy(this.origin);
    this.group.visible = false;
    app.scene.add(this.group);
    const flatAlbedo=pixelTexture('Portal PBR albedo placeholder',[255,255,255,255],true),flatNormal=pixelTexture('Portal PBR normal placeholder',[128,128,255,255]),flatArm=pixelTexture('Portal PBR ARM placeholder',[255,190,0,255]);
    this.pbr={brick:{albedo:flatAlbedo,normal:flatNormal,arm:flatArm},floor:{albedo:flatAlbedo,normal:flatNormal,arm:flatArm},fabric:{albedo:flatAlbedo,normal:flatNormal,roughness:flatArm}};
    this.materials = {};
    for (const [name, spec] of Object.entries(this.recipe.materials)) {
      const textures=(name==='brick'||name==='brickDark')?{portalBrickAlbedo:this.pbr.brick.albedo,portalBrickNormal:this.pbr.brick.normal,portalBrickArm:this.pbr.brick.arm}:name==='polishedTile'?{portalFloorAlbedo:this.pbr.floor.albedo,portalFloorNormal:this.pbr.floor.normal,portalFloorArm:this.pbr.floor.arm}:(name==='fabric'||name==='charcoal')?{portalFabricAlbedo:this.pbr.fabric.albedo,portalFabricNormal:this.pbr.fabric.normal,portalFabricRoughness:this.pbr.fabric.roughness}:{};
      this.materials[name] = standard({
        name: `Portal ${name}`, color: spec.color, roughness: spec.roughness, metalness: spec.metalness,
        emissive: spec.emissive || 0, emissiveIntensity: spec.emissive ? 0.35 : 0,
        transparent: !!spec.transparent, opacity: spec.opacity ?? 1, depthWrite: spec.depthWrite ?? true,
        underwaterLighting: 'none', localLightsCheap: true, textures,
        surface: portalSurface(name, this.recipe.lights || [], this.origin)
      });
    }
    this.screenMaterials = new Map((this.recipe.screens || []).map(spec => [spec.object, makeRetroScreenMaterial(spec)]));
    this.nameplateMaterials = new Map((this.recipe.screens || []).map(spec => {
      const label = spec.id === 'c64' ? 'COMMODORE 64' : spec.id === 'bbc' ? 'BBC MODEL B' : 'SUN SPARCSTATION';
      return [`${label} nameplate`, makeRetroNameplateMaterial(label)];
    }));
    this.keyboardLegendMaterials = new Map((this.recipe.screens || []).map(spec => [
      `${spec.id} keyboard legends`, makeKeyboardLegendMaterial(spec.id)
    ]));
    this.localLightSources = (this.recipe.lights || []).map((light, index) => this.app.localLights.add({
      position: new Vector3(this.origin.x + light.position[0], this.origin.y + light.position[1], this.origin.z + light.position[2]),
      color: new Color(light.color), intensity: light.intensity, range: light.range, kind: 0,
      phase: index / Math.max(1, this.recipe.lights.length), enabled: false
    }));
    this.interiorColliders = [];
    this.buildGeometry();
    this.textureReady=this.loadSurfaceTextures();
    this.setInteriorCollidersEnabled(false);
    this.buildExteriorPortal();
    this.landscapeEntrance = null;
    this.inside = false;
    this.cooldown = 0;
    this.returnState = null;
    this.c64 = new C64Computer(app);
  }

  async loadSurfaceTextures(){
    try{
      const [ba,bn,br,fa,fn,fr,ua,un,ur]=await Promise.all([
        loadPortalTexture('brick_wall_001_diffuse_1k.jpg',true),loadPortalTexture('brick_wall_001_nor_gl_1k.jpg'),loadPortalTexture('brick_wall_001_arm_1k.jpg'),
        loadPortalTexture('concrete_floor_diff_1k.jpg',true),loadPortalTexture('concrete_floor_nor_gl_1k.jpg'),loadPortalTexture('concrete_floor_arm_1k.jpg'),
        loadPortalTexture('fabric_soft_black_diffuse_512.jpg',true),loadPortalTexture('fabric_soft_black_nor_gl_512.jpg'),loadPortalTexture('fabric_soft_black_roughness_512.jpg')]);
      for(const name of ['brick','brickDark']){const m=this.materials[name];m.bindings.portalBrickAlbedo.texture=ba;m.bindings.portalBrickNormal.texture=bn;m.bindings.portalBrickArm.texture=br;m.needsUpdate=true;}
      const floor=this.materials.polishedTile;floor.bindings.portalFloorAlbedo.texture=fa;floor.bindings.portalFloorNormal.texture=fn;floor.bindings.portalFloorArm.texture=fr;floor.needsUpdate=true;
      for(const name of ['fabric','charcoal']){const m=this.materials[name];m.bindings.portalFabricAlbedo.texture=ua;m.bindings.portalFabricNormal.texture=un;m.bindings.portalFabricRoughness.texture=ur;m.needsUpdate=true;}
      this.pbrReady=true;
    }catch(error){console.warn('Portal warehouse PBR textures unavailable; using deterministic fallback',error);this.pbrReady=false;}
  }

  buildGeometry() {
    const batches = new Map();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Euler();
    const quaternion = new Quaternion();
    const matrix = new Matrix4();
    for (const object of this.recipe.objects) {
      const geometry = shapeGeometry(object.shape, object.size);
      position.set(...object.position);
      rotation.set(...object.rotation);
      quaternion.setFromEuler(rotation);
      scale.set(1, 1, 1);
      if (object.shape === 'sphere') scale.set(...object.size);
      matrix.compose(position, quaternion, scale);
      geometry.applyMatrix4(matrix);
      const screenMaterial = this.screenMaterials.get(object.name);
      const nameplateMaterial = this.nameplateMaterials.get(object.name);
      const keyboardLegendMaterial = this.keyboardLegendMaterials.get(object.name);
      const displayMaterial = screenMaterial || nameplateMaterial || keyboardLegendMaterial;
      if (displayMaterial) {
        const display = new Mesh(geometry, displayMaterial);
        display.name = `Portal ${object.name} generated ${screenMaterial ? 'display' : 'label'}`;
        this.group.add(display);
      } else {
        if (!batches.has(object.material)) batches.set(object.material, []);
        batches.get(object.material).push(geometry);
      }
      if (object.collider) {
        const p = object.position;
        const s = object.size;
        const center = new Vector3(this.origin.x + p[0], this.origin.y + p[1], this.origin.z + p[2]);
        const options = object.walkable ? { walkable: true, solid: true, tag: 'island3-portal' } : { solid: true, tag: 'island3-portal' };
        const record = this.app.colliders.addBox(center, new Vector3(s[0] * .5, s[1] * .5, s[2] * .5), object.rotation[1], options);
        this.interiorColliders.push({ record, solid: record.solid, walkable: record.walkable });
      }
    }
    for (const [material, geometries] of batches) {
      const mesh = new Mesh(geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false), this.materials[material]);
      mesh.name = `Portal ${material} batch (${geometries.length})`;
      this.group.add(mesh);
    }
  }

  setInteriorCollidersEnabled(enabled) {
    for (const collider of this.interiorColliders) {
      collider.record.solid = enabled ? collider.solid : false;
      collider.record.walkable = enabled ? collider.walkable : false;
    }
  }

  buildExteriorPortal() {
    const g = new Group();
    g.name = 'Signed Island 3 warehouse portal';
    const ground = this.app.player?.groundAt?.(100, 580, 30);
    this.exteriorGroundResolved = Number.isFinite(ground);
    this.exteriorGroundY = this.exteriorGroundResolved ? ground : 0;
    g.position.set(100, this.exteriorGroundY, 580);
    this.app.scene.add(g);
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#102b31'; ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#69ffe0'; ctx.lineWidth = 10; ctx.strokeRect(10, 10, 1004, 236);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff0cd';
    ctx.font = 'bold 72px sans-serif'; ctx.fillText('WAREHOUSE LOFT', 512, 112);
    ctx.fillStyle = '#6effdf'; ctx.font = 'bold 38px sans-serif'; ctx.fillText('E TO ENTER', 512, 192);
    const texture = new Texture({ label: 'Warehouse Loft sign', width: 1024, height: 256, data: ctx.getImageData(0, 0, 1024, 256).data });
    const signMaterial = standard({ name: 'Warehouse Loft lettering', color: 0xffffff, roughness: .4, metalness: .1, textures: { warehouseSign: texture }, surface: 'let ink = textureSample(warehouseSign, smpAnisoClamp, vec2f(in.uv.x, 1.0-in.uv.y)).rgb; s.albedo=ink; s.emissive=ink*0.3;' });
    const sign = new Mesh(new BoxGeometry(4.8, 2.1, .18), signMaterial);
    sign.position.y = 2.4; g.add(sign);
    const frame = new Mesh(new TorusGeometry(1.35, .16, 10, 24), this.materials.amber);
    frame.position.set(0, 1.35, .2); g.add(frame);
    const post = new Mesh(new BoxGeometry(.18, 4, .18), this.materials.steel);
    post.position.y = 1.1; g.add(post);
    this.exterior = g;
  }

  // A generated warehouse may share the authored, interactive computer room.
  // The extra entrance reuses the existing sign geometry and materials; the
  // original island entrance and its interaction coordinates remain intact.
  addLandscapeEntrance(x, y, z) {
    if (![x, y, z].every(Number.isFinite)) throw Error('Landscape entrance needs finite coordinates');
    if (this.landscapeEntrance) {
      this.app.scene.remove(this.landscapeEntrance.group);
    }
    const group = this.exterior.clone(true);
    group.name = 'Generated landscape warehouse entrance';
    group.position.set(x, y, z);
    this.app.scene.add(group);
    this.landscapeEntrance = { x, y, z, group };
    return group;
  }

  toast(text) { this.app.ui?.ui.toast(text); }

  enter() {
    const p = this.app.player;
    if (this.inside || p.mode !== 'walk') return;
    const entrance = this.landscapeEntrance;
    const landscape = !!entrance && Math.hypot(p.position.x - entrance.x, p.position.z - entrance.z) < 4.2;
    this.returnState = { position: p.position.clone(), yaw: p.yaw, landscape };
    this.setInteriorCollidersEnabled(true);
    for (const source of this.localLightSources) source.enabled = true;
    this.inside = true;
    this.group.visible = true;
    const arrival = this.recipe.zones.arrival;
    const x = this.origin.x + arrival[0], z = this.origin.z + arrival[2];
    // Spawn on the collider floor. A one-metre drop here can tunnel through
    // the floor during a long first-frame shader compile after teleporting.
    const floor = p.groundAt(x, z, this.origin.y + arrival[1] + 1);
    p.position.set(x, Number.isFinite(floor) ? floor : this.origin.y + arrival[1], z);
    p.velocity.set(0, 0, 0);
    p.grounded = true;
    this.toast('Warehouse loft entered · E to return');
  }

  exit() {
    const p = this.app.player;
    this.inside = false;
    this.group.visible = false;
    for (const source of this.localLightSources) source.enabled = false;
    this.setInteriorCollidersEnabled(false);
    const landscape = !!this.returnState?.landscape;
    if (this.returnState) {
      p.position.copy(this.returnState.position);
      p.yaw = this.returnState.yaw;
    } else {
      const y = p.groundAt(100, 584, 30);
      p.position.set(100, Number.isFinite(y) ? y : 4.2, 584);
    }
    p.velocity.set(0, 0, 0);
    p.grounded = true;
    this.returnState = null;
    this.toast(landscape ? 'Returned to generated warehouse' : 'Returned to Island 3');
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const p = this.app.player;
    if (!p) return;
    if (this.c64.active) return;
    if (!this.exteriorGroundResolved) {
      const ground = p.groundAt?.(100, 580, 30);
      if (Number.isFinite(ground)) {
        this.exteriorGroundResolved = true;
        this.exteriorGroundY = ground;
        this.exterior.position.y = ground;
      }
    }
    if (this.cooldown > 0 || this.app.freeCam || p.mode !== 'walk') return;
    const exteriorY = p.groundAt(100, 580, 30);
    const nearOriginal = Math.hypot(p.position.x - 100, p.position.z - 580) < 4.2 && (!Number.isFinite(exteriorY) || Math.abs(p.position.y - exteriorY) < 3);
    const entrance = this.landscapeEntrance;
    const nearLandscape = entrance && Math.hypot(p.position.x - entrance.x, p.position.z - entrance.z) < 4.2 && Math.abs(p.position.y - entrance.y) < 3;
    const nearOutside = !this.inside && (nearOriginal || nearLandscape);
    const nearInside = this.inside && Math.hypot(p.position.x - (this.origin.x - 4), p.position.z - this.origin.z) < 3.5;
    const nearC64 = this.inside && Math.hypot(p.position.x - (this.origin.x - 11.5), p.position.z - (this.origin.z + 8.0)) < 1.9 && Math.abs(p.position.y - (this.origin.y + 4)) < 2;
    if (nearC64) {
      p.prompt = { key: 'E', text: 'Use Commodore 64' };
      if (this.app.input.hit('KeyE')) { this.c64.open(); this.cooldown = .8; }
    } else if (nearOutside) {
      p.prompt = { key: 'E', text: 'Enter warehouse loft' };
      if (this.app.input.hit('KeyE')) { this.enter(); this.cooldown = .8; }
    } else if (nearInside) {
      p.prompt = { key: 'E', text: 'Return to Island 3' };
      if (this.app.input.hit('KeyE')) { this.exit(); this.cooldown = .8; }
    }
  }
}
