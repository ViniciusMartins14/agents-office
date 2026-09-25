import { createOffice3D } from '/office3d.js';
const names=['Alex','Luna','Theo','Nina','Bob','Leo'];
const ids=['manager','architect','frontend','backend','qa','delivery'];
const scene=createOffice3D({canvas:document.querySelector('canvas'),overlay:document.querySelector('#office-overlay')});
function preview(mode) {
 scene.update({employees:names.map((name,i)=>({id:ids[i],name,color:['#e7bd70','#b78add','#78b8db','#6ac5aa','#de9eae','#8ba9d0'][i],statusKey:mode==='meeting'?'available':mode,statusLabel:mode==='running'?'Digitando':mode==='resting'?'Descansando':'Disponível'})),meeting:mode==='meeting'?{participants:ids.slice(0,3),active:true}:null});
 document.title='Revisão: '+mode;
}
document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>preview(button.dataset.state)));
preview('running');
