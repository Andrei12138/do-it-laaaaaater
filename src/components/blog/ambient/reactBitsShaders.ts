// Adapted from DavidHDev/react-bits (MIT)
import type { BlogAmbientEffectId } from '../../../blog-types'

const common = `
uniform vec2 uResolution, uPointer;
uniform vec3 uPrimary, uSecondary, uBase;
uniform vec4 uAudio;
uniform float uTime, uIntensity, uScale, uDark;
float px() { return 1.0 / uResolution.y; }
vec2 point() { return (gl_FragCoord.xy - 0.5 * uResolution) * px(); }
float stroke(float d, float width) { return 1.0 - smoothstep(width, width + px(), abs(d)); }
vec4 ink(vec3 color, float alpha) { return vec4(color * alpha, alpha); }
vec2 turn(vec2 p, float a) { return mat2(cos(a),sin(a),-sin(a),cos(a))*p; }
`

const threads = `
float perlin(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  vec4 pt = vec4(cell, cell + 1.0);
  pt = (mod(pt, 71.0) + vec2(26.0, 161.0).xyxy) / 64.0;
  pt *= pt;
  pt = pt.xzxz * pt.yyww;
  vec4 gx = fract(pt * (16777216.0 / 951.135664)) - 0.49999;
  vec4 gy = fract(pt * (16777216.0 / 642.949883)) - 0.49999;
  vec4 gradient = (gx * (f.x - vec4(0,1,0,1)) + gy * (f.y - vec4(0,0,1,1)))
    * inversesqrt(max(vec4(0.0001), gx*gx + gy*gy));
  vec2 b = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(gradient.x, gradient.y, b.x), mix(gradient.z, gradient.w, b.x), b.y);
}
void main() {
  vec2 p = turn(point(), 0.20);
  float x = p.x;
  float drift = uTime * 0.34;
  float pluck = (0.045 + 0.055*uIntensity + 0.14*uAudio.x + 0.030*uAudio.y);
  float envelope = smoothstep(-0.7, 0.55, x);
  float field = perlin(vec2(drift, x*2.1)) * pluck + 0.053*sin(4.0*x-drift);
  field += uPointer.y*0.027*exp(-4.0*pow(x-uPointer.x,2.0)) + 0.023*uAudio.z*sin(7.0*x);
  float spacing = (0.13 + 0.20*envelope) * uScale / 18.0;
  float nearest = floor((p.y-field)/spacing+9.5);
  float coverage = 0.0, tint = 0.0;
  for (int offset=-1; offset<=1; offset++) {
    float index = nearest + float(offset);
    if (index < 0.0 || index > 18.0) continue;
    float lane = index/18.0;
    float wave = sin(7.0*x-drift*3.0+lane*4.3)*envelope*(0.17+0.25*uAudio.x);
    float y = (index-9.0+wave)*spacing+field;
    float edge = stroke(p.y-y, max(0.00046+0.00028*uAudio.w, px()*0.32));
    if (edge > coverage) { coverage = edge; tint = lane; }
  }
  OUT = ink(mix(uPrimary,uSecondary,tint*0.78), coverage*(0.66+0.24*uDark));
}`

const iridescence = `
void main() {
  vec2 p = turn(point(), -0.31)/uScale + uPointer*0.03;
  float a=0.0, d=-0.44*uTime;
  for (int i=0; i<6; i++) {
    float fi=float(i);
    a += cos(fi-d-a*p.x*(0.74+0.52*uIntensity+0.56*uAudio.x));
    d += sin(p.y*fi+a);
  }
  float f=cos(p.x*2.4+p.y*10.0+0.70*a+0.52*d);
  float mask=stroke(p.y+0.10*sin(p.x*3.8),0.24);
  float band=smoothstep(-0.23,-0.18,f);
  float rim=stroke(f-0.38,0.027);
  vec3 pearl=mix(uSecondary,uPrimary,smoothstep(-0.15,0.76,f));
  OUT=ink(mix(pearl,uBase,0.57*rim), mask*band*(0.68+0.14*rim));
}`

const liquidChrome = `
float lamp(vec2 p,vec2 center,vec2 size) {
  vec2 q=(p-center)/size; q*=q;
  return 1.0-smoothstep(0.96,1.04,sqrt(dot(q,q)));
}
void main() {
  vec2 p=turn(point(),0.38)/uScale+uPointer*0.035;
  float angle=7.8*p.y+1.3*sin(4.3*p.x+uTime*0.8)+0.68*cos(8.4*p.x-uTime);
  float wave=sin(angle+(0.22+0.17*uIntensity+0.54*uAudio.x)*cos(7.6*p.y-3.9*p.x+uTime));
  vec2 slope=vec2(cos(angle)*0.65,wave*(0.85+0.41*uIntensity+0.45*uAudio.x));
  vec3 normal=normalize(vec3(-slope,1.0));
  vec3 reflected=reflect(vec3(0.0,0.0,-1.0),normal);
  vec2 mirror=reflected.xy/max(reflected.z+1.0,0.1);
  float key=lamp(mirror,vec2(-0.26,0.42),vec2(0.34,0.11));
  float side=lamp(mirror,vec2(0.26,-0.24),vec2(0.12,0.36));
  float fresnel=pow(1.0-normal.z,2.0);
  float ridge=stroke(abs(mirror.y)-0.51,0.025);
  float aperture=stroke(p.y+0.095*cos(3.1*p.x),0.206);
  float band=smoothstep(-0.80,-0.75,wave);
  vec3 metal=mix(uPrimary*mix(0.50,0.36,uDark),uSecondary, smoothstep(-0.34,0.72,mirror.y));
  metal=mix(metal,vec3(0.96),clamp(key*0.92+side*0.66+ridge*0.80+fresnel,0.0,1.0));
  OUT=ink(metal,aperture*band*0.94);
}`

const aurora = `
void main() {
  vec2 p=point();
  float x=(p.x+0.025*uPointer.x)/uScale;
  float cover=0.0, tint=0.0;
  for (int i=0; i<3; i++) {
    float layer=float(i);
    float pace=uTime*(0.61-0.08*layer);
    float wave=sin(x*5.2+pace+layer*0.75)+0.27*sin(x*12.1-pace*0.66+layer*1.5);
    float hem=0.07+layer*0.093+wave*(0.036+uIntensity*0.036+uAudio.x*0.040);
    float rise=p.y-hem;
    float folds=0.54+0.46*sin(x*41.0+1.8*sin(x*12.0+pace)+layer*1.1);
    float detail=smoothstep(0.36,0.48,folds);
    float reach=(0.065+0.043*folds)*(1.0+0.24*uAudio.x);
    float curtain=smoothstep(-px(),px(),rise)*(1.0-smoothstep(reach-0.025,reach,rise));
    float edge=stroke(rise,0.0016);
    float alpha=max(edge*0.86,curtain*(0.16+0.41*detail))*(0.63+0.18*uDark+0.13*uAudio.x);
    if (alpha>cover) { cover=alpha; tint=layer*0.32+detail*0.18; }
  }
  OUT=ink(mix(uPrimary,uSecondary,tint),clamp(cover,0.0,1.0));
}`

const lightRays = `
void main() {
  vec2 delta=point()-vec2(-0.49+0.075*uPointer.x,0.64);
  float depth=length(delta);
  vec2 dir=delta/max(depth,0.001);
  float angle=dot(dir,vec2(0.60,-0.80));
  float spread=smoothstep(0.46-0.085*uIntensity-0.10*uAudio.x,0.88,angle);
  float phase=angle*(52.2214/uScale)+uTime*0.9;
  float strength=0.55+0.30*sin(phase)+0.15*cos(-angle*21.11349+uTime*0.75);
  float edge=clamp(px()*9.0/max(depth,0.4),0.013,0.046);
  float shaft=smoothstep(0.72-edge,0.72+edge,strength);
  float reach=1.18+0.41*uScale+0.13*uAudio.x;
  float alpha=shaft*spread*(1.0-smoothstep(reach*0.62,reach,depth));
  OUT=ink(mix(uSecondary,uPrimary,smoothstep(0.72,0.95,strength)),alpha*min(0.93,0.55+0.24*uAudio.x));
}`

const prism = `
float pyramid(vec3 p) {
  vec3 q=abs(p)*vec3(1.0,0.86,1.0);
  return max((q.x+q.y+q.z-1.0)*0.57735027,-p.y);
}
vec3 orient(vec3 p) {
  p.xz=turn(p.xz,0.58+0.34*sin(uTime*0.63)+uPointer.x*0.18);
  p.yz=turn(p.yz,-0.33+0.15*sin(uTime*0.72));
  return p;
}
void main() {
  vec2 p=point()-vec2(0.13,-0.07);
  float size=0.25*uScale*(1.0+0.21*uAudio.x);
  vec2 local=p/size;
  float beamX=local.x-0.31;
  float beam=0.0, spectral=0.0;
  if (beamX>0.0) {
    float distance=local.y-0.14-beamX*0.14;
    beam=max(stroke((distance+0.081*beamX)*size,0.005+0.003*uIntensity),stroke((distance-0.064*beamX)*size,0.011));
    beam*=1.0-smoothstep(1.6,3.2,beamX); spectral=step(0.0,distance);
  }
  vec4 color=ink(mix(uPrimary,uSecondary,spectral),beam*min(0.92,0.54+0.12*uIntensity+0.22*uAudio.x));
  if (abs(local.x)<1.36 && abs(local.y)<1.42) {
    vec3 ray=vec3(local.x,local.y,2.0);
    for (int i=0;i<28;i++) {
      vec3 q=orient(ray);
      float d=pyramid(q);
      if (d<0.005) {
        vec3 facet=sign(q)*vec3(1.0,0.86,1.0);
        if (q.y<0.008) facet=vec3(0.0,-1.0,0.0);
        float light=clamp(dot(normalize(facet),vec3(-0.48,0.65,0.59))*0.5+0.5,0.0,1.0);
        float edge=min(min(abs(q.x),abs(q.z)),abs(q.y));
        vec3 glass=mix(uPrimary,uSecondary,light);
        glass=mix(glass,vec3(0.94),0.65*(1.0-smoothstep(0.009,0.028,edge)));
        color=ink(glass,0.91); break;
      }
      ray.z-=max(d,0.016);
      if(ray.z < -1.4) break;
    }
  }
  OUT=color;
}`

const colorBends = `
void main() {
  vec2 p=turn(point(),-0.28)/uScale;
  vec2 q=p*vec2(2.1,5.4)+uPointer*0.075;
  float warp=0.10+0.13*uIntensity+0.27*uAudio.x;
  for (int i=0;i<3;i++) {
    vec2 r=sin(1.5*q.yx+2.0*cos(q+vec2(uTime*0.26,-uTime*0.23)));
    q+=(r-q)*warp*0.25;
  }
  float ribbon=0.50+0.50*sin(q.y*3.0+0.78*sin(q.x*2.1-uTime*0.44));
  float band=smoothstep(0.66,0.68,ribbon);
  float bevel=smoothstep(0.72,0.99,ribbon);
  float bounds=stroke(p.y+0.09*sin(p.x*3.6),0.27);
  OUT=ink(mix(uPrimary,uSecondary,bevel*0.81),band*bounds*0.84);
}`

const fragments: Partial<Record<BlogAmbientEffectId, string>> = {
  threads, iridescence, 'liquid-chrome': liquidChrome, aurora, 'light-rays': lightRays, prism, 'color-bends': colorBends
}

export function reactBitsFragment(effect: BlogAmbientEffectId, webgl2: boolean, highPrecision: boolean): string {
  const precision = `precision ${highPrecision ? 'highp' : 'mediump'} float;\n`
  const header = webgl2 ? `#version 300 es\n${precision}out vec4 fragmentColor;\n` : precision
  return header + common + (fragments[effect] ?? threads).replaceAll(/\bOUT\b/g, webgl2 ? 'fragmentColor' : 'gl_FragColor')
}
