"""Monta uma nova versão completa sem sobrescrever dev-office.blend."""
import bpy, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'blender/dev-office.blend'))
scene=bpy.context.scene
for collection in list(bpy.data.collections):
 if collection.name.startswith('03 |'):
  for obj in list(collection.objects):bpy.data.objects.remove(obj,do_unlink=True)
  bpy.data.collections.remove(collection)
people=bpy.data.collections.new('03 | Equipe articulada — Blender');scene.collection.children.link(people)
colors=[(.8,.57,.24),(.49,.34,.7),(.2,.5,.75),(.2,.63,.52),(.8,.35,.51),(.4,.55,.68)]
for i,name in enumerate(['Alex','Luna','Theo','Nina','Bob','Leo']):
 before=set(bpy.data.objects)
 bpy.ops.import_scene.gltf(filepath=str(ROOT/'dist/assets/blender/employee.glb'))
 imported=set(bpy.data.objects)-before
 helpers={bone.custom_shape for obj in imported if obj.type=='ARMATURE' for bone in obj.pose.bones if bone.custom_shape}
 for helper in helpers:helper.hide_render=True
 imported-=helpers
 control=bpy.data.objects.new(name+' | posição',None);people.objects.link(control)
 control.location=([-4.7,0,4.7][i%3], 3.5-1.02 if i<3 else -3.5+1.02,0)
 control.rotation_euler.z=0 if i<3 else math.pi
 for obj in imported:
  for old in list(obj.users_collection):old.objects.unlink(obj)
  people.objects.link(obj)
  if obj.parent not in imported:obj.parent=control
  if obj.type=='MESH':
   for slot in obj.material_slots:
    if slot.material and slot.material.name.startswith('Shirt'):
     slot.material=slot.material.copy();m=slot.material;m.name=name+' | camisa';m.diffuse_color=(*colors[i],1)
     m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*colors[i],1)
  if obj.animation_data:
   obj.animation_data.action=None
   for track in obj.animation_data.nla_tracks:
    track.mute=track.name not in ['type']
# Reposiciona teclado para alcance do novo personagem e mantém proporções do modelo.
for obj in bpy.data.objects:
 if 'Teclado' in obj.name:
  row=int(obj.name[:2])-1
  obj.location.y=(3.5-.46) if row<3 else (-3.5+.46)
scene.frame_start=1;scene.frame_end=61;scene.frame_set(16)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/dev-office-animated.blend'))
scene.render.filepath=str(ROOT/'blender/office-animated-preview.png')
bpy.ops.render.render(write_still=True)
print('OFFICE_ANIMATED_READY')
