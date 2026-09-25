"""Personagem articulado nativo, clipes completos e exportação GLB reproduzível.
Não altera dev-office.blend: gera employee-studio.blend e assets/blender/employee.glb.
"""
import bpy, math, json
from mathutils import Vector, Matrix
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist/assets/blender'; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene; scene.render.fps=30
scene.unit_settings.system='METRIC'

def mat(name,color):
 m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.68
 return m
skin=mat('Skin',(.66,.39,.25));shirt=mat('Shirt',(.12,.34,.42));pants=mat('Trousers',(.06,.09,.14));shoes=mat('Shoes',(.055,.045,.04));hair=mat('Hair',(.055,.031,.023));white=mat('Eyes',(.93,.9,.82));dark=mat('Pupils',(.02,.024,.03));trim=mat('Soles',(.68,.66,.58))
# Frente +Y, vertical +Z; exportador converte para frente -Z e vertical +Y.
rest={'pelvis':((0,0,.83),(0,0,.98),None),'chest':((0,0,.83),(0,0,1.26),'pelvis'),'head':((0,0,1.29),(0,0,1.57),'chest')}
for side,x in [('L',.14),('R',-.14)]:
 rest['thigh'+side]=((x,0,.83),(x,0,.43),'pelvis')
 rest['shin'+side]=((x,0,.43),(x,0,.105),'thigh'+side)
 rest['foot'+side]=((x,0,.105),(x,.16,.105),'shin'+side)
 ax=.285 if side=='L' else -.285
 rest['upper'+side]=((ax,0,1.21),(ax,0,.93),'chest')
 rest['fore'+side]=((ax,0,.93),(ax,.01,.665),'upper'+side)
 rest['hand'+side]=((ax,.01,.665),(ax,.01,.565),'fore'+side)
arm=bpy.data.armatures.new('Office Skeleton'); rig=bpy.data.objects.new('EmployeeRig',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,(a,b,parent) in rest.items():
 bone=arm.edit_bones.new(name);bone.head=a;bone.tail=b
 if parent:bone.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
meshes=[]
def ellipsoid(name,loc,scale,material,bone):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=loc)
 ob=bpy.context.object;ob.name=name;ob.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for p in ob.data.polygons:p.use_smooth=True
 ob.data.materials.append(material)
 vg=ob.vertex_groups.new(name=bone);vg.add(list(range(len(ob.data.vertices))),1,'REPLACE')
 mod=ob.modifiers.new('Skeleton','ARMATURE');mod.object=rig
 ob.parent=rig;meshes.append(ob);return ob
ellipsoid('Pelvis',(0,0,.82),(.225,.135,.15),pants,'pelvis')
ellipsoid('Shirt',(0,0,1.04),(.255,.145,.255),shirt,'chest')
ellipsoid('Neck',(0,0,1.29),(.077,.075,.105),skin,'head')
ellipsoid('Head',(0,0,1.49),(.183,.153,.23),skin,'head')
ellipsoid('Hair cap',(0,-.012,1.625),(.183,.151,.12),hair,'head')
ellipsoid('Hair back',(0,-.106,1.52),(.17,.064,.17),hair,'head')
ellipsoid('Hair fringe',(-.04,.10,1.646),(.145,.057,.06),hair,'head')
for x in [-.18,.18]:ellipsoid('Ear',(x,0,1.49),(.035,.047,.068),skin,'head')
for x in [-.066,.066]:
 ellipsoid('Eye',(x,.143,1.535),(.036,.019,.046),white,'head')
 ellipsoid('Pupil',(x,.159,1.533),(.017,.010,.025),dark,'head')
 ellipsoid('Brow',(x,.145,1.59),(.042,.015,.009),hair,'head')
ellipsoid('Nose',(0,.166,1.475),(.033,.035,.04),skin,'head')
ellipsoid('Smile',(0,.146,1.41),(.047,.011,.009),dark,'head')
for side,x in [('L',.14),('R',-.14)]:
 ax=.285 if side=='L' else -.285
 ellipsoid('Thigh '+side,(x,0,.64),(.108,.11,.235),pants,'thigh'+side)
 ellipsoid('Knee '+side,(x,0,.43),(.101,.105,.105),pants,'shin'+side)
 ellipsoid('Shin '+side,(x,0,.27),(.086,.09,.19),pants,'shin'+side)
 ellipsoid('Shoe '+side,(x,.05,.074),(.102,.178,.074),shoes,'foot'+side)
 ellipsoid('Sole '+side,(x,.05,.024),(.105,.18,.022),trim,'foot'+side)
 ellipsoid('Sleeve '+side,(ax,0,1.105),(.094,.105,.165),shirt,'upper'+side)
 ellipsoid('Elbow '+side,(ax,0,.93),(.074,.077,.078),skin,'fore'+side)
 ellipsoid('Forearm '+side,(ax,.005,.805),(.063,.067,.16),skin,'fore'+side)
 ellipsoid('Hand '+side,(ax,.012,.619),(.065,.037,.072),skin,'hand'+side)
# Keyframes are baked on a shared skeleton, so joints stay connected in all poses.
def lerp(a,b,t):return Vector(a).lerp(Vector(b),t)
def seated(phase=0,typing=False,sleeping=False):
 hip=Vector((0,0,.59)); shoulder=Vector((0,.035,1.02));neck=Vector((0,.04,1.05))
 if sleeping:shoulder=Vector((0,.36,.99));neck=Vector((0,.43,1.015))
 joints={'pelvis':(hip,hip+Vector((0,0,.15))), 'chest':(hip,shoulder),'head':(neck,neck+Vector((0,.28,0)) if sleeping else neck+Vector((0,0,.28)))}
 for side,x in [('L',.14),('R',-.14)]:
  h=hip+Vector((x,0,0));k=Vector((x,.39,.59));ank=Vector((x,.42,.115))
  joints['thigh'+side]=(h,k);joints['shin'+side]=(k,ank);joints['foot'+side]=(ank,ank+Vector((0,.16,0)))
  ax=.26 if side=='L' else -.26
  s=shoulder+Vector((ax,0,-.05))
  if typing or sleeping:
   elbow=Vector((ax,.28,.83 if typing else .80))
   dy=.012*math.sin(phase*4+(0 if side=='L' else math.pi)) if typing else 0
   wrist=Vector((ax*.7,.56,.858+dy));tip=wrist+Vector((0,.085,-.006))
  else:
   elbow=Vector((ax,.07,.70));wrist=Vector((ax*.7,.29,.68));tip=wrist+Vector((0,.09,0))
  joints['upper'+side]=(s,elbow);joints['fore'+side]=(elbow,wrist);joints['hand'+side]=(wrist,tip)
 return joints

def standing(phase=0,walk=False):
 joints={name:(Vector(a),Vector(b)) for name,(a,b,_) in rest.items()}
 breathe=.004*math.sin(phase)
 if not walk:
  for name in ['chest','head','upperL','upperR','foreL','foreR','handL','handR']:
   a,b=joints[name];joints[name]=(a+Vector((0,0,breathe)),b+Vector((0,0,breathe)))
  return joints
 bob=.012*(1-math.cos(phase*2))
 for name in joints:
  a,b=joints[name];joints[name]=(a+Vector((0,0,bob)),b+Vector((0,0,bob)))
 for side,x,offset in [('L',.14,0),('R',-.14,math.pi)]:
  q=phase+offset;h=Vector((x,0,.83+bob))
  angle=.33*math.sin(q);k=h+Vector((0,.4*math.sin(angle),-.4*math.cos(angle)))
  bend=max(0,-math.sin(q))*.5;ank=k+Vector((0,.325*math.sin(angle-bend),-.325*math.cos(angle-bend)))
  joints['thigh'+side]=(h,k);joints['shin'+side]=(k,ank);joints['foot'+side]=(ank,ank+Vector((0,.16,0)))
  ax=.285 if side=='L' else -.285;s=Vector((ax,0,1.21+bob));swing=-angle*.65
  e=s+Vector((0,.28*math.sin(swing),-.28*math.cos(swing)));w=e+Vector((0,.265*math.sin(swing+.14),-.265*math.cos(swing+.14)))
  joints['upper'+side]=(s,e);joints['fore'+side]=(e,w);joints['hand'+side]=(w,w+Vector((0,0,-.1)))
 return joints

def apply_pose(joints,frame):
 for name,(rh,rt,parent) in rest.items():
  a,b=joints[name];restbone=arm.bones[name]
  align=(Vector(rt)-Vector(rh)).rotation_difference(b-a)
  rot=align@restbone.matrix_local.to_quaternion()
  rig.pose.bones[name].matrix=Matrix.LocRotScale(a,rot,Vector((1,1,1)))
  bpy.context.view_layer.update()
  p=rig.pose.bones[name]
  p.keyframe_insert(data_path='location',frame=frame)
  p.keyframe_insert(data_path='rotation_quaternion',frame=frame)
  p.keyframe_insert(data_path='scale',frame=frame)
for p in rig.pose.bones:p.rotation_mode='QUATERNION'
clips=[]
for name,length in [('idle',60),('sit',60),('type',60),('sleep',90),('walk',30),('stand-up',36),('sit-down',36)]:
 rig.animation_data_create();rig.animation_data.action=None
 for f in range(1,length+2,3):
  t=(f-1)/length;phase=t*math.tau
  if name in ['idle','walk']:j=standing(phase,name=='walk')
  elif name in ['sit','type','sleep']:j=seated(phase,name=='type',name=='sleep')
  else:
   blend=t*t*(3-2*t);blend=blend if name=='stand-up' else 1-blend
   a=seated();b=standing();j={n:(lerp(a[n][0],b[n][0],blend),lerp(a[n][1],b[n][1],blend)) for n in rest}
  apply_pose(j,f)
 action=rig.animation_data.action;action.name=name;action.use_fake_user=True;clips.append(action)
 # One complete pose per clip: no simultaneously competing upper-body actions.
 rig.animation_data.action=None
 track=rig.animation_data.nla_tracks.new();track.name=name
 strip=track.strips.new(name,1,action);track.mute=True
rig.animation_data.action=None
for track in rig.animation_data.nla_tracks:track.mute=False
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for ob in meshes:ob.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'employee.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_frame_range=False)
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=next(a for a in clips if a.name=='type')
# Studio with a correctly sized desk and chair for checking hand/foot contact.
def cube(name,loc,size,color):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);ob=bpy.context.object;ob.name=name;ob.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 ob.data.materials.append(color);be=ob.modifiers.new('Bevel','BEVEL');be.width=.025;be.segments=3;ob.modifiers.new('Normals','WEIGHTED_NORMAL');return ob
wood=mat('Studio desk',(.65,.51,.34));metal=mat('Studio metal',(.1,.13,.15));floor=mat('Studio floor',(.20,.24,.21))
cube('Desk surface',(0,.94,.785),(2.3,1.0,.08),wood)
cube('Keyboard',(0,.57,.84),(.5,.19,.025),metal)
cube('Monitor',(0,1.15,1.14),(.76,.07,.5),metal)
cube('Monitor base',(0,1.15,.92),(.06,.1,.24),metal)
for x in [-1,1]:
 for y in [.55,1.35]:cube('Desk leg',(x,y,.37),(.065,.065,.74),metal)
cube('Chair seat',(0,-.03,.49),(.6,.57,.12),metal)
cube('Chair back',(0,-.3,.83),(.6,.09,.58),metal)
cube('Chair base',(0,-.03,.23),(.08,.08,.46),metal)
cube('Floor',(0,.6,-.03),(5,5,.05),floor)
bpy.ops.object.camera_add(location=(3.4,4.2,2.8));cam=bpy.context.object;cam.name='Studio Camera';cam.rotation_euler=(Vector((0,.45,.83))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=3.5;scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(1,2,5));bpy.context.object.data.energy=450;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=4
scene.world.color=(.25,.25,.25);scene.render.engine='CYCLES';scene.cycles.samples=32;scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=75
scene.frame_start=1;scene.frame_end=61;scene.frame_set(16)
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/employee-studio.blend'))
for clip in ['type','sleep','idle','walk']:
 rig.animation_data.action=next(a for a in clips if a.name==clip);scene.frame_set(16)
 scene.render.filepath=str(ROOT/'blender'/f'employee-{clip}.png');bpy.ops.render.render(write_still=True)
print('EMPLOYEE_READY',str(OUT/'employee.glb'))
