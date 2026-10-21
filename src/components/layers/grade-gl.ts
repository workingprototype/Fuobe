"use client";

import { FRAGMENT, uniforms, VERTEX, type Grade } from "@/lib/grade";
import { loseContext } from "@/lib/media-release";

/**
 * The Color grading tool's WebGL grade (src/lib/grade.ts) applied to a layer: the shader grades the
 * colours, then the layer's own alpha is put back (the shader writes opaque pixels).
 */
export class LayerGrader {
  private canvas = document.createElement("canvas");
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private loc = new Map<string, WebGLUniformLocation | null>();

  constructor() {
    const gl = this.canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL isn't available in this browser");
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    for (const [k, v] of [
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.loc.get(name)!;
  }

  /** The graded copy of `src` (same size), with `src`'s transparency. */
  grade(src: HTMLCanvasElement, grade: Grade): HTMLCanvasElement {
    const gl = this.gl;
    const { width, height } = src;
    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    for (const [k, v] of Object.entries(uniforms(grade))) {
      if (Array.isArray(v)) gl.uniform3f(this.u(k), v[0], v[1], v[2]);
      else gl.uniform1f(this.u(k), v);
    }
    gl.uniform2f(this.u("u_texel"), 1 / Math.max(1, width), 1 / Math.max(1, height));
    gl.uniform1f(this.u("u_seed"), 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(this.canvas, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(src, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    return out;
  }

  dispose() {
    loseContext(this.gl);
  }
}
