// Browser side of `assets render-previews`: loads one model from the local
// HTTP server, frames it from a three-quarter view and returns a PNG data URL.
// Runs in headless Chromium; Node drives it through window.renderModel().
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { FBXLoader } from "three/addons/loaders/FBXLoader.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"

const SIZE = 512

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(SIZE, SIZE)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
// A soft studio environment so PBR (GLB) materials neither go black nor flat;
// it is generated in code, nothing is fetched.
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.3

scene.add(new THREE.HemisphereLight(0xffffff, 0x6a6a74, 0.9))
const key = new THREE.DirectionalLight(0xffffff, 1.6)
scene.add(key)
scene.add(key.target)

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000)

function makeManager(failed) {
  const m = new THREE.LoadingManager()
  m.pending = 0
  m.onStart = () => {}
  m.itemStart = ((orig) => (url) => { m.pending++; orig.call(m, url) })(m.itemStart)
  m.itemEnd = ((orig) => (url) => { m.pending--; orig.call(m, url) })(m.itemEnd)
  m.onError = (url) => failed.push(url)
  return m
}

async function settle(manager, ms = 15000) {
  const t0 = performance.now()
  while (manager.pending > 0 && performance.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function loadAny(url, manager) {
  const ext = url.split("?")[0].split(".").pop().toLowerCase()
  if (ext === "glb" || ext === "gltf") {
    const g = await new GLTFLoader(manager).loadAsync(url)
    return { object: g.scene, animations: g.animations ?? [] }
  }
  if (ext === "fbx") {
    const o = await new FBXLoader(manager).loadAsync(url)
    return { object: o, animations: o.animations ?? [] }
  }
  if (ext === "obj") {
    const o = await new OBJLoader(manager).loadAsync(url)
    return { object: o, animations: [] }
  }
  throw new Error(`unsupported model type: ${ext}`)
}

function meshesOf(obj) {
  const out = []
  obj.traverse((o) => { if (o.isMesh && o.visible) out.push(o) })
  return out
}

function disposeAll(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture) m[k].dispose()
      m.dispose()
    }
  })
}

function applySkin(obj, texture) {
  for (const mesh of meshesOf(obj)) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const next = mats.map((m) => {
      const n = new THREE.MeshLambertMaterial({ map: texture, side: m?.side ?? THREE.FrontSide })
      m?.dispose?.()
      return n
    })
    mesh.material = Array.isArray(mesh.material) ? next : next[0]
  }
}

// Untextured FBX/OBJ parts come in as near-black or pure-white Phong; give
// them a neutral matte look so their shape reads.
function softenPhong(obj) {
  for (const mesh of meshesOf(obj)) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (m && (m.isMeshPhongMaterial)) { m.shininess = Math.min(m.shininess ?? 10, 10); m.specular?.setRGB(0.05, 0.05, 0.05) }
    }
  }
}

function frame(obj, { azimuth, elevation, margin }) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj, true)
  if (box.isEmpty() || !Number.isFinite(box.min.x)) throw new Error("model has no visible geometry")
  const center = box.getCenter(new THREE.Vector3())
  const diag = box.getSize(new THREE.Vector3()).length() || 1

  const az = THREE.MathUtils.degToRad(azimuth)
  const el = THREE.MathUtils.degToRad(elevation)
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  camera.position.copy(center).addScaledVector(dir, diag * 2)
  camera.up.set(0, 1, 0)
  camera.lookAt(center)
  camera.updateMatrixWorld(true)

  // Fit the orthographic frustum to the projected bounding-box corners.
  const inv = camera.matrixWorldInverse
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv)
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
  }
  const half = Math.max(maxX - minX, maxY - minY) / 2 * (1 + margin)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  camera.left = cx - half; camera.right = cx + half
  camera.top = cy + half; camera.bottom = cy - half
  camera.near = Math.max(0.001, -maxZ - diag)
  camera.far = -minZ + diag
  camera.updateProjectionMatrix()

  // Key light from the upper left of the view, slightly in front.
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  key.position.copy(center).addScaledVector(dir, diag).addScaledVector(right, -diag * 0.8)
    .add(new THREE.Vector3(0, diag * 1.2, 0))
  key.target.position.copy(center)
}

/**
 * opts: url (model), skin (texture url, optional), poseFrom (animation file
 * whose first clip poses the model, optional), poseAt (0..1 of the clip),
 * azimuth, elevation (degrees), margin (fraction).
 */
window.renderModel = async function renderModel(opts) {
  const failed = []
  const manager = makeManager(failed)
  const { azimuth = 45, elevation = 30, margin = 0.06, poseAt = 0.3 } = opts
  let root = null
  try {
    const loaded = await loadAny(opts.url, manager)
    root = loaded.object
    let clips = loaded.animations

    // An animation file that carries only a skeleton is shown on the pack's
    // base model instead.
    if (opts.baseModel && meshesOf(root).length === 0) {
      disposeAll(root)
      const base = await loadAny(opts.baseModel, manager)
      root = base.object
    }
    if (opts.poseFrom && opts.poseFrom !== opts.url) {
      const anim = await loadAny(opts.poseFrom, manager)
      clips = anim.animations
      disposeAll(anim.object)
    }
    await settle(manager)

    if (opts.skin) {
      const tex = await new THREE.TextureLoader(manager).loadAsync(opts.skin)
      tex.colorSpace = THREE.SRGBColorSpace
      applySkin(root, tex)
    }
    softenPhong(root)

    scene.add(root)
    let posed = false
    if (opts.pose && clips.length) {
      const mixer = new THREE.AnimationMixer(root)
      const clip = clips[0]
      mixer.clipAction(clip).play()
      mixer.setTime(clip.duration * poseAt)
      posed = true
    }
    frame(root, { azimuth, elevation, margin })
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL("image/png")
    return { dataUrl, meshes: meshesOf(root).length, clips: clips.length, posed, failed }
  } finally {
    if (root) { scene.remove(root); disposeAll(root) }
  }
}

window.rendererReady = true
