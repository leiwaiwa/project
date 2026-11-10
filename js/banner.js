(function () {
  var intro = document.querySelector('.intro');
  var cv = intro && intro.querySelector('.intro-shader');
  if (!cv) return;

  /* ===== 两套预设，想改效果只改这里 ===== */
  var PRESETS = {
    glass: {                           // 条纹玻璃（颜色取自你的图标）
      colors: ['#b5d36b', '#24accf', '#c8ac48', '#3144e7', '#ef57e5'],
      bg: '#3c9df3', glass: 0.4, ribs: 26, speed: 0.6, sharp: 4.0, grain: 0.01, glow: 0.10
    },
    dreamy: {                          // 柔和粉彩，无颗粒
      colors: ['#FFE14D', '#FF8FC2', '#3E8BFF', '#FFC2DA', '#FF9E5E'],
      bg: '#FFF6EC', glass: 0.0, ribs: 22, speed: 0.4, sharp: 2.4, grain: 0.0, glow: 0.10
    }
  };
  var P = PRESETS[cv.getAttribute('data-style')] || PRESETS.glass;

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return;                     // 不支持 WebGL：保留 CSS 兜底渐变

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform vec2 uRes, uMouse;',
    'uniform float uTime, uGlass, uRibs, uGrain, uSharp, uGlow;',
    'uniform vec3 uBg;',
    'uniform vec3 uC[5];',
    'float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}',
    'vec3 mesh(vec2 uv,float t){',
    '  vec3 acc=vec3(0.);float ws=0.;',
    // 全局缓慢漂移，让色团整体在画面里游走
    '  vec2 drift=vec2(.10*sin(t*.13), .08*cos(t*.11));',
    '  for(int i=0;i<5;i++){',
    '    float f=float(i);',
    // 加大幅度 + 加快速度 = 默认状态下颜色明显流动
    '    vec2 c=vec2(',
    '      .5+.42*sin(t*(.33+.10*f)+f*2.1),',
    '      .5+.38*cos(t*(.27+.08*f)+f*1.7)',
    '    );',
    '    c+=drift;',                                  // 👈 全局漂移
    '    c+=(uMouse-.5)*(.55-f*.07);',                // 👈 鼠标视差跟随
    '    vec2 d=(uv-c)*vec2(uRes.x/uRes.y,1.);',
    '    float w=exp(-dot(d,d)*uSharp);',
    '    acc+=uC[i]*w;ws+=w;',
    '  }',
    '  return mix(uBg,acc/max(ws,1e-4),smoothstep(0.,.6,ws));',
    '}',
    'void main(){',
    '  vec2 uv=gl_FragCoord.xy/uRes;',
    '  float rib=fract(uv.x*uRibs);',
    '  float cell=floor(uv.x*uRibs);',
    '  vec2 s=uv;',
    '  s.x=(cell+.5+(rib-.5)*(1.-.75*uGlass))/uRibs;',   // 每条玻璃内压缩采样 = 折射感
    '  vec3 col=mesh(s,uTime);',
    '  float e=abs(rib-.5)*2.;',
    '  col*=1.-uGlass*.10*e*e;',                         // 条纹边缘变暗
    '  col+=uGlass*.05*smoothstep(.55,0.,rib);',         // 条纹高光
    '  vec2 d=(uv-uMouse)*vec2(uRes.x/uRes.y,1.);',
    '  col+=uGlow*exp(-dot(d,d)*7.);',                   // 鼠标光晕
    '  col+=(h(gl_FragCoord.xy+fract(uTime)*91.)-.5)*uGrain;', // 颗粒
    '  gl_FragColor=vec4(col,1.);',
    '}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var pr = gl.createProgram();
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  var U = function (n) { return gl.getUniformLocation(pr, n); };
  var uRes = U('uRes'), uMouse = U('uMouse'), uTime = U('uTime');
  gl.uniform3fv(U('uC'), new Float32Array([].concat.apply([], P.colors.map(rgb))));
  gl.uniform3fv(U('uBg'), new Float32Array(rgb(P.bg)));
  gl.uniform1f(U('uGlass'), P.glass); gl.uniform1f(U('uRibs'), P.ribs);
  gl.uniform1f(U('uGrain'), P.grain); gl.uniform1f(U('uSharp'), P.sharp);
  gl.uniform1f(U('uGlow'), P.glow);

  var t = 0, mx = .7, my = .7, tx = .7, ty = .7, shown = false;

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // 限制像素比，省性能
    var w = Math.max(1, Math.round(cv.clientWidth * dpr));
    var hh = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(uRes, cv.width, cv.height);
  }
  function draw() {
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!shown) { shown = true; cv.style.opacity = 1; }
  }

  var raf = 0, running = false, last = 0;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.1); last = now;
    t += dt * P.speed;
    mx += (tx - mx) * .08; my += (ty - my) * .08;
    draw();
    if (running) raf = requestAnimationFrame(frame);
  }
  function start(force) {
    if (running) return;
    if (reduce && !force) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  intro.addEventListener('pointermove', function (e) {
    var r = intro.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width;
    ty = 1 - (e.clientY - r.top) / r.height;
    start(true);
  });

  resize(); draw();                     // 先画一帧静态画面
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); draw(); }).observe(intro);
  else window.addEventListener('resize', function () { resize(); draw(); });

  if (window.IntersectionObserver) {    // 滚出屏幕就暂停，省电
    new IntersectionObserver(function (en) { en[0].isIntersecting ? start() : stop(); }).observe(intro);
  } else { start(); }
})();