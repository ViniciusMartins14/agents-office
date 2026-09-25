import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { officeMotion } from '../dist/office-motion.js';
import { GLTFLoader } from '../dist/vendor/GLTFLoader.js';
import { AnimationMixer, Vector3 } from '../dist/vendor/three.module.min.js';

test('Trabalho, descanso e movimento reduzido permanecem na cadeira em toda a rotina', () => {
  for (let index=0;index<6;index++) for (let time=0;time<240;time+=.1) {
    for (const [status,clip] of [['running','type'],['resting','sleep']]) {
      const p=officeMotion(time,index,status);
      assert.deepEqual([p.x,p.z,p.yaw,p.clip],[0,1.02,0,clip]);
    }
    assert.equal(officeMotion(time,index,'available',true).clip,'sit');
  }
});
test('Passeio contínuo, contornando a cadeira, com somente um funcionário fora por vez', () => {
  for (let time=0;time<120;time+=.02) {
    const poses=Array.from({length:6},(_,i)=>officeMotion(time,i,'available'));
    assert.ok(poses.filter(p=>p.clip!=='sit').length<=1);
    for (let i=0;i<6;i++) {
      const p=poses[i], next=officeMotion(time+.001,i,'available');
      assert.ok(Math.hypot(p.x-next.x,p.z-next.z)<.002,`salto em ${time}`);
      assert.ok(p.z<=1.021 || Math.abs(p.x)>=.94,'trajeto não atravessa o encosto');
    }
  }
});
test('GLB exportado contém esqueleto, clipes completos e mãos/tornozelos em posições válidas', async () => {
  const bytes=await readFile(new URL('../dist/assets/blender/employee.glb',import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  assert.deepEqual(gltf.animations.map(a=>a.name).sort(),['idle','sit','type','sleep','walk','stand-up','sit-down'].sort());
  assert.ok(gltf.scene.getObjectByName('EmployeeRig'));
  for (const clip of gltf.animations) {
    const mixer=new AnimationMixer(gltf.scene);mixer.clipAction(clip).play();
    for(let step=0;step<12;step++) {
      mixer.setTime(clip.duration*step/12);gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(obj=>assert.ok(obj.matrixWorld.elements.every(Number.isFinite),clip.name));
      if (clip.name==='type') {
        for (const name of ['handL','handR']) {
          const p=gltf.scene.getObjectByName(name).getWorldPosition(new Vector3());
          assert.ok(p.y>.83 && p.y<.9,`mão ${name} deve estar na altura do teclado: ${p.y}`);
        }
      }
      if (clip.name==='sit' || clip.name==='type') {
        const p=gltf.scene.getObjectByName('footL').getWorldPosition(new Vector3());
        assert.ok(p.y>.09 && p.y<.14,'pé próximo ao piso');
      }
    }
    mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
  }
});
