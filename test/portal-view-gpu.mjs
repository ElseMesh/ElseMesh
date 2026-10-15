// Direct WebGPU smoke for the actual portal aperture and electrical materials.
import assert from 'node:assert/strict';
import './headless.mjs';
import { GPU } from '../src/engine/gpu/GPU.js';
import { RenderTarget } from '../src/engine/gpu/Texture.js';
import { readTexture } from '../src/engine/gpu/Readback.js';
import { FrameUniforms, G, createViewUniforms, setFrameCamera } from '../src/engine/render/Frame.js';
import { Material } from '../src/engine/render/Material.js';
import { MeshRenderer } from '../src/engine/render/MeshRenderer.js';
import { SunShadows } from '../src/engine/render/Shadows.js';
import { BoxGeometry, CircleGeometry, Mesh, PerspectiveCamera, Scene, TorusGeometry } from '../src/engine/index.js';
import { createPortalApertureMaterial, createPortalStormMaterial } from '../src/world/PortalView.js';
import { PortalMonkeyActor } from '../src/world/PortalMonkeyActor.js';
import { Vector3 } from '../src/engine/index.js';

await GPU.init({ headless: true });
const width = 128, height = 72;
const preview = new RenderTarget(width, height, { colors: ['rgba16float'], depth: 'depth32float', label: 'portalGpuPreview' });
const output = new RenderTarget(width, height, { colors: ['rgba8unorm'], depth: 'depth32float', label: 'portalGpuOutput' });
const camera = new PerspectiveCamera(65, width / height, .05, 50);
const otherCamera = new PerspectiveCamera(65, width / height, .05, 50);
const viewBlock = createViewUniforms('portalGpuView');
const mr = new MeshRenderer();
const shadows = new SunShadows();
const destination = new Scene();
const red = new Mesh(new BoxGeometry(5, 5, .2), new Material({ name: 'portalGpuRed', lit: false, color: 0xff2008 }));
red.position.z = -4;
destination.add(red);
const exterior = new Scene();
const apertureMaterial = createPortalApertureMaterial(preview.texture);
apertureMaterial.uniforms.previewActive.value = 1;
const aperture = new Mesh(new CircleGeometry(1.22, 48), apertureMaterial);
aperture.position.z = -2;
exterior.add(aperture);
const storm = new Mesh(new TorusGeometry(1.35, .028, 4, 48), createPortalStormMaterial());
storm.position.z = -1.98;
exterior.add(storm);

for (let i = 0; i < 5; i++) {
  GPU.beginFrame();
  setFrameCamera(otherCamera, width, height, { block: viewBlock });
  shadows.render(destination, mr, shadows.update(otherCamera, G.sunDir.value));
  mr.render(destination, {
    kind: 'color', camera: otherCamera, frameBlock: viewBlock,
    colorViews: [preview.texture.view()], colorFormats: preview.formats,
    clearColors: [[0, 0, 0, 1]], depthView: preview.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0,
  });
  setFrameCamera(camera, width, height);
  mr.render(exterior, {
    kind: 'color', camera, frameBlock: FrameUniforms,
    colorViews: [output.texture.view()], colorFormats: output.formats,
    clearColors: [[0, 0, 0, 1]], depthView: output.depthTexture.view(), depthFormat: 'depth32float', clearDepth: 0,
  });
  GPU.submit();
  await GPU.device.queue.onSubmittedWorkDone();
}
const pixels = new Uint8Array((await readTexture(output.texture)).data);
const mid = ((height >> 1) * width + (width >> 1)) * 4;
assert.ok(pixels[mid] > 100 && pixels[mid] > pixels[mid + 1] * 2,
  `portal centre should show the red destination: ${Array.from(pixels.slice(mid, mid + 4))}`);
assert.equal(pixels[0], 0, 'outside the circular aperture should show the clear colour');
const actorScene=new Scene(),actor=new PortalMonkeyActor(actorScene);
actor.pose({position:new Vector3(0,0,-3),yaw:0,time:1,walk:1,throwWeight:0});
camera.position.y=.6;camera.updateMatrixWorld();
async function actorPixels(clipD){
  for(const batch of actor.batches)batch.material.uniforms.clipD.value=clipD;
  for(let i=0;i<5;i++){
    GPU.beginFrame();setFrameCamera(camera,width,height);
    shadows.render(actorScene,mr,shadows.update(camera,G.sunDir.value));
    mr.render(actorScene,{kind:'color',camera,frameBlock:FrameUniforms,colorViews:[output.texture.view()],colorFormats:output.formats,
      clearColors:[[0,0,0,1]],depthView:output.depthTexture.view(),depthFormat:'depth32float',clearDepth:0});
    GPU.submit();await GPU.device.queue.onSubmittedWorkDone();
  }
  const data=new Uint8Array((await readTexture(output.texture)).data);
  return data.reduce((n,v,i)=>n+(i%4!==3&&v>0?1:0),0);
}
assert.ok(await actorPixels(1)>0,'unclipped monkey must render');
assert.equal(await actorPixels(-1),0,'clipped monkey must leave no color fragments');
actor.dispose();
console.log('Portal aperture, electrical material and monkey clipping WebGPU smoke passed');
process.exit(0);
