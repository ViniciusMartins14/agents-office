// Rotina determinística: a cadeira é o ponto de partida e de chegada.
// Somente uma janela de passeio por funcionário a cada dois minutos.
export function officeMotion(time, index, status, reduced = false) {
  const seat = { x: 0, z: 1.02, yaw: 0, clip: status === 'running' ? 'type' : status === 'resting' ? 'sleep' : 'sit' };
  if (status !== 'available' || reduced) return seat;
  const t = ((time - index * 20) % 120 + 120) % 120;
  const side = index % 2 ? 1 : -1;
  const at = (x,z,yaw,clip,clipTime) => ({ x: x * side, z, yaw: yaw * side, clip, clipTime });
  if (t < 3 || t >= 15) return seat;
  if (t < 4.2) return at(0,1.02,0,'stand-up',t-3);
  // Contorna a cadeira pela lateral, antes de entrar no corredor.
  if (t < 5.8) return at((t-4.2)/1.6*.95,1.02,-Math.PI/2,'walk');
  if (t < 7.4) return at(.95,1.02+(t-5.8)/1.6*.95,Math.PI,'walk');
  if (t < 9.4) return at(.95,1.97,Math.PI,'idle');
  if (t < 11) return at(.95,1.97-(t-9.4)/1.6*.95,0,'walk');
  if (t < 12.6) return at(.95-(t-11)/1.6*.95,1.02,Math.PI/2,'walk');
  if (t < 13.8) return at(0,1.02,0,'idle');
  return at(0,1.02,0,'sit-down',t-13.8);
}
