/* Abertura: carrossel 3D com as fotos reais das garrafas.
   A garrafa da frente fica colorida; as de trás, em preto e branco. */
(function(){
  const palco = document.getElementById("palco");
  if(!palco || !window.MALBE) return;
  const {VINHOS, brl, mudar, abrir} = window.MALBE;
  const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* fotos com fundo branco (jpg) ganham fundo transparente no navegador */
  function recortarFundo(src){
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        try{
          const w = img.naturalWidth, h = img.naturalHeight;
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          const g = c.getContext("2d"); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, w, h), px = d.data;
          const claro = i => px[i] > 212 && px[i+1] > 212 && px[i+2] > 212;
          const visto = new Uint8Array(w*h), fila = [];
          for(let x = 0; x < w; x++){ fila.push(x, (h-1)*w + x); }
          for(let y = 0; y < h; y++){ fila.push(y*w, y*w + w-1); }
          while(fila.length){
            const p = fila.pop();
            if(visto[p] || !claro(p*4)) continue;
            visto[p] = 1; px[p*4+3] = 0;
            const x = p % w;
            if(x > 0) fila.push(p-1);
            if(x < w-1) fila.push(p+1);
            if(p >= w) fila.push(p-w);
            if(p < w*(h-1)) fila.push(p+w);
          }
          g.putImageData(d, 0, 0);
          /* corta a margem vazia para a garrafa ocupar a altura toda */
          let x0 = w, y0 = h, x1 = 0, y1 = 0;
          for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
            if(px[(y*w + x)*4 + 3]){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
          }
          const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
          const corte = document.createElement("canvas"); corte.width = cw; corte.height = ch;
          corte.getContext("2d").drawImage(c, x0, y0, cw, ch, 0, 0, cw, ch);
          res(corte.toDataURL("image/png"));
        }catch(e){ res(src); }
      };
      img.onerror = () => res(src);
      img.src = src;
    });
  }

  const lista = VINHOS.filter(v => v.foto);
  const n = lista.length;
  const passo = 360 / n;
  const els = lista.map((v, i) => {
    const el = document.createElement("div");
    el.className = "garrafa";
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", v.nome);
    const img = document.createElement("img");
    img.alt = ""; img.src = v.foto;
    if(/\.jpe?g$/i.test(v.foto)) recortarFundo(v.foto).then(u => img.src = u);
    el.appendChild(img);
    el.addEventListener("click", () => irPara(i));
    palco.appendChild(el);
    return el;
  });

  let angulo = 0;          /* ângulo atual do anel, em graus */
  let alvo = 0;            /* para onde o anel está indo */
  let atual = -1;
  let pausa = 0;           /* tempo até voltar a girar sozinho */

  function raio(){ return Math.min(palco.clientWidth * .38, 420); }
  const norm = a => ((a % 360) + 540) % 360 - 180;

  function desenhar(){
    const R = raio();
    let frente = 0, melhor = -2;
    els.forEach((el, i) => {
      const a = (i * passo + angulo) * Math.PI / 180;
      const x = Math.sin(a) * R;
      const z = Math.cos(a);                 /* 1 = frente, -1 = fundo */
      const perto = (z + 1) / 2;             /* 0..1 */
      const escala = .5 + perto * .48;
      const cinza = Math.min(1, (1 - perto) * 2.2);
      el.style.transform = `translateX(${x.toFixed(1)}px) translateZ(${(z*R*.4).toFixed(1)}px) scale(${escala.toFixed(3)})`;
      el.style.filter = `grayscale(${cinza.toFixed(2)}) brightness(${(.35 + perto*.7).toFixed(2)})`;
      el.style.opacity = (.25 + perto * .75).toFixed(2);
      el.style.zIndex = Math.round(perto * 100);
      if(z > melhor){ melhor = z; frente = i; }
    });
    if(frente !== atual){ atual = frente; legenda(lista[frente]); }
  }

  function legenda(v){
    document.getElementById("leg-vin").textContent = v.vinicola;
    document.getElementById("leg-nome").textContent = v.nome;
    document.getElementById("leg-preco").textContent = v.preco ? brl(v.preco) : "Preço sob consulta";
  }
  document.getElementById("leg-add").addEventListener("click", () => { mudar(lista[atual].id, 1); abrir(); });

  function irPara(i){
    /* gira pelo caminho mais curto até a garrafa i ficar na frente */
    const destino = -i * passo;
    alvo = angulo + norm(destino - angulo);
    pausa = 6;
  }
  document.getElementById("ant").addEventListener("click", () => irPara((atual - 1 + n) % n));
  document.getElementById("prox").addEventListener("click", () => irPara((atual + 1) % n));

  /* arrastar com o dedo ou o mouse */
  let arrastando = null;
  palco.addEventListener("pointerdown", e => { if(e.target.closest(".seta")) return; arrastando = {x:e.clientX, a:angulo, moveu:false}; });
  window.addEventListener("pointermove", e => {
    if(!arrastando) return;
    const dx = e.clientX - arrastando.x;
    if(Math.abs(dx) > 4) arrastando.moveu = true;
    angulo = alvo = arrastando.a + dx * .25;
    pausa = 6;
  });
  window.addEventListener("pointerup", () => {
    if(arrastando && arrastando.moveu){ alvo = Math.round(angulo / passo) * passo; }
    arrastando = null;
  });
  palco.addEventListener("click", e => { if(arrastando === null) return; }, true);

  let anterior = null, visivel = true;
  new IntersectionObserver(([e]) => { visivel = e.isIntersecting; if(visivel) requestAnimationFrame(quadro); }).observe(palco);

  function quadro(t){
    if(!visivel || document.hidden){ anterior = null; return; }
    const dt = anterior === null ? 0 : Math.min((t - anterior) / 1000, .05);
    anterior = t;
    if(!arrastando){
      if(pausa > 0) pausa -= dt;
      else if(!reduzir) alvo -= dt * 9;      /* giro lento e contínuo */
      angulo += (alvo - angulo) * Math.min(1, dt * 4);
    }
    desenhar();
    requestAnimationFrame(quadro);
  }

  palco.addEventListener("mouseenter", () => pausa = Math.max(pausa, 2));
  document.addEventListener("visibilitychange", () => { if(!document.hidden) requestAnimationFrame(quadro); });
  window.addEventListener("resize", desenhar);
  desenhar();
  requestAnimationFrame(quadro);
})();
