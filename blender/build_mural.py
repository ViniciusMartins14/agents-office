"""Constrói o mural de tarefas do escritório e exporta o GLB.

    blender --background --python blender/build_mural.py

Sai em dist/assets/blender/mural.glb e deixa o projeto editável em blender/mural.blend.
O mural é um quadro de pé, com moldura de madeira e cartões coloridos presos — os cartões
existem só para dar leitura à distância: a lista de verdade abre ao clicar no mural.
As cores acompanham a paleta da cena em dist/office3d.js.
"""
import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAIDA = ROOT / 'dist/assets/blender'
SAIDA.mkdir(parents=True, exist_ok=True)

# Paleta espelhada de dist/office3d.js (C.wood, C.deskTop, C.paper…), em linear aproximado.
CORES = {
    'madeira': (0.32, 0.20, 0.11),
    'madeira_escura': (0.21, 0.13, 0.07),
    'painel': (0.88, 0.84, 0.76),
    'cartao_feito': (0.36, 0.72, 0.48),   # concluída
    'cartao_agora': (0.95, 0.76, 0.35),   # em execução
    'cartao_fila': (0.55, 0.64, 0.74),    # na fila
    'cartao_atencao': (0.87, 0.45, 0.42),  # precisa de atenção
    'metal': (0.18, 0.20, 0.23),
}

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for bloco in list(bpy.data.collections):
    if bloco.name != 'Collection':
        bpy.data.collections.remove(bloco)

materiais = {}


def material(nome):
    if nome in materiais:
        return materiais[nome]
    m = bpy.data.materials.new(f'Mural | {nome}')
    m.use_nodes = True
    base = m.node_tree.nodes['Principled BSDF']
    base.inputs['Base Color'].default_value = (*CORES[nome], 1)
    base.inputs['Roughness'].default_value = 0.62
    base.inputs['Metallic'].default_value = 0.35 if nome == 'metal' else 0.0
    m.diffuse_color = (*CORES[nome], 1)
    materiais[nome] = m
    return m


def caixa(nome, local, tamanho, cor):
    bpy.ops.mesh.primitive_cube_add(size=1, location=local)
    obj = bpy.context.active_object
    obj.name = nome
    obj.scale = tamanho
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(material(cor))
    return obj


# --- estrutura ---------------------------------------------------------------
# Origem no chão, no centro do mural: facilita posicionar na cena sem cálculo.
ALTURA_PAINEL = 1.28
BASE = 0.62  # altura em que o painel começa

partes = [
    caixa('Mural | pé esquerdo', (-0.92, 0, BASE / 2), (0.09, 0.09, BASE), 'madeira_escura'),
    caixa('Mural | pé direito', (0.92, 0, BASE / 2), (0.09, 0.09, BASE), 'madeira_escura'),
    caixa('Mural | travessa', (0, 0, BASE - 0.06), (1.95, 0.07, 0.07), 'madeira_escura'),
    caixa('Mural | painel', (0, 0, BASE + ALTURA_PAINEL / 2), (1.86, 0.05, ALTURA_PAINEL), 'painel'),
]

# moldura: quatro sarrafos em volta do painel
moldura = 0.07
partes += [
    caixa('Mural | moldura topo', (0, 0, BASE + ALTURA_PAINEL), (2.0, 0.09, moldura), 'madeira'),
    caixa('Mural | moldura base', (0, 0, BASE), (2.0, 0.09, moldura), 'madeira'),
    caixa('Mural | moldura esquerda', (-0.965, 0, BASE + ALTURA_PAINEL / 2), (moldura, 0.09, ALTURA_PAINEL), 'madeira'),
    caixa('Mural | moldura direita', (0.965, 0, BASE + ALTURA_PAINEL / 2), (moldura, 0.09, ALTURA_PAINEL), 'madeira'),
]

# --- cartões -----------------------------------------------------------------
# Três colunas (feito · agora · fila) com um cartão de atenção solto, como num quadro real.
COLUNAS = [(-0.6, 'cartao_feito', 4), (0.0, 'cartao_agora', 3), (0.6, 'cartao_fila', 3)]
for x, cor, quantidade in COLUNAS:
    for i in range(quantidade):
        z = BASE + ALTURA_PAINEL - 0.3 - i * 0.26
        partes.append(caixa(f'Mural | cartão {cor} {i + 1}', (x, -0.035, z), (0.42, 0.012, 0.18), cor))
partes.append(caixa('Mural | cartão atenção', (0.6, -0.035, BASE + 0.22), (0.42, 0.012, 0.18), 'cartao_atencao'))

# faixa de título no topo do painel
partes.append(caixa('Mural | faixa', (0, -0.035, BASE + ALTURA_PAINEL - 0.08), (1.7, 0.012, 0.06), 'metal'))

colecao = bpy.data.collections.new('Mural de tarefas')
bpy.context.scene.collection.children.link(colecao)
for obj in partes:
    for antiga in list(obj.users_collection):
        antiga.objects.unlink(obj)
    colecao.objects.link(obj)

bpy.ops.object.select_all(action='DESELECT')
for obj in partes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = partes[0]

bpy.ops.export_scene.gltf(
    filepath=str(SAIDA / 'mural.glb'),
    export_format='GLB',
    use_selection=True,
    export_animations=False,
)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'blender/mural.blend'))
print(f'[OK] mural.glb exportado com {len(partes)} peças')
