/* Abertura: três garrafas 3D em preto e branco (Three.js r128) */
(function(){
  const cena = document.getElementById("cena");
  if(!cena) return;
  const semWebGL = () => cena.classList.add("sem-3d");
  if(!window.THREE){ semWebGL(); return; }

  let renderer;
  try{
    renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  }catch(e){ semWebGL(); return; }

  const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  cena.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  /* ambiente de estúdio: faixas brancas que viram os reflexos verticais no vidro */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const estudio = new THREE.Scene();
  estudio.background = new THREE.Color(0x000000);
  const faixa = (w, h, x, y, z, ry, brilho) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({color:new THREE.Color(brilho, brilho, brilho), side:THREE.DoubleSide}));
    m.position.set(x, y, z); m.rotation.y = ry; estudio.add(m);
  };
  faixa(.45, 16, -5, 2, 4, Math.PI/3, 5);
  faixa(.25, 16, 5.5, 2, 2.5, -Math.PI/2.5, 3.5);
  faixa(.18, 16, -1.5, 2, 6, 0, 2.2);
  faixa(.3, 14, 3, 2, -7, 0, 2.5);
  scene.environment = pmrem.fromScene(estudio, 0.01).texture;

  scene.add(new THREE.AmbientLight(0xffffff, 0.05));
  const chave = new THREE.DirectionalLight(0xffffff, .9); chave.position.set(-4, 6, 5); scene.add(chave);
  const contra = new THREE.DirectionalLight(0xffffff, 2.2); contra.position.set(4, 5, -6); scene.add(contra);

  /* perfis das garrafas (raio, altura) girados em torno do eixo */
  const PERFIS = {
    bordeaux:[[0,0],[.92,0],[.98,.04],[1,.14],[1,2.75],[.98,2.9],[.88,3.08],[.62,3.27],[.43,3.44],[.37,3.6],[.36,4.04],[.4,4.07],[.4,4.2],[0,4.2]],
    borgonha:[[0,0],[.98,0],[1.05,.1],[1.06,1.95],[1.01,2.35],[.84,2.8],[.57,3.22],[.41,3.52],[.37,4.04],[.41,4.07],[.41,4.2],[0,4.2]],
    espumante:[[0,0],[1,0],[1.08,.12],[1.08,2.25],[1.01,2.7],[.77,3.2],[.52,3.66],[.43,4.28],[.47,4.34],[.45,4.48],[0,4.48]],
  };
  const FINO = .64; /* afina o raio: garrafa real tem ~1:4 de largura por altura */
  const vidro = new THREE.MeshPhysicalMaterial({color:0x050505, metalness:0, roughness:.18, clearcoat:1, clearcoatRoughness:.02, envMapIntensity:1.2});

  function rotulo(titulo, linha1, linha2){
    const c = document.createElement("canvas"); c.width = 1024; c.height = 512;
    const g = c.getContext("2d");
    g.fillStyle = "#ebe8e3"; g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 3; g.strokeRect(60, 40, 904, 432);
    g.lineWidth = 1.2; g.strokeRect(74, 54, 876, 404);
    g.fillStyle = "#111"; g.textAlign = "center";
    g.font = '500 112px "Bodoni Moda", Didot, Georgia, serif';
    g.fillText(titulo, 512, 250);
    g.font = '500 30px "Hanken Grotesk", sans-serif';
    g.fillText(linha1, 512, 318);
    g.font = 'italic 400 40px "Bodoni Moda", Georgia, serif';
    g.fillText(linha2, 512, 400);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    return t;
  }

  function sombra(){
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, "rgba(0,0,0,.75)"); r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}));
    m.rotation.x = -Math.PI/2; m.position.y = .01;
    return m;
  }

  function garrafa(perfil, textos, capsulaClara){
    const pts = PERFIS[perfil].map(([r, y]) => new THREE.Vector2(r*FINO, y));
    const corpo = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), vidro);
    const raio = PERFIS[perfil][4][0]*FINO;
    const arco = 3.1;
    const etiqueta = new THREE.Mesh(
      new THREE.CylinderGeometry(raio*1.008, raio*1.008, 1.15, 96, 1, true, -arco/2, arco),
      new THREE.MeshStandardMaterial({map:rotulo(...textos), roughness:.65, metalness:0})
    );
    etiqueta.position.y = perfil === "espumante" ? 1.25 : 1.45;
    const topo = PERFIS[perfil][PERFIS[perfil].length-2][1];
    const capsula = new THREE.Mesh(
      new THREE.CylinderGeometry(.42*FINO, .41*FINO, .62, 48),
      new THREE.MeshStandardMaterial({color:capsulaClara ? 0xd9d9d9 : 0x151515, metalness:.75, roughness:.3})
    );
    capsula.position.y = topo - .3;
    const peca = new THREE.Group(); peca.add(corpo, etiqueta, capsula);
    const base = new THREE.Group(); base.add(peca, sombra());
    base.userData.peca = peca;
    return base;
  }

  const grupo = new THREE.Group(); scene.add(grupo);
  const GARRAFAS = [];
  function montar(){
    const conf = [
      {perfil:"borgonha", textos:["Malbec","ALTA · MENDOZA","Valle de Uco"], pos:[-1.75,0,-1.2], giro:.6, vel:-.16, fase:1.3, clara:false},
      {perfil:"bordeaux", textos:["MALBÊ","VINHOS SELECIONADOS","Malbec argentino"], pos:[0,0,0], giro:0, vel:.22, fase:0, clara:true},
      {perfil:"espumante", textos:["Nature","ESPUMANTE · MENDOZA","Brut Nature"], pos:[1.7,0,-1], giro:-.5, vel:.18, fase:2.4, clara:false},
    ];
    conf.forEach((c, i) => {
      const b = garrafa(c.perfil, c.textos, c.clara);
      b.position.set(...c.pos);
      b.userData.peca.rotation.y = c.giro;
      Object.assign(b.userData, {vel:c.vel, fase:c.fase, atraso:i*.18, y0:c.pos[1]});
      grupo.add(b); GARRAFAS.push(b);
    });
  }

  /* poeira clara flutuando */
  const N = 140, pos = new Float32Array(N*3);
  for(let i = 0; i < N; i++){ pos[i*3] = (Math.random()-.5)*10; pos[i*3+1] = Math.random()*6; pos[i*3+2] = (Math.random()-.5)*5 - 1; }
  const poeiraGeo = new THREE.BufferGeometry(); poeiraGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const poeira = new THREE.Points(poeiraGeo, new THREE.PointsMaterial({color:0xffffff, size:.035, transparent:true, opacity:.35, depthWrite:false}));
  scene.add(poeira);

  function medir(){
    const w = cena.clientWidth, h = cena.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const distancia = camera.aspect < .9 ? 15 : 12.5;
    camera.position.set(0, 2.6, distancia);
    camera.lookAt(0, 2.05, 0);
    camera.updateProjectionMatrix();
  }

  let alvoX = 0, alvoY = 0;
  window.addEventListener("pointermove", e => {
    alvoX = (e.clientX / innerWidth - .5);
    alvoY = (e.clientY / innerHeight - .5);
  }, {passive:true});

  let visivel = true, inicio = null, anterior = null;
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting; if(visivel) requestAnimationFrame(quadro); }).observe(cena);

  const suave = x => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  function quadro(agora){
    if(!visivel || document.hidden) { anterior = null; return; }
    if(inicio === null) inicio = agora;
    const dt = anterior === null ? 0 : Math.min((agora - anterior) / 1000, .05);
    anterior = agora;
    const t = (agora - inicio) / 1000;

    GARRAFAS.forEach(b => {
      const entrada = suave((t - b.userData.atraso) / 1.6);
      b.position.y = b.userData.y0 - (1 - entrada) * 2.2 + Math.sin(t*.8 + b.userData.fase) * .06;
      b.userData.peca.rotation.y += b.userData.vel * dt;
    });
    grupo.rotation.y += (alvoX * .35 - grupo.rotation.y) * .04;
    grupo.rotation.x += (alvoY * .08 - grupo.rotation.x) * .04;

    const p = poeiraGeo.attributes.position;
    for(let i = 0; i < N; i++){ let y = p.getY(i) + dt * .12; if(y > 6) y = 0; p.setY(i, y); }
    p.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(quadro);
  }

  const fontes = document.fonts ? Promise.all([
    document.fonts.load('500 132px "Bodoni Moda"'),
    document.fonts.load('italic 400 40px "Bodoni Moda"'),
    document.fonts.load('500 30px "Hanken Grotesk"'),
  ]).catch(() => {}) : Promise.resolve();

  fontes.then(() => {
    montar(); medir();
    window.addEventListener("resize", medir);
    if(reduzir){
      GARRAFAS.forEach(b => b.position.y = b.userData.y0);
      renderer.render(scene, camera);
    } else {
      document.addEventListener("visibilitychange", () => { if(!document.hidden) requestAnimationFrame(quadro); });
      requestAnimationFrame(quadro);
    }
  });
})();
