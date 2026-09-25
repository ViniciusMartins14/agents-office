"""Cria o projeto editável. Execute com Blender --background --python este arquivo."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'blender'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection': bpy.data.collections.remove(collection)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 70
scene.render.image_settings.file_format = 'PNG'
scene.world.color = (0.18, 0.18, 0.18)
scene.render.fps = 30
scene.frame_start, scene.frame_end = 1, 120

def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*color, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .7
    return m
M = {k: material(k,c) for k,c in {
 'Piso':(.36,.43,.28), 'Madeira clara':(.78,.67,.48), 'Divisórias':(.055,.16,.09),
 'Metal':(.08,.10,.12), 'Tela':(.025,.09,.12), 'Teclado':(.7,.7,.66),
 'Cadeira':(.18,.24,.29), 'Folhas':(.14,.35,.08), 'Vaso':(.55,.27,.13)
}.items()}
def collection(name):
    c=bpy.data.collections.new(name); scene.collection.children.link(c); return c
ENV=collection('01 | Ambiente editável')
DESKS=collection('02 | Mesas e cadeiras')
PEOPLE=collection('03 | Personagens de referência e clipes originais')
LIGHTS=collection('04 | Câmeras e iluminação')
def move(obj,c):
    for old in list(obj.users_collection): old.objects.unlink(obj)
    c.objects.link(obj)
def box(name,loc,size,mat,c=ENV,rz=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o=bpy.context.object; o.name=name; o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.rotation_euler.z=rz; o.data.materials.append(M[mat]); move(o,c)
    bevel=o.modifiers.new('Cantos arredondados','BEVEL'); bevel.width=.035; bevel.segments=3
    o.modifiers.new('Normais','WEIGHTED_NORMAL')
    return o
box('Piso do escritório',(0,0,-.14),(20,18,.28),'Piso')
def desk(index,x,y,angle):
    def p(a,b,z):
        return (x+a*math.cos(angle)-b*math.sin(angle), y+a*math.sin(angle)+b*math.cos(angle),z)
    def b(name,a,b,z,sx,sy,sz,mat):
        return box(f'{index+1:02d} | {name}',p(a,b,z),(sx,sy,sz),mat,DESKS,angle)
    b('Tampo',0,0,.78,2.9,1.3,.1,'Madeira clara')
    for xx in [-1.22,1.22]:
        for yy in [-.45,.45]: b('Pé da mesa',xx,yy,.37,.08,.08,.74,'Metal')
    b('Divisória traseira',0,.98,.65,3.7,.12,1.3,'Divisórias')
    for xx in [-1.8,1.8]: b('Divisória lateral',xx,.2,.65,.12,1.65,1.3,'Divisórias')
    b('Monitor',-.15,.30,1.20,1.0,.09,.65,'Metal')
    b('Tela do monitor',-.15,.247,1.20,.9,.014,.54,'Tela')
    b('Suporte monitor',-.15,.30,.9,.08,.12,.3,'Metal')
    b('Teclado',-.1,-.30,.86,.66,.23,.025,'Teclado')
    b('Assento',0,-1.14,.51,.65,.6,.12,'Cadeira')
    b('Encosto',0,-1.42,.86,.66,.1,.64,'Cadeira')
    b('Base cadeira',0,-1.14,.24,.08,.08,.48,'Metal')
    b('Pés cadeira',0,-1.14,.06,.8,.1,.08,'Metal')
    b('Pés cadeira',0,-1.14,.06,.1,.8,.08,'Metal')
    return p(0,-1.9,0)
positions=[]
for i in range(6):
    x=[-4.7,0,4.7][i%3]; y=3.5 if i<3 else -3.5; a=0 if i<3 else math.pi
    positions.append((desk(i,x,y,a),a))
bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.85,depth=.10,location=(3.2,6.6,.73))
o=bpy.context.object; o.name='Mesa de reunião | tampo';o.data.materials.append(M['Madeira clara']);move(o,ENV)
box('Mesa de reunião | pé',(3.2,6.6,.35),(.22,.22,.7),'Metal')
for i in range(6):
    a=math.radians(30)+i*math.tau/6;x=3.2+math.sin(a)*1.72;y=6.6+math.cos(a)*1.72
    box('Reunião | assento',(x,y,.51),(.65,.6,.12),'Cadeira',ENV,-a)
    box('Reunião | base',(x,y,.25),(.1,.1,.5),'Metal')
box('Sofá',(-5.4,-6.3,.42),(3,1.1,.5),'Cadeira')
box('Sofá | encosto',(-5.4,-6.75,.85),(3,.24,.85),'Cadeira')
for x,y in [(-8.9,6.8),(8.9,-1.4),(-8.9,-1.2),(-1.4,7.4),(-1.9,-7.6)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.32,depth=.5,location=(x,y,.25))
    o=bpy.context.object;o.name='Vaso';o.data.materials.append(M['Vaso']);move(o,ENV)
    for dx,dy,z in [(0,0,1),(.18,.1,1.28),(-.2,-.1,1.4)]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.4,location=(x+dx,y+dy,z))
        o=bpy.context.object;o.name='Folhagem';o.scale=(1,1,.55);o.data.materials.append(M['Folhas']);move(o,ENV)
names=['Alex','Luna','Theo','Nina','Bob','Leo']
for i,(loc,angle) in enumerate(positions):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'dist'/'assets'/'kenney'/f'character-{chr(97+i)}.glb'))
    imported=set(bpy.data.objects)-before
    controller=bpy.data.objects.new(names[i]+' | posicionamento',None);PEOPLE.objects.link(controller)
    controller.location=loc;controller.rotation_euler.z=angle;controller.scale=(.72,)*3
    for obj in imported:
        move(obj,PEOPLE)
        if obj.parent not in imported: obj.parent=controller
    controller['origem']='Kenney Blocky Characters 2.0, CC0'
    controller['observação']='Referência original: substituir por personagem articulado após aprovação visual.'
    # Preserva todas as actions/NLA importadas, evitando sobrepor clipes diferentes.
    for obj in imported:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks: track.mute=True
for action in bpy.data.actions: action.use_fake_user=True
bpy.ops.object.light_add(type='AREA',location=(0,-2,12))
light=bpy.context.object;light.name='Luz principal';light.data.energy=2200;light.data.shape='DISK';light.data.size=10;move(light,LIGHTS)
bpy.ops.object.camera_add(location=(19,-24,24))
cam=bpy.context.object;cam.name='Câmera | escritório';cam.rotation_euler=(Vector((0,0,.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=27;scene.camera=cam;move(cam,LIGHTS)
text=bpy.data.texts.new('LEIA-ME | Projeto do escritório')
text.write('Projeto editável do Dev Office.\nAmbiente reconstruído nas proporções do aplicativo; personagens e clipes Kenney importados como referência, CC0.\nEste arquivo inicia a migração; não significa que as animações foram corrigidas.\nPróximo passo: aprovar um personagem base e ajustar digitação, levantar, caminhar, sentar e dormir.\nOs clipes originais foram preservados como Actions, com NLA silenciada para não sobrepor movimentos.\nCoordenadas: Z para cima no Blender, Y para cima no aplicativo via exportação glTF.\n')
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.object.select_all(action='DESELECT')
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'dev-office.blend'))
scene.render.filepath=str(OUT/'office-preview.png')
bpy.ops.render.render(write_still=True)
print('OFFICE_BLEND_READY',OUT/'dev-office.blend')
