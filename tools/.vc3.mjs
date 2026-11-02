import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const lin2s=v=>v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055;
for (const f of process.argv.slice(2)) { const doc = await io.read(f);
  for (const node of doc.getRoot().listNodes()) { const nm=node.getName(); if (!/뒤주|찬장|찬탁|반닫이|궤/.test(nm)) continue; const sub=[]; node.traverse(n=>{const m=n.getMesh(); if(m) sub.push(m)});
    for (const m of sub) for (const p of m.listPrimitives()) { const c=p.getAttribute('COLOR_0'); const mat=p.getMaterial(); let s=[0,0,0],n=0,e=[]; if(c) for(let i=0;i<c.getCount();i++){c.getElement(i,e);s[0]+=e[0];s[1]+=e[1];s[2]+=e[2];n++}
      console.log(f.split('/').pop(), nm, 'vcol', n? s.map(v=>lin2s(v/n).toFixed(2)).join(','):'none', 'mat', mat&&mat.getName(), mat&&mat.getBaseColorFactor().map(v=>v.toFixed(2)).join(','), 'metal', mat&&mat.getMetallicFactor(), 'tex', !!(mat&&mat.getBaseColorTexture())); } } }
