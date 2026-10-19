import './style.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { FBXExporter } from '@comfyorg/fbx-exporter-three';
import JSZip from 'jszip';

const $ = (selector) => document.querySelector(selector);
let glbFile = null;
let fbxFile = null;
let busy = false;

const blobType = 'application/octet-stream';
const sceneStats = (root, animations) => {
  let meshes = 0, tris = 0, skeletons = new Set(), bones = new Set(), materials = new Set();
  root.traverse((o) => {
    if (o.isBone) bones.add(o);
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skeletons.add(o.skeleton);
    const g = o.geometry;
    if (g) tris += Math.floor((g.index?.count || g.attributes.position?.count || 0) / 3);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.filter(Boolean).forEach((m) => materials.add(m));
  });
  return { meshes, tris, bones: bones.size, skeletons: skeletons.size, materials: materials.size, animations: animations?.length || 0 };
};

function showStats(selector, file, data) {
  const el = $(selector);
  el.classList.remove('hidden');
  const mb = `${(file.size / 1048576).toFixed(1)} МБ`;
  el.replaceChildren();
  [['Размер', mb], ['Сетки', data.meshes], ['Треугольники', data.tris.toLocaleString('ru-RU')], ['Кости', data.bones], ['Анимации', data.animations]].forEach(([key,value]) => {
    const item = document.createElement('div'); item.className = 'stat';
    item.textContent = `${key}: `;
    const strong = document.createElement('b'); strong.textContent = String(value);item.appendChild(strong);el.appendChild(item);
  });
}

function status(message, error = false) {
  const el = $('#feedback');
  el.classList.remove('hidden');
  el.classList.toggle('error',error);
  $('#feedback-text').textContent = message;
}
function progress(value) {
  $('#progress-wrap').classList.remove('hidden');
  $('#progress-bar').style.width = `${Math.round(value * 100)}%`;
}
function clearProgress() { $('#progress-wrap').classList.add('hidden');progress(0);$('#progress-wrap').classList.add('hidden'); }
function setBusy(on) {
  busy = on;
  $('#convert-in').disabled = on || !fbxFile;
  $('#convert-out').disabled = on || !glbFile;
  $('#glb-input').disabled = on;
  $('#fbx-input').disabled = on;
}
function niceError(e) { return e instanceof Error ? e.message : String(e); }
function baseName(name) {return (name || 'model').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_').slice(0,65) || 'model';}

async function parseGLB(file) {
  const bytes = await file.arrayBuffer();
  return new GLTFLoader().parseAsync(bytes, '');
}
async function parseFBX(file) {
  const bytes = await file.arrayBuffer();
  const object = new FBXLoader().parse(bytes, '');
  return object;
}

// Native Android Document Picker. File bytes are streamed in small chunks so
// large assets never need to be passed through the bridge as a single base64 string.
async function saveFile(blob, filename, mime = blobType) {
  if (window.MixamoSaver?.begin && window.MixamoSaver?.append && window.MixamoSaver?.finish) {
    const bridge = window.MixamoSaver;
    const err = bridge.begin(filename, mime);
    if (err !== 'OK') throw new Error(err || 'Ошибка открытия файла');
    const CHUNK = 256 * 1024;
    let sent = 0;
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const slice = blob.slice(offset, offset + CHUNK);
      const b64 = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(slice);
      });
      const error = bridge.append(b64);
      if (error !== 'OK') throw new Error(error || 'Ошибка записи файла');
      sent += slice.size;
      progress(Math.min(1, sent / blob.size));
      if (offset % (CHUNK * 8) === 0) await new Promise(r => setTimeout(r, 0));
    }
    bridge.finish();
    status('Выбери папку и имя файла в системном окне Android.');
    return;
  }
  // Browser fallback for desktop use and testing.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;anchor.style.display = 'none';
  document.body.appendChild(anchor);anchor.click();anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  status('Файл подготовлен. Проверь загрузки браузера.');
}
window.mixamoNativeSaved = (ok) => status(ok ? 'Готово! Файл сохранён на устройстве.' : 'Сохранение отменено или не удалось.', !ok);

function selectedOutputFormat() { return document.querySelector('input[name="out-format"]:checked').value; }
function applyModelRotation(root) {
  if ($('#flip-y').checked) root.rotation.y += Math.PI;
  root.updateMatrixWorld(true);
}
function safeMaterialName(s) { return String(s || 'material').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70) || 'material'; }

async function canvasTextureBlob(texture) {
  const image = texture?.image;
  if (!image) return null;
  const w = image.width || image.videoWidth;
  const h = image.height || image.videoHeight;
  if (!w || !h || w * h > 16384 * 16384) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) return null;
  if (image.data && ArrayBuffer.isView(image.data)) {
    const source = image.data;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = source[i * 4] || 0;
      rgba[i * 4 + 1] = source[i * 4 + 1] || 0;
      rgba[i * 4 + 2] = source[i * 4 + 2] || 0;
      rgba[i * 4 + 3] = source[i * 4 + 3] ?? 255;
    }
    ctx.putImageData(new ImageData(rgba,w,h), 0, 0);
  } else {
    ctx.drawImage(image, 0, 0, w, h);
  }
  return new Promise((resolve,reject)=>canvas.toBlob((b)=>b?resolve(b):reject(new Error('Не удалось закодировать текстуру')), 'image/png'));
}

async function meshToObjZip(root, name) {
  const meshes = [];
  root.updateMatrixWorld(true);
  root.traverse(o=>{if(o.isMesh && o.geometry?.attributes?.position)meshes.push(o)});
  if (!meshes.length) throw new Error('В модели нет экспортируемых треугольников');
  const zip = new JSZip();
  const obj = ['# Exported by Mixamo Bridge for automatic rigging', `mtllib ${name}.mtl`];
  const mtl = ['# Materials and embedded base-color textures'];
  const mats = new Map();
  let vertexOffset = 1;
  let totalTris = 0;
  let materialCount = 0;
  const makeMaterial = async (mat) => {
    if (mats.has(mat)) return mats.get(mat);
    const id = `material_${++materialCount}`;
    const safe = safeMaterialName(id);
    mats.set(mat,safe);
    const color = mat?.color || new THREE.Color(1,1,1);
    mtl.push(`newmtl ${safe}`, `Kd ${color.r.toFixed(5)} ${color.g.toFixed(5)} ${color.b.toFixed(5)}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1.0');
    if (mat?.map) {
      const img = await canvasTextureBlob(mat.map);
      if (img) {const filename = `texture_${materialCount}.png`;zip.file(filename,img);mtl.push(`map_Kd ${filename}`);}
    }
    mtl.push('');
    return safe;
  };
  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi];
    const geom = mesh.geometry;
    const pos = geom.getAttribute('position');
    const uv = geom.getAttribute('uv');
    const normal = geom.getAttribute('normal');
    if (!pos || pos.itemSize !== 3) continue;
    const world = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    obj.push(`o mesh_${mi+1}`);
    const v = new THREE.Vector3();
    for(let k=0;k<pos.count;k++) {
      v.fromBufferAttribute(pos,k).applyMatrix4(world);
      obj.push(`v ${v.x.toFixed(7)} ${v.y.toFixed(7)} ${v.z.toFixed(7)}`);
    }
    if (uv) for(let k=0;k<pos.count;k++)obj.push(`vt ${uv.getX(k).toFixed(7)} ${uv.getY(k).toFixed(7)}`);
    if(normal)for(let k=0;k<pos.count;k++){
      v.fromBufferAttribute(normal,k).applyMatrix3(normalMatrix).normalize();
      obj.push(`vn ${v.x.toFixed(7)} ${v.y.toFixed(7)} ${v.z.toFixed(7)}`);
    }
    const indices = geom.index;
    const n = indices?.count || pos.count;
    const groups = geom.groups?.length ? geom.groups : [{start:0,count:n,materialIndex:0}];
    const allMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let currentMat = '';
    for(const group of groups) {
      const material = allMaterials[group.materialIndex] || allMaterials[0] || null;
      const mName = await makeMaterial(material);
      if (mName !== currentMat) {obj.push(`usemtl ${mName}`);currentMat = mName;}
      const to = Math.min(group.start+group.count,n);
      for(let p=group.start;p+2<to;p+=3){
        const a=[p,p+1,p+2].map(i=>(indices?indices.getX(i):i)+vertexOffset);
        const f = a.map(i=> uv&&normal?`${i}/${i}/${i}`:uv?`${i}/${i}`:normal?`${i}//${i}`:`${i}`);
        obj.push(`f ${f.join(' ')}`);totalTris++;
      }
    }
    vertexOffset += pos.count;
    status(`Обработано сеток: ${mi+1} из ${meshes.length} · ${totalTris.toLocaleString('ru-RU')} треугольников`);
    progress((mi + 1) / (meshes.length + 1) * .85);
    await new Promise(r=>setTimeout(r,0));
  }
  zip.file(`${name}.obj`,obj.join('\n')+'\n');
  zip.file(`${name}.mtl`,mtl.join('\n')+'\n');
  status('Упаковка модели и текстур в ZIP…');
  const bytes=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:2}},x=>progress(.85+x.percent/100*.15));
  return bytes;
}

async function handleGLB() {
  if(!glbFile || busy)return;
  setBusy(true); progress(.01);
  try {
    status('Читаю GLB…');
    const gltf=await parseGLB(glbFile);
    const info=sceneStats(gltf.scene,gltf.animations);
    showStats('#glb-stats',glbFile,info);
    if(!info.meshes)throw new Error('Пустая GLB-модель');
    if(info.tris>400000)status('Очень тяжёлая модель — конвертация может занять несколько минут.');
    applyModelRotation(gltf.scene);
    const name=baseName(glbFile.name);
    if(selectedOutputFormat()==='zip') {
      if(info.skeletons>0)status('Внимание: OBJ не переносит скелет и анимации. Для такого GLB лучше выбрать FBX.');
      const zip=await meshToObjZip(gltf.scene,name);
      progress(.99);
      await saveFile(zip,`${name}_Mixamo_OBJ.zip`,'application/zip');
    } else {
      status('Создаю FBX Binary 7.4 с текстурами и костями…');
      gltf.scene.animations=gltf.animations;
      const bytes=await new FBXExporter().parseAsync(gltf.scene,{version:7400,embedTextures:true,animations:gltf.animations,preset:'threejs',includeAnimations:true});
      if(!bytes?.length) throw new Error('FBX экспорт не вернул данных');
      const header=String.fromCharCode(...bytes.slice(0,18));
      if(!header.startsWith('Kaydara FBX Binary'))throw new Error('Некорректный FBX-заголовок');
      progress(.99);
      await saveFile(new Blob([bytes],{type:blobType}),`${name}_FBX_7400.fbx`);
    }
  }catch(error){console.error(error);status(`Не удалось конвертировать: ${niceError(error)}`,true);}finally{setBusy(false);setTimeout(clearProgress,1300);}
}

async function handleFBX(){
  if(!fbxFile || busy)return;
  setBusy(true);progress(.02);
  try{
    status('Импортирую FBX. На сложной модели это может занять время…');
    const object=await parseFBX(fbxFile);
    const clips=object.animations || [];
    const info=sceneStats(object,clips);
    showStats('#fbx-stats',fbxFile,info);
    if(info.meshes===0)throw new Error('FBX не содержит геометрии. Это может быть файл только с анимацией.');
    if(info.tris>400000)status('Большая модель — возможно высокое потребление памяти на Android.');
    progress(.35);
    object.updateMatrixWorld(true);
    status(`Экспортирую GLB: ${info.bones} костей, ${clips.length} анимаций…`);
    const result=await new GLTFExporter().parseAsync(object,{
      binary:true, onlyVisible:false, trs:true,
      animations:clips, maxTextureSize:$('#texture-limit').checked?2048:4096,
    });
    progress(.95);
    if(!(result instanceof ArrayBuffer))throw new Error('Экспорт GLB вернул неожиданный формат');
    const signature=new DataView(result).getUint32(0,true);
    if(signature!==0x46546c67)throw new Error('Недействительная сигнатура GLB');
    const out=new Blob([result],{type:'model/gltf-binary'});
    await saveFile(out,`${baseName(fbxFile.name)}_Godot.glb`,'model/gltf-binary');
  }catch(error){console.error(error);status(`Ошибка импорта/экспорта FBX: ${niceError(error)}`,true);}finally{setBusy(false);setTimeout(clearProgress,1300);}
}

for(const button of document.querySelectorAll('.tab'))button.addEventListener('click',()=>{
  if(busy)return;
  for(const tab of document.querySelectorAll('.tab')){
    tab.classList.toggle('active',tab===button);
    tab.setAttribute('aria-selected',tab===button?'true':'false');
  }
  for(const section of ['#to-mixamo','#from-mixamo'])$(section).classList.add('hidden');
  $('#'+button.dataset.tab).classList.remove('hidden');
  $('#feedback').classList.add('hidden');
});
for(const item of document.querySelectorAll('input[name="out-format"]'))item.addEventListener('change',()=>{
  document.querySelectorAll('.mode').forEach(m=>m.classList.toggle('selected',m.querySelector('input').checked));
});
$('#glb-input').addEventListener('change',e=>{
  glbFile=e.target.files?.[0] || null;
  $('#glb-title').textContent=glbFile?.name || 'Выбрать GLB';
  $('#glb-subtitle').textContent=glbFile?`${(glbFile.size/1048576).toFixed(1)} МБ · готов к конвертации`:'Файл Meshy, Blender или Rig Animation Studio';
  $('#glb-stats').classList.add('hidden');
  if(glbFile?.size>150*1048576)status('Модель больше 150 МБ — на старом Android может не хватить оперативной памяти.');
  setBusy(false);
});
$('#fbx-input').addEventListener('change',e=>{
  fbxFile=e.target.files?.[0] || null;
  $('#fbx-title').textContent=fbxFile?.name || 'Выбрать FBX';
  $('#fbx-subtitle').textContent=fbxFile?`${(fbxFile.size/1048576).toFixed(1)} МБ · готов к конвертации`:'Скачанный персонаж с костями / анимацией';
  $('#fbx-stats').classList.add('hidden');
  setBusy(false);
});
$('#convert-out').addEventListener('click',handleGLB);
$('#convert-in').addEventListener('click',handleFBX);
