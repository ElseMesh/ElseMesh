import { DEFAULT_LANDSCAPE_SPEC, TERRAIN_FEATURES, validateLandscapeSpec, parseLandscapeDescription, landscapeWorldId, landscapeBounds } from './LandscapeSpec.js';
import { landscapeHeightAt, landscapePathLayout } from './LandscapeHeight.js';
import { getLandscapeAsset, validateLandscapeAsset, validateLandscapeAssetReferences } from './LandscapeAssets.js';

export const LANDSCAPE_STORAGE_KEY = 'elsemesh.landscape-spec.v1';

export function validateBuilderSpec(input) {
  const result = validateLandscapeSpec(input);
  if (!result.valid) return result;
  const assets = validateLandscapeAssetReferences(result.spec.structures);
  const errors = assets.errors.map(error => `Structure ${error.index + 1}: ${error.message}`);
  for (const placement of result.spec.structures) if (placement.assetId !== 'abandoned-warehouse') errors.push(`Structure ${placement.assetId}: this builder currently supports only the abandoned-warehouse runtime adapter.`);
  for (const [index, ref] of result.spec.references.entries()) {
    const asset = getLandscapeAsset(ref.assetId);
    if (!asset || !validateLandscapeAsset(asset).valid) errors.push(`Reference ${index + 1}: choose a registered asset cleared for public redistribution; ${ref.assetId} is unavailable.`);
  }
  return errors.length ? { ...result, valid: false, spec: null, errors } : result;
}

export function readSavedLandscapeSpec(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(LANDSCAPE_STORAGE_KEY);
    if (!saved || saved.length > 100000) return null;
    const result = validateBuilderSpec(JSON.parse(saved));
    return result.valid ? result.spec : null;
  } catch { return null; }
}

const make = (tag, text, parent) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
};

export class LandscapeBuilder {
  constructor({ spec = DEFAULT_LANDSCAPE_SPEC, parent = document.body, onGoHome, onGoLandscape } = {}) {
    this.spec = validateBuilderSpec(spec).spec ?? DEFAULT_LANDSCAPE_SPEC;
    this.timer = null;
    this.fields = {};
    const panel = this.element = make('section', undefined, parent);
    panel.id = 'landscape-builder';
    panel.setAttribute('aria-label', 'Landscape builder');
    panel.style.cssText = 'position:fixed;right:12px;top:12px;bottom:12px;width:min(440px,calc(100vw - 24px));box-sizing:border-box;overflow:auto;z-index:10000;background:#10252a;color:#f4f9f6;border:1px solid #93b5a6;border-radius:12px;padding:18px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 8px 40px #0009;';
    // Isolate editing gestures from game keyboard/pointer controls.
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel']) panel.addEventListener(type, event => event.stopPropagation());
    make('h2', 'Build a landscape', panel).style.margin = '0 0 8px';
    this.hideButton = this.button('Hide builder', () => this.setExpanded(false), panel);
    this.hideButton.setAttribute('aria-controls', panel.id);
    if (typeof onGoHome === 'function') this.button('Go home', () => onGoHome(), panel);
    if (typeof onGoLandscape === 'function') this.button('Go to landscape', () => onGoLandscape(), panel);
    this.reopenButton = this.button('Open landscape builder', () => this.setExpanded(true), parent);
    this.reopenButton.id = 'landscape-builder-reopen';
    this.reopenButton.style.cssText = 'position:fixed;right:12px;top:12px;z-index:10000;padding:10px 14px;border:1px solid #93b5a6;border-radius:8px;background:#10252a;color:#f4f9f6;font:14px system-ui,sans-serif;cursor:pointer';
    this.reopenButton.setAttribute('aria-controls', panel.id);
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click']) this.reopenButton.addEventListener(type, event => event.stopPropagation());
    make('p', 'Describe supported terrain, choose its dimensions, then preview or explore. Defaults: 2 km × 2 km, elevation ceiling 250 m.', panel);
    make('p', 'This deterministic builder recognizes coast, beach, hills, forest and mountain ridge. Other prose is reported below. Hidden building geometry and real-world dimensions are not inferred from photographs.', panel);
    const form = this.form = make('form', undefined, panel);
    form.noValidate = true;
    const label = make('label', 'Landscape description', form);
    label.htmlFor = 'landscape-description';
    const description = this.fields.description = make('textarea', undefined, form);
    description.id = 'landscape-description'; description.rows = 3; description.maxLength = 2000;
    description.style.cssText = 'width:100%;box-sizing:border-box;display:block;margin-bottom:8px';
    this.button('Use supported features from description', () => {
      try { const parsed = parseLandscapeDescription(description.value); for (const feature of TERRAIN_FEATURES) this.fields[`feature:${feature}`].checked = parsed.features.includes(feature); this.preview(); }
      catch (error) { this.notice(error.message, true); }
    }, form);
    const features = make('fieldset', undefined, form); make('legend', 'Terrain features (explicit selection)', features);
    for (const feature of TERRAIN_FEATURES) this.checkbox(`feature:${feature}`, feature.replaceAll('-', ' '), features);
    const grid = make('div', undefined, form); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0';
    this.number('width', 'Width (m)', 256, 8192, 1, grid);
    this.number('length', 'Length (m)', 256, 8192, 1, grid);
    this.number('maxElevation', 'Elevation ceiling (m)', -49, 2000, 1, grid);
    this.number('waterLevel', 'Water level (m)', -50, 50, 1, grid);
    this.number('seed', 'Seed', 0, 4294967295, 1, grid);
    this.number('ruggedness', 'Ruggedness (0–1)', 0, 1, .05, grid);
    this.number('treeDensity', 'Tree density (0–1)', 0, 1, .05, grid);
    this.number('grassDensity', 'Grass density (0–1)', 0, 1, .05, grid);
    this.number('originX', 'Centre X (m)', -1000000, 1000000, 1, grid);
    this.number('originZ', 'Centre Z (m)', -1000000, 1000000, 1, grid);
    this.select('terrainType', 'Terrain type', [['temperate-island','Temperate island'],['temperate-hills','Temperate hills']], form);
    this.select('qualityProfile', 'Quality', [['low','Low'],['balanced','Balanced'],['high','High']], form);
    const access = make('fieldset', undefined, form); make('legend', 'Access and structures', access);
    this.checkbox('pathsEnabled', 'Access path', access);
    this.number('pathWidth', 'Path width (2–12 m)', 2, 12, .5, access);
    this.checkbox('roadsEnabled', 'Access road', access);
    this.number('roadWidth', 'Road width (8–16 m)', 8, 16, .5, access);
    this.checkbox('warehouse', 'Place licensed warehouse with computer-room access', access);
    make('p', 'Access follows the warehouse entrance. Paths and roads are generated access corridors; roads do not add traffic. Warehouse placement uses a centre pad and the existing building adapter.', access);
    const details = make('details', undefined, form); make('summary', 'Reference metadata and rights', details);
    make('p', 'No photograph upload is used here. Saved/imported references contain approved asset IDs, titles, sources, licences and attribution only. Private photographs and experimental warehouse/cottage models are not available for public placement.', details);
    this.referenceNote = make('p', undefined, details);
    const asset = getLandscapeAsset('abandoned-warehouse');
    const credit = make('p', asset.licence.attribution, details);
    const sourceLink = make('a', 'Original warehouse source', credit); sourceLink.href = asset.source.uri; sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'; sourceLink.style.color = '#b9efcd';
    const actions = make('div', undefined, form); actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:14px 0';
    this.button('Preview', () => this.preview(), actions);
    this.button('Save spec', () => this.save(false), actions);
    this.button('Save and explore', () => this.save(true), actions);
    this.button('Load saved spec', () => {
      const saved = readSavedLandscapeSpec();
      if (!saved) { this.notice('No valid saved spec is available. Save a valid landscape first, or import an exported JSON file.', true); return; }
      this.populate(saved); this.preview(); this.notice('Loaded saved landscape.');
    }, actions);
    this.button('Export JSON', () => this.exportJSON(), actions);
    const importLabel = make('label', 'Import landscape JSON', form); importLabel.htmlFor = 'landscape-json-import';
    const input = make('input', undefined, form); input.id = 'landscape-json-import'; input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'block';
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        if (file.size > 100000) throw Error('JSON exceeds 100 KB. Export a single landscape spec and try again.');
        const result = validateBuilderSpec(JSON.parse(await file.text()));
        if (!result.valid) { this.report(result); return; }
        this.populate(result.spec); this.preview(); this.notice(`Imported ${file.name}. Save to retain this landscape.`);
      } catch (error) { this.notice(`Import failed: ${error.message}`, true); }
      finally { input.value = ''; }
    });
    form.addEventListener('submit', event => { event.preventDefault(); this.preview(); });
    form.addEventListener('input', () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.preview(), 180); });
    this.messages = make('div', undefined, panel); this.messages.setAttribute('aria-live', 'polite'); this.messages.setAttribute('role', 'status');
    this.canvas = make('canvas', undefined, panel); this.canvas.width = 160; this.canvas.height = 160;
    this.canvas.style.cssText = 'width:100%;aspect-ratio:1;image-rendering:pixelated;border:1px solid #92b5a6;margin-top:12px';
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Terrain preview: blue sea, sand shore, green lowlands and pale high ground.');
    this.caption = make('p', undefined, panel);
    make('p', 'Preview: blue sea · sand shore · green lowlands · pale high ground · gold access route · white warehouse marker. This is a height-map preview; performance and appearance are verified in the generated world.', panel);
    this.populate(this.spec); this.preview();
    this.setExpanded(new URLSearchParams(globalThis.location?.search ?? '').get('generated') !== '1', false);
  }

  button(text, handler, parent) { const node = make('button', text, parent); node.type = 'button'; node.style.cssText = 'padding:7px 10px;cursor:pointer'; node.addEventListener('click', handler); return node; }
  checkbox(key, title, parent) { const label = make('label', undefined, parent); label.style.cssText = 'display:block;margin:5px 0'; const input = this.fields[key] = make('input', undefined, label); input.type = 'checkbox'; label.append(document.createTextNode(` ${title}`)); return input; }
  number(key, title, min, max, step, parent) { const label = make('label', title, parent); label.style.display = 'block'; const input = this.fields[key] = make('input', undefined, label); input.type = 'number'; input.min = min; input.max = max; input.step = step; input.style.cssText = 'display:block;box-sizing:border-box;width:100%;padding:5px'; return input; }
  select(key, title, choices, parent) { const label = make('label', title, parent); label.style.cssText = 'display:block;margin:10px 0'; const select = this.fields[key] = make('select', undefined, label); select.style.cssText = 'display:block;width:100%;padding:5px'; for (const [value, title] of choices) make('option', title, select).value = value; }

  populate(spec) {
    this.spec = spec;
    for (const key of ['description','width','length','maxElevation','waterLevel','seed','terrainType','qualityProfile']) this.fields[key].value = spec[key];
    for (const feature of TERRAIN_FEATURES) this.fields[`feature:${feature}`].checked = spec.features.includes(feature);
    const values = { ruggedness: spec.elevation.ruggedness, treeDensity: spec.vegetation.treeDensity, grassDensity: spec.vegetation.grassDensity, originX: spec.origin.x, originZ: spec.origin.z, pathWidth: spec.paths.width, roadWidth: spec.roads.width };
    for (const [key, value] of Object.entries(values)) this.fields[key].value = value;
    this.fields.pathsEnabled.checked = spec.paths.enabled; this.fields.roadsEnabled.checked = spec.roads.enabled; this.fields.warehouse.checked = spec.structures.some(p => p.assetId === 'abandoned-warehouse');
    this.referenceNote.textContent = spec.references.length ? `Retained approved metadata: ${spec.references.map(ref => ref.title).join('; ')}.` : 'No reference metadata attached. Warehouse provenance and licence are retained in the asset registry.';
  }

  readForm() {
    const f = this.fields, n = key => f[key].value.trim() === '' ? NaN : Number(f[key].value);
    const origin = { x: n('originX'), z: n('originZ') };
    const prior = this.spec.structures.find(p => p.assetId === 'abandoned-warehouse');
    return { ...this.spec, description: f.description.value, width:n('width'), length:n('length'), maxElevation:n('maxElevation'), waterLevel:n('waterLevel'), seed:n('seed'), origin,
      features: TERRAIN_FEATURES.filter(feature => f[`feature:${feature}`].checked), terrainType:f.terrainType.value, qualityProfile:f.qualityProfile.value,
      elevation:{ruggedness:n('ruggedness')}, vegetation:{treeDensity:n('treeDensity'),grassDensity:n('grassDensity')}, paths:{enabled:f.pathsEnabled.checked,width:n('pathWidth')}, roads:{enabled:f.roadsEnabled.checked,width:n('roadWidth')},
      structures: f.warehouse.checked ? [{assetId:'abandoned-warehouse',x:origin.x+(prior?prior.x-this.spec.origin.x:0),z:origin.z+(prior?prior.z-this.spec.origin.z:0),yawRadians:prior?.yawRadians??0,scale:prior?.scale??1}] : [],
    };
  }

  notice(message, error = false) { const p = make('p', message, this.messages); p.style.color = error ? '#ffb8a8' : '#c7f4db'; }
  report(result) {
    this.messages.replaceChildren();
    if (!result.valid) { this.notice('Fix these fields before saving or exploring:', true); const list = make('ul', undefined, this.messages); for (const error of result.errors) make('li', error, list); }
    else this.notice(`Valid landscape · ${landscapeWorldId(result.spec)}`);
    for (const warning of result.warnings) this.notice(warning);
    return result.valid;
  }

  preview() {
    const result = validateBuilderSpec(this.readForm()); this.report(result);
    if (!result.valid) { this.caption.textContent = 'Preview is paused until the fields are valid. The previous map remains visible.'; return null; }
    const s = result.spec, bounds = landscapeBounds(s), canvas = this.canvas, context = canvas.getContext('2d');
    if (!context) { this.notice('2D canvas is unavailable in this browser. Save/export remains available.', true); return s; }
    const image = context.createImageData(canvas.width, canvas.height);
    for (let row=0; row<canvas.height; row++) for (let col=0; col<canvas.width; col++) {
      const x=bounds.minX+(col+.5)/canvas.width*s.width,z=bounds.minZ+(row+.5)/canvas.height*s.length,h=landscapeHeightAt(x,z,s);
      const t=Math.max(0,Math.min(1,(h-s.waterLevel)/(s.maxElevation-s.waterLevel)));
      const color=h<=s.waterLevel?[25,72,100]:h<s.waterLevel+5?[205,187,133]:[Math.round(45+175*t),Math.round(110+105*t),Math.round(66+150*t)];
      const i=(row*canvas.width+col)*4; image.data.set([...color,255],i);
    }
    context.putImageData(image,0,0);
    const point = p => [(p.x-bounds.minX)/s.width*canvas.width,(p.z-bounds.minZ)/s.length*canvas.height];
    const route=landscapePathLayout(s);
    if (route.enabled) { context.strokeStyle='#ffdf77'; context.lineWidth=Math.max(1,route.width/s.width*canvas.width); context.beginPath(); context.moveTo(...point(route.spawn)); context.lineTo(...point(route.gate)); context.stroke(); }
    for (const building of s.structures) { const [x,z]=point(building); context.fillStyle='#ffffff'; context.fillRect(x-2,z-2,4,4); }
    this.caption.textContent = `${s.width} × ${s.length} m · ceiling ${s.maxElevation} m · seed ${s.seed} · north at top · ${landscapeWorldId(s)}`;
    return s;
  }

  save(explore) {
    const spec = this.preview(); if (!spec) return;
    try { globalThis.localStorage.setItem(LANDSCAPE_STORAGE_KEY,JSON.stringify(spec)); this.spec = spec; this.notice('Saved in this browser. Export JSON for a portable copy.'); }
    catch (error) { this.notice(`Could not save: ${error.message}. Enable browser storage or export JSON.`,true); return; }
    if (explore) { const url=new URL(globalThis.location.href); url.searchParams.set('landscapeBuilder',''); url.searchParams.set('generated','1'); globalThis.location.assign(url.href); }
  }

  exportJSON() {
    const spec=this.preview(); if (!spec) return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(spec,null,2)+'\n'],{type:'application/json'}));
    const link=make('a',undefined,this.element); link.href=url; link.download=`${landscapeWorldId(spec)}.json`; link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    this.notice('Exported landscape JSON.');
  }

  setExpanded(expanded, moveFocus = true) {
    this.element.hidden = !expanded;
    this.reopenButton.hidden = expanded;
    this.reopenButton.setAttribute('aria-expanded', String(expanded));
    if (moveFocus) (expanded ? this.hideButton : this.reopenButton).focus();
  }

  dispose() { clearTimeout(this.timer); this.element.remove(); this.reopenButton.remove(); }
}
