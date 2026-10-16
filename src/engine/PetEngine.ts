export type PetBehavior = 'idle' | 'walk' | 'fetch';

export class PetAnimationEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private activeBehavior: PetBehavior = 'idle';
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  // Track the mouse coordinate vector for tracking and fetch positioning
  private targetCoordinates = { x: 300, y: 200 };

  // Base positional coordinates for the pet object rigging anchor
  private petRigAnchor = {
    x: 300,
    y: 300,
    radius: 25,
    rotationAngle: 0,
    headOffset: { x: 0, y: -40 }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire 2D canvas context');
    this.ctx = context;

    this.initEventListeners();
    this.startLoop();
  }

  private initEventListeners() {
    // Dynamically map relative canvas cursor coordinates across screen sizes
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      this.targetCoordinates.x = event.clientX - rect.left;
      this.targetCoordinates.y = event.clientY - rect.top;
    });
  }

  public setBehavior(behavior: PetBehavior) {
    this.activeBehavior = behavior;
    console.log(`Switched pet execution pipeline to: ${behavior}`);
    // Candidate hint: Initializing triggers for transitional math vectors could occur here
  }

  private startLoop() {
    this.lastTime = performance.now();
    const renderStep = (timestamp: number) => {
      // Calculate delta time step to preserve variable frame-rate limits (60Hz vs 120Hz screens)
      const deltaTime = (timestamp - this.lastTime) / 1000;
      this.lastTime = timestamp;

      this.update(deltaTime);
      this.draw();

      this.animationFrameId = requestAnimationFrame(renderStep);
    };
    this.animationFrameId = requestAnimationFrame(renderStep);
  }

  /**
   * TASK FOR CANDIDATE:
   * Process all vector calculations, easing steps, and joint matrices here.
   */
  private update(deltaTime: number) {
    // Boilerplate default movement: Make the target coordinates slightly guide body orientation
    // Candidate needs to overwrite this with precise image-mesh rigging / inverse kinematics logic
    if (this.activeBehavior === 'walk') {
      this.petRigAnchor.x += Math.sin(performance.now() * 0.005) * 2;
    }
  }

  /**
   * TASK FOR CANDIDATE:
   * Draw structural components, apply coordinate matrices, and render assets.
   */
  private draw() {
    // 1. Wipe the viewport clean each frame step
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. Render background ambient grid mapping
    this.drawDebugGrid();

    // 3. Render tracking target crosshair point (The mouse/ball coordinates)
    this.ctx.beginPath();
    this.ctx.arc(this.targetCoordinates.x, this.targetCoordinates.y, 6, 0, Math.PI * 2);
    this.ctx.fillStyle = this.activeBehavior === 'fetch' ? '#f59e0b' : '#38bdf8';
    this.ctx.fill();

    // 4. Render primitive dummy pet components (Candidate will map image deformations over this layer)
    const { x, y, radius, headOffset } = this.petRigAnchor;

    // Draw Body anchor
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fillStyle = '#475569';
    this.ctx.fill();
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = '#94a3b8';
    this.ctx.stroke();

    // Draw Head anchor skeleton node
    this.ctx.beginPath();
    this.ctx.arc(x + headOffset.x, y + headOffset.y, radius * 0.7, 0, Math.PI * 2);
    this.ctx.fillStyle = '#64748b';
    this.ctx.fill();
    this.ctx.stroke();

    // Render configuration text readout directly into canvas metadata overlay
    this.ctx.fillStyle = '#475569';
    this.ctx.font = '12px monospace';
    this.ctx.fillText(`State: ${this.activeBehavior.toUpperCase()}`, 15, 25);
  }

  private drawDebugGrid() {
    this.ctx.strokeStyle = '#1e293b';
    this.ctx.lineWidth = 1;
    const gridSize = 40;

    for (let x = 0; x < this.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }

  public destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }
}
