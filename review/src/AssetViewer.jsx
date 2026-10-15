import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// TS 이식: 옛 모델로더.js 새GLTF로더 → loaders/compressedGlb.ts createCompressedGltfLoader
import { createCompressedGltfLoader } from '../../naju01/src/loaders/compressedGlb.ts';

function disposeObject(object) {
  const textures = new Set();
  object?.traverse(child => {
    child.geometry?.dispose();
    for (const material of [child.material].flat().filter(Boolean)) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

export default function AssetViewer({ asset, onResult }) {
  const mount = useRef(null);
  const callback = useRef(onResult);
  const [state, setState] = useState({ status: 'loading', message: '3D 파일을 읽는 중입니다.' });
  useEffect(() => { callback.current = onResult; }, [onResult]);
  useEffect(() => {
    let alive = true, frame = 0, renderer, controls, observer, model;
    const host = mount.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e9e7e1');
    const report = (status, message) => {
      if (!alive) return;
      setState({ status, message });
      callback.current?.({ assetId: asset.id, assetSha256: asset.sha256, status, note: message });
    };
    const contextLost = (event) => { event.preventDefault(); report('failed', '그래픽 연결이 끊어졌습니다. 다시 보기를 눌러주세요.'); };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.domElement.setAttribute('aria-label', `${asset.name} 3D 미리보기. 드래그로 회전하고 휠로 확대합니다.`);
      renderer.domElement.addEventListener('webglcontextlost', contextLost);
      host.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
      camera.position.set(3, 2, 3);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 0.3; controls.maxDistance = 12;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x656575, 2.4));
      const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(4, 6, 3); scene.add(light);
      const fill = new THREE.DirectionalLight(0xffffff, 1); fill.position.set(-3, 2, -4); scene.add(fill);
      const grid = new THREE.GridHelper(6, 12, 0xb9b7b1, 0xd5d2ca); grid.position.y = -1; scene.add(grid);
      const resize = () => {
        const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize); observer.observe(host); resize();
      const animate = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); frame = requestAnimationFrame(animate); };
      animate();
      createCompressedGltfLoader().load(asset.url, gltf => {
        if (!alive) { disposeObject(gltf.scene); return; }
        model = gltf.scene;
        let meshCount = 0; model.traverse(object => { if (object.isMesh) meshCount++; });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, size.z);
        if (!meshCount || !Number.isFinite(extent) || extent <= 0) { report('failed', '표시할 3D 형상을 찾지 못했습니다.'); return; }
        const center = box.getCenter(new THREE.Vector3());
        const wrapper = new THREE.Group(); wrapper.add(model);
        wrapper.scale.setScalar(2 / extent); wrapper.position.copy(center.multiplyScalar(-2 / extent));
        scene.add(wrapper); renderer.render(scene, camera);
        report('loaded', `실제 GLB 표시 완료 · 메시 ${meshCount}개. 모양의 적합성은 사람이 판정합니다.`);
      }, undefined, () => report('failed', '3D 파일을 읽지 못했습니다. 파일·압축 형식·그래픽 환경을 확인해주세요.'));
    } catch (error) { report('failed', `3D 표시 실패: ${error.message}`); }
    return () => {
      alive = false; cancelAnimationFrame(frame); observer?.disconnect(); controls?.dispose();
      renderer?.domElement.removeEventListener('webglcontextlost', contextLost);
      disposeObject(scene); if (model && !model.parent) disposeObject(model);
      renderer?.dispose(); renderer?.forceContextLoss(); host.replaceChildren();
    };
  }, [asset.id, asset.url, asset.name, asset.sha256]);
  return <div className="viewer"><div className="viewer-canvas" ref={mount} /><div className={`viewer-caption ${state.status === 'failed' ? 'error' : ''}`} role="status">{state.message}</div><small>파일 원형 보기 · 드래그 회전 / 휠 확대 · 게임의 툰 재질·크기·배치는 공간에서 따로 확인합니다.</small></div>;
}
