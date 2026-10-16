import { PetAnimationEngine } from './engine/PetEngine';

const appDiv = document.getElementById('app') as HTMLDivElement;

// 1. Render the application container UI
appDiv.innerHTML = `
  <div class="flex flex-col items-center gap-6 bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
    <div class="text-center">
      <h1 class="text-2xl font-bold tracking-tight text-white">Pet Interactive Canvas</h1>
      <p class="text-sm text-slate-400 mt-1">Move your cursor inside the box or toggle actions below</p>
    </div>

    <!-- The WebGL/Canvas Workspace viewport -->
    <div class="relative bg-slate-950 rounded-xl overflow-hidden border-2 border-slate-600 shadow-inner">
      <canvas id="pet-viewport" width="600" height="400" class="block cursor-crosshair"></canvas>
    </div>

    <!-- Controller Panel Buttons -->
    <div class="flex gap-4">
      <button id="btn-idle" class="px-5 py-2 rounded-lg font-semibold bg-slate-700 hover:bg-slate-600 text-white transition shadow border border-slate-600">
        Idle State 💤
      </button>
      <button id="btn-walk" class="px-5 py-2 rounded-lg font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition shadow">
        Go for Walk 🐾
      </button>
      <button id="btn-fetch" class="px-5 py-2 rounded-lg font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow">
        Play Fetch 🎾
      </button>
    </div>
  </div>
`;

// 2. Initialize the Canvas Orchestration Engine
const canvas = document.getElementById('pet-viewport') as HTMLCanvasElement;
const engine = new PetAnimationEngine(canvas);

// 3. Attach standard control events to the canvas system variables
document.getElementById('btn-idle')?.addEventListener('click', () => engine.setBehavior('idle'));
document.getElementById('btn-walk')?.addEventListener('click', () => engine.setBehavior('walk'));
document.getElementById('btn-fetch')?.addEventListener('click', () => engine.setBehavior('fetch'));
