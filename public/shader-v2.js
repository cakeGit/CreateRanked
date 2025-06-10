

const canvas = document.getElementById("glCanvas");
const gl = canvas.getContext("webgl");

function updateCanvasSize() {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    if (canvas.width !== newWidth || canvas.height !== newHeight) {
        canvas.width = newWidth;
        canvas.height = newHeight;
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }
}


const vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;


const fsSource = `
    precision mediump float;
    uniform float u_time;
    uniform vec2 mousePosition;

    vec3 crunch(vec3 color) {
        float brightness = length(color);

        return (color / brightness) * floor(brightness * 32.0) / 32.0;
    }

    void main() {
        vec2 position = mat2(
            0.9, 0.01,
            0.1, 1.0
        ) * (gl_FragCoord.xy / 5.0);
        position = vec2(
            floor(position.x),
            floor(position.y)
        );
        
        vec3 col = vec3(0.333, 0.608, 0.835) + vec3(0.1, 0.1, 0.1);

        vec3 colAddition = vec3(0.0, 0.0, 0.0);
        vec3 gridOverlapAddition = vec3(0.0, 0.0, 0.0);
        if (mod(position.x, 5.0) < 1.0) {
            colAddition += vec3(0.1, 0.1, 0.1);
        }
        if (mod(position.y, 5.0) < 1.0) {
            colAddition += vec3(0.2, 0.2, 0.2);
        }
        if (mod(position.x, 5.0) < 1.0 && mod(position.y, 5.0) < 1.0) {
            gridOverlapAddition = vec3(0.3, 0.3, 0.3);
        }
        
        float timeWave = sin(u_time + (position.x * 0.5 + position.y * 0.23 + sin((position.x + position.y) / 2.0) * 0.1) / 10.0);
        colAddition *= 0.7 + 0.3 * timeWave;

        float mouseFactor = (1.0 - min(length(gl_FragCoord.xy - mousePosition) / 300.0, 1.0));
        mouseFactor = mouseFactor * mouseFactor * mouseFactor; 
        colAddition *= 0.6 + 1.0 * mouseFactor;
        gridOverlapAddition *= 0.0 + 2.0 * max(timeWave / 3.0, mouseFactor);
        col += gridOverlapAddition;
        col += colAddition;
        col += vec3(0.1, 0.1, 0.1) * timeWave * 0.25;

        gl_FragColor = vec4(crunch(col), 1.0);
    }
`;

function compileShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        return null;
    }
    return shader;
}

const vertexShader = compileShader(gl, vsSource, gl.VERTEX_SHADER);
const fragmentShader = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);

const shaderProgram = gl.createProgram();
gl.attachShader(shaderProgram, vertexShader);
gl.attachShader(shaderProgram, fragmentShader);
gl.linkProgram(shaderProgram);
gl.useProgram(shaderProgram);

const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,   1, -1,   -1, 1,
    -1, 1,    1, -1,    1, 1
]), gl.STATIC_DRAW);

const positionLocation = gl.getAttribLocation(shaderProgram, "a_position");
gl.enableVertexAttribArray(positionLocation);
gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

const timeLocation = gl.getUniformLocation(shaderProgram, "u_time");
let startTime = performance.now();
const mousePositionLocation = gl.getUniformLocation(shaderProgram, "mousePosition");
document.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    
    let mouseX = event.clientX - rect.left;
    let mouseY = rect.height - (event.clientY - rect.top);
    gl.uniform2f(mousePositionLocation, mouseX, mouseY);
});

function render() {
    updateCanvasSize();
    let elapsed = (performance.now() - startTime) * 0.001;
    gl.uniform1f(timeLocation, elapsed);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    requestAnimationFrame(render);
}

render();