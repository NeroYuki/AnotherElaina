const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const { once } = require('events');

const rendererHtml = `<!doctype html><html><head><style>
html,body{margin:0;background:#181922}canvas{display:block}
</style><script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script></head>
<body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from '/three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from '/three/examples/jsm/environments/RoomEnvironment.js';
try {
    const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(512,512);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    document.body.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#181922');
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(room,0.04).texture;
    room.dispose(); pmrem.dispose();
    scene.add(new THREE.AmbientLight(0xffffff,1.5));
    for (const [color,power,position] of [[0xfff6e8,2,[3,4,5]],[0xd6e5ff,1,[-4,2,-2]]]) {
        const light = new THREE.DirectionalLight(color,power);
        light.position.set(...position); scene.add(light);
    }
    const gltf = await new GLTFLoader().loadAsync('/model.glb');
    scene.add(gltf.scene);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) throw new Error('Exported GLB has no visible geometry.');
    const center = box.getCenter(new THREE.Vector3());
    const extent = box.getSize(new THREE.Vector3());
    const distance = Math.max(extent.length()*1.6,0.5);
    const camera = new THREE.PerspectiveCamera(36,1,distance/1000,distance*100);
    window.renderOrbitFrame = (frame,total) => {
        const angle = frame/total*Math.PI*2;
        camera.position.set(center.x+Math.sin(angle)*distance,center.y+distance*0.12,center.z+Math.cos(angle)*distance);
        camera.lookAt(center); renderer.render(scene,camera);
    };
    window.renderOrbitFrame(0,120);
    window.orbitReady = true;
} catch(error) { window.orbitError = String(error); }
</script></body></html>`;

async function renderOrbit(glb, { onProgress = () => {}, frames = 120, fps = 24,
    ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg', launchOptions = {} } = {}) {
    const { chromium } = require('playwright');
    const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anotherelaina-orbit-'));
    const output = path.join(directory, 'orbit.mp4');
    let browser, encoder, encoderError;
    const server = http.createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname === '/model.glb') {
                response.setHeader('Content-Type', 'model/gltf-binary'); return response.end(glb);
            }
            if (url.pathname === '/') {
                response.setHeader('Content-Type', 'text/html'); return response.end(rendererHtml);
            }
            if (!url.pathname.startsWith('/three/')) { response.writeHead(404); return response.end(); }
            const file = path.resolve(threeRoot, '.' + decodeURIComponent(url.pathname.slice('/three'.length)));
            const relative = path.relative(threeRoot, file);
            if (relative.startsWith('..') || path.isAbsolute(relative) || !file.endsWith('.js')) {
                response.writeHead(403); return response.end();
            }
            response.setHeader('Content-Type', 'text/javascript');
            response.end(await fs.readFile(file));
        } catch (_) { response.writeHead(500); response.end(); }
    });
    try {
        await new Promise((resolve, reject) => {
            server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
        });
        const executablePath = process.env.CELFORGE_CHROME_PATH;
        const defaults = executablePath ? { executablePath } : process.platform === 'win32' ? { channel: 'chrome' } : {};
        browser = await chromium.launch({ headless: true, ...defaults, ...launchOptions });
        const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.orbitReady || window.orbitError, undefined, { timeout: 120_000 });
        const renderError = await page.evaluate(() => window.orbitError);
        if (renderError) throw new Error(renderError);
        encoder = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'png',
            '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart', '-y', output], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        let stderr = '';
        encoder.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
        encoder.stdin.on('error', error => { encoderError = error; });
        const done = new Promise((resolve, reject) => {
            encoder.on('error', error => { encoderError = error; reject(error); });
            encoder.on('close', code => code === 0 ? resolve() : reject(new Error(`Orbit video encoding failed: ${stderr || code}`)));
        });
        done.catch(() => {}); // Preserve early spawn failures until awaited below.
        for (let frame = 0; frame < frames; frame++) {
            if (encoderError) throw encoderError;
            await page.evaluate(([index, total]) => window.renderOrbitFrame(index, total), [frame, frames]);
            const png = await page.locator('canvas').screenshot({ type: 'png', timeout: 30_000 });
            if (!encoder.stdin.write(png)) await Promise.race([once(encoder.stdin, 'drain'), done]);
            onProgress(`Rendering model orbit (${frame + 1}/${frames})…`);
        }
        encoder.stdin.end();
        await done;
        return await fs.readFile(output);
    } finally {
        if (encoder && encoder.exitCode === null) encoder.kill();
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(output, { force: true });
        await fs.rmdir(directory);
    }
}

module.exports = { renderOrbit };
