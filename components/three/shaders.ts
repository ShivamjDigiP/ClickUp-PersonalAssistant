// Glass look for the hero orb and the project "bubbles". Hand-written so there are no texture/HDR
// downloads (these would break behind a corporate proxy) and it stays light on the GPU.

export const orbVertex = /* glsl */ `
  uniform float uTime; uniform float uAmp;
  varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  void main(){
    vec3 p = position;
    float d = sin(p.x*2.4+uTime*.9)*sin(p.y*2.6+uTime*1.1)*sin(p.z*2.2+uTime*.7);
    p += normal * d * uAmp;
    vObj = p;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(p,1.);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

export const orbFragment = /* glsl */ `
  uniform float uTime; uniform float uLight;
  varying vec3 vN; varying vec3 vV; varying vec3 vObj;
  void main(){
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    float ndv = max(dot(n,v),0.);
    float fres = pow(1.-ndv, 2.0);
    // iridescent film that drifts slowly (blue / violet / pink / teal like the mock-up)
    float t = ndv*1.1 + vObj.y*.35 + sin(vObj.x*1.6+uTime*.35)*.18 + uTime*.04;
    vec3 film = .5 + .5*cos(6.2831*(t + vec3(.0,.33,.67)));
    film = mix(film, vec3(.42,.36,.95), .25);
    vec3 deep = mix(vec3(.05,.07,.28), vec3(.30,.20,.75), ndv);
    vec3 col = mix(deep, film, smoothstep(.0,.9,fres+.25));
    col += fres*vec3(.55,.7,1.)*.9;
    vec3 L = normalize(vec3(-.5,.8,.7));
    col += pow(max(dot(reflect(-L,n),v),0.),38.)*.9;
    float a = clamp(.62 + .38*fres, 0., 1.);
    col = mix(col, col*.6+vec3(.2), uLight*.3);
    gl_FragColor = vec4(col, a);
  }`;

export const planetVertex = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position,1.);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;

export const planetFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN; varying vec3 vV;
  void main(){
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    float ndv = max(dot(n,v),0.);
    float fres = pow(1.-ndv, 2.2);
    vec3 L = normalize(vec3(-.5,.7,.6));
    float diff = max(dot(n,L),0.);
    vec3 core = uColor*(.22 + .6*diff);
    vec3 rim = mix(uColor, vec3(1.), .35) * fres * 1.7;
    float spec = pow(max(dot(reflect(-L,n),v),0.), 46.);
    float bounce = pow(max(dot(n, normalize(vec3(.3,-.8,.2))),0.), 2.) * .45;
    vec3 col = core + rim + vec3(spec)*.95 + uColor*bounce;
    float a = clamp(.52 + .5*fres + .22*diff + spec, 0., 1.);
    gl_FragColor = vec4(col, a);
  }`;

export const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;

export const glowFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uStrength;
  varying vec2 vUv;
  void main(){
    float r = length(vUv-.5)*2.;
    float a = smoothstep(1., .35, r) * uStrength;
    gl_FragColor = vec4(uColor, a);
  }`;
