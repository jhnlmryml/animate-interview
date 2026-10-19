export type PetBehavior = 'idle' | 'walk' | 'fetch';

type Point = { x: number; y: number };

const LEG_POSES = [
  { hipX: -47, front: false, phase: Math.PI },
  { hipX: 48, front: false, phase: 0 },
  { hipX: -42, front: true, phase: 0 },
  { hipX: 42, front: true, phase: Math.PI },
] as const;

const FETCH_WINDUP = 0.2;
const FETCH_FLIGHT = 1.15;
const FETCH_CATCH = 0.6;

/**
 * The engine keeps simulation state (position, gait, and joint anchors) separate
 * from Canvas drawing. Each animation frame updates that state from elapsed time,
 * then renders the resulting pose; the static backdrop is cached independently.
 */
export class PetAnimationEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly backdropCanvas: HTMLCanvasElement;
  private readonly backdropCtx: CanvasRenderingContext2D;
  private backdropWidth = 0;
  private backdropHeight = 0;
  private activeBehavior: PetBehavior = 'idle';
  private animationFrameId: number | null = null;
  private lastTime = 0;
  private elapsed = 0;
  private fetchElapsed = 0;
  private fetchActive = false;
  private gaitPhase = 0;
  private gaitBlend = 0;
  private tailAngle = 0;
  private tailBaseAngle = Math.PI;
  private fetchCatchX = 0;
  private fetchCatchY = 0;
  private fetchFlightEndX = 0;
  private fetchFlightEndY = 0;

  private readonly pointerTarget: Point = { x: 300, y: 200 };
  private readonly smoothedTarget: Point = { x: 300, y: 200 };

  // Pet physics and state tracking structure
  private readonly pet = {
    x: 300,
    y: 270,
    velocityX: 0,
    facing: 1, // 1 for right, -1 for left
    bodyLean: 0,
    headX: 320,
    headY: 190,
    headAngle: 0,
  };

  private readonly ball = { x: 0, y: 0, visible: false, rotation: 0 };

  private readonly onPointerMove = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.pointerTarget.x = ((event.clientX - rect.left) / rect.width) * this.canvas.width;
    this.pointerTarget.y = ((event.clientY - rect.top) / rect.height) * this.canvas.height;
  };

  private readonly onPointerLeave = () => {
    this.pointerTarget.x = this.canvas.width * 0.5;
    this.pointerTarget.y = this.canvas.height * 0.48;
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not acquire 2D canvas context');
    this.ctx = context;

    this.backdropCanvas = canvas.ownerDocument.createElement('canvas');
    const backdropContext = this.backdropCanvas.getContext('2d');
    if (!backdropContext) throw new Error('Could not acquire backdrop canvas context');
    this.backdropCtx = backdropContext;
    this.canvas.addEventListener('mousemove', this.onPointerMove);
    this.canvas.addEventListener('mouseleave', this.onPointerLeave);
    this.startLoop();
  }

  public setBehavior(behavior: PetBehavior) {
    this.activeBehavior = behavior;
    if (behavior === 'fetch') {
      this.fetchElapsed = 0;
      this.fetchActive = true;
      this.ball.visible = true;
      const { width, height } = this.canvas;
      const margin = Math.min(90, width * 0.15);
      const maxCatchX = Math.max(margin, width - margin);
      this.fetchCatchX = Math.max(margin, Math.min(maxCatchX, this.pet.x + this.pet.facing * 72));
      this.fetchCatchY = height * 0.84 - 58 - 78 + 18;
      this.fetchFlightEndX = this.fetchCatchX + this.pet.facing * 22;
      this.fetchFlightEndY = this.fetchCatchY;
      this.ball.x = width + 30;
      this.ball.y = height * 0.84 - 60;
      this.ball.rotation = 0;
    } else {
      this.fetchActive = false;
      this.ball.visible = false;
    }
  }

  private startLoop() {
    this.lastTime = performance.now();
    const renderStep = (timestamp: number) => {
      // A capped delta prevents a long pause or background-tab frame from
      // producing a large physics jump; animation rates otherwise use seconds.
      const deltaTime = Math.max(0, Math.min((timestamp - this.lastTime) / 1000, 0.05));
      this.lastTime = timestamp;
      this.elapsed += deltaTime;
      this.update(deltaTime);
      this.draw();
      this.animationFrameId = requestAnimationFrame(renderStep);
    };
    this.animationFrameId = requestAnimationFrame(renderStep);
  }

  /**
   * Update the simulation only; drawing reads these values without changing them.
   * Cursor, body, facing, lean, tail, and head use exponential interpolation:
   * alpha = 1 - exp(-rate * dt), so the response is smooth and frame-rate
   * independent. The body uses the exact damped-spring step below to follow its
   * destination without accumulating integration drift. Fetch motion is timed
   * from elapsed seconds and uses smoothstep on the throw/catch transitions.
   */
  private update(deltaTime: number) {
    const { width, height } = this.canvas;
    const centerX = width * 0.5;
    const floorY = height * 0.84;

    // Smooth cursor interpolation prevents pointer events from snapping the pose.
    const targetEase = 1 - Math.exp(-deltaTime * 5.0);
    this.smoothedTarget.x += (this.pointerTarget.x - this.smoothedTarget.x) * targetEase;
    this.smoothedTarget.y += (this.pointerTarget.y - this.smoothedTarget.y) * targetEase;

    // Determine target destination based on behavior
    let desiredX = centerX;
    if (this.activeBehavior === 'walk') {
      // Gentle following distance offset toward the cursor X
      const margin = Math.min(80, width * 0.2);
      desiredX = Math.max(margin, Math.min(width - margin, this.smoothedTarget.x));
    }

    let anticipation = 0;

    if (this.fetchActive) {
      this.fetchElapsed += deltaTime;

      if (this.fetchElapsed < FETCH_WINDUP) {
        this.ball.x = width + 30;
        this.ball.y = floorY - 60;
        desiredX = this.fetchCatchX;
        anticipation = 0.12;
      } else if (this.fetchElapsed < FETCH_WINDUP + FETCH_FLIGHT) {
        const progress = (this.fetchElapsed - FETCH_WINDUP) / FETCH_FLIGHT;
        const startX = width + 30;
        const startY = floorY - 60;
        const easedProgress = progress * progress * (3 - 2 * progress);

        this.ball.x = startX + (this.fetchFlightEndX - startX) * easedProgress;
        this.ball.y = startY + (this.fetchFlightEndY - startY) * easedProgress - Math.sin(progress * Math.PI) * 78;
        this.ball.rotation = progress * Math.PI * 6;

        desiredX = this.fetchCatchX;
        anticipation = 0.12 + Math.sin(progress * Math.PI) * 0.12;
      } else if (this.fetchElapsed < FETCH_WINDUP + FETCH_FLIGHT + FETCH_CATCH) {
        const catchProgress = (this.fetchElapsed - FETCH_WINDUP - FETCH_FLIGHT) / FETCH_CATCH;
        const catchEase = catchProgress * catchProgress * (3 - 2 * catchProgress);
        this.ball.x = this.fetchFlightEndX + (this.pet.headX + this.pet.facing * 22 - this.fetchFlightEndX) * catchEase;
        this.ball.y = this.fetchFlightEndY + (this.pet.headY + 18 - this.fetchFlightEndY) * catchEase;
        this.ball.rotation = Math.PI * 6 + catchProgress * Math.PI * 2;
        desiredX = this.fetchCatchX;
        anticipation = 0.15 * (1 - catchProgress);
      } else {
        this.fetchActive = false;
        this.ball.visible = false;
        this.activeBehavior = 'idle';
      }
    }

    // Exact critically damped spring integration keeps pursuit responsive without frame-rate-dependent drift.
    const spring = this.activeBehavior === 'walk' || this.fetchActive ? 5.5 : 3.8;
    const displacement = this.pet.x - desiredX;
    const springVelocity = this.pet.velocityX + spring * displacement;
    const decay = Math.exp(-spring * deltaTime);
    this.pet.x = desiredX + (displacement + springVelocity * deltaTime) * decay;
    this.pet.velocityX = (this.pet.velocityX - spring * springVelocity * deltaTime) * decay;

    const moving = this.activeBehavior === 'walk' || this.fetchActive;
    const gaitTarget = moving ? Math.min(1, Math.abs(this.pet.velocityX) / 65) : 0;
    this.gaitBlend += (gaitTarget - this.gaitBlend) * (1 - Math.exp(-deltaTime * 6));
    this.gaitPhase += deltaTime * (3 + Math.min(1, Math.abs(this.pet.velocityX) / 90) * 8);
    const fetchProgress = (this.fetchElapsed - FETCH_WINDUP) / FETCH_FLIGHT;
    const hop = this.fetchActive && fetchProgress >= 0 && fetchProgress <= 1
      ? Math.sin(fetchProgress * Math.PI) * 13
      : 0;
    const idleBreath = Math.sin(this.elapsed * 2.1) * 1.1;
    this.pet.y = floorY - 58 + idleBreath - hop;

    // Calculate facing direction based on movement velocity or cursor offset
    let facingTarget = this.pet.facing;
    if (Math.abs(this.pet.velocityX) > 4) {
      facingTarget = Math.sign(this.pet.velocityX);
    } else {
      const cursorDelta = this.smoothedTarget.x - this.pet.x;
      if (Math.abs(cursorDelta) > 20) {
        facingTarget = Math.sign(cursorDelta);
      }
    }
    this.pet.facing += (facingTarget - this.pet.facing) * (1 - Math.exp(-deltaTime * 5));
    const leanTarget = Math.max(-0.14, Math.min(0.14, this.pet.velocityX * 0.0012 + anticipation * this.pet.facing));
    this.pet.bodyLean += (leanTarget - this.pet.bodyLean) * (1 - Math.exp(-deltaTime * 6));
    const wagSpeed = 5.5 + this.gaitBlend * 4;
    const tailTarget = Math.sin(this.elapsed * wagSpeed) * (0.18 + this.gaitBlend * 0.38)
      - this.pet.velocityX * this.pet.facing * 0.0012;
    this.tailAngle += (tailTarget - this.tailAngle) * (1 - Math.exp(-deltaTime * 10));
    const tailBaseTarget = ((this.pet.facing + 1) * Math.PI) / 2;
    this.tailBaseAngle += (tailBaseTarget - this.tailBaseAngle) * (1 - Math.exp(-deltaTime * 4));

    // Head tracking is a bounded offset from the torso anchor, not a full IK solve.
    // Clamping the aim response keeps the head attached while still showing intent.
    const aimX = this.fetchActive ? this.ball.x : this.smoothedTarget.x;
    const aimY = this.fetchActive ? this.ball.y : this.smoothedTarget.y;
    const dx = aimX - this.pet.x;
    const dy = aimY - (this.pet.y - 70);

    // Head target anchored relative to body center and facing direction
    const headTargetX = this.pet.x + (this.pet.facing * 24) + Math.max(-15, Math.min(15, dx * 0.08));
    const headTargetY = this.pet.y - 78 + Math.max(-8, Math.min(8, dy * 0.04)) - (anticipation * 18);

    const headFollow = 1 - Math.exp(-deltaTime * 9);
    this.pet.headX += (headTargetX - this.pet.headX) * headFollow;
    this.pet.headY += (headTargetY - this.pet.headY) * headFollow;
    this.pet.headAngle += (Math.max(-0.18, Math.min(0.18, (dx * 0.0015) - anticipation)) - this.pet.headAngle) * headFollow;

    if (!Number.isFinite(this.pet.x)) this.pet.x = centerX;
  }

  private draw() {
    const { ctx, canvas } = this;
    const { width, height } = canvas;
    if (width === 0 || height === 0) return;
    if (width !== this.backdropWidth || height !== this.backdropHeight) {
      this.backdropWidth = width;
      this.backdropHeight = height;
      this.backdropCanvas.width = width;
      this.backdropCanvas.height = height;
      this.drawBackdrop(width, height);
    }
    // Reuse the cached static scene; draw the pet layers in depth order so rear
    // legs sit behind the body and front legs/head remain in front.
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.backdropCanvas, 0, 0);
    this.drawGroundShadow(this.pet.x, height * 0.84);
    this.drawTail();
    this.drawLegs(false);
    this.drawBody();
    this.drawLegs(true);
    this.drawHead();
    if (this.ball.visible) this.drawBall();
    this.drawStatus();
  }

  private drawBackdrop(width: number, height: number) {
    const ctx = this.backdropCtx;
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#101b2d');
    background.addColorStop(1, '#18283a');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width * 0.5, height * 0.53, 12, width * 0.5, height * 0.53, width * 0.65);
    glow.addColorStop(0, 'rgba(93, 123, 145, 0.18)');
    glow.addColorStop(1, 'rgba(17, 29, 45, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 20; x < width; x += 40) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 20; y < height; y += 40) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  private drawGroundShadow(x: number, y: number) {
    const { ctx } = this;
    const lift = Math.max(0, this.canvas.height * 0.84 - this.pet.y - 58);
    const shadowScale = 1 - Math.min(0.28, lift * 0.018);
    ctx.save();
    ctx.fillStyle = 'rgba(4, 10, 18, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, 94 * shadowScale, 12 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawBody() {
    const { ctx, pet } = this;
    const breathing = Math.sin(this.elapsed * 2.15);
    const strideBounce = Math.abs(Math.sin(this.gaitPhase * 2)) * this.gaitBlend * 1.6;
    ctx.save();
    ctx.translate(pet.x, pet.y + breathing * 1.2 - strideBounce);
    ctx.rotate(pet.bodyLean + Math.sin(this.elapsed * 1.25) * 0.008);
    ctx.scale(1 + this.gaitBlend * 0.018, 1 - this.gaitBlend * 0.025 + breathing * 0.006);

    const coat = ctx.createLinearGradient(-70, -46, 50, 44);
    coat.addColorStop(0, '#dcae76');
    coat.addColorStop(0.58, '#bd8050');
    coat.addColorStop(1, '#875638');
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.ellipse(0, 0, 77 + breathing * 1.5, 44 + breathing, -0.04, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#efd2a4';
    ctx.beginPath();
    ctx.ellipse(16, 11, 43, 30 + breathing * 0.7, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 235, 198, 0.22)';
    ctx.beginPath();
    ctx.ellipse(-20, -18, 36, 12, -0.2, Math.PI, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawTail() {
    const { ctx, pet } = this;
    ctx.save();
    ctx.translate(pet.x - pet.facing * 44, pet.y + 7);
    ctx.rotate(this.tailBaseAngle + this.tailAngle);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#a66d43';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(17, -18, 34, -8);
    ctx.quadraticCurveTo(45, -3, 49, 8);
    ctx.stroke();
    ctx.strokeStyle = '#d7a36c';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(13, -4);
    ctx.quadraticCurveTo(27, -14, 38, -7);
    ctx.quadraticCurveTo(45, -3, 47, 7);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Legs are represented by hip, knee, and foot points in canvas coordinates.
   * The hip is the pet origin plus the pose's fixed hipX. The knee's X offset
   * is 0 for front legs or +/-4 for rear legs; its Y is 31px below the pet
   * origin, with up to 5px of cosine lift. The foot's X is the hip's X plus a
   * signed, sinusoidal stride (capped at 10px); its Y is 65px below the pet origin,
   * with up to 7px of lift. The shared gait phase plus per-leg phase offsets
   * drive these joint vectors, while gaitBlend scales stride and lift to zero
   * at rest. The knee is the quadratic curve's control point, shaping the leg
   * between hip and foot rather than being an independently drawn joint.
   */
  private drawLegs(front: boolean) {
    const { ctx, pet } = this;
    const strideLength = Math.min(10, Math.abs(pet.velocityX) * 0.1);
    const strideDirection = Math.sign(pet.velocityX) || pet.facing;

    for (const leg of LEG_POSES) {
      if (leg.front !== front) continue;
      const hipX = pet.x + leg.hipX;
      const hipY = pet.y + (leg.front ? 6 : 8);
      const legPhase = this.gaitPhase + leg.phase;
      // Stride moves the foot along X; positive cosine lifts knee and foot
      // during the swing. These offsets form the hip-to-knee-to-foot pose.
      const stride = Math.sin(legPhase) * strideLength * this.gaitBlend * strideDirection;
      const kneeX = hipX + (leg.front ? 0 : (leg.hipX < 0 ? -4 : 4));
      const kneeY = pet.y + 31 - Math.max(0, Math.cos(legPhase)) * 5 * this.gaitBlend;
      const footX = hipX + stride;
      const footY = pet.y + 65 - Math.max(0, Math.cos(legPhase)) * 7 * this.gaitBlend;

      ctx.lineCap = 'round';
      ctx.strokeStyle = leg.front ? '#c58e5c' : '#a97048';
      ctx.lineWidth = leg.front ? 19 : 16;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
      ctx.stroke();

      ctx.fillStyle = '#e7c390';
      ctx.beginPath();
      ctx.ellipse(footX + 4, footY + 1, 14, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(117, 74, 46, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(footX + 5, footY - 2);
      ctx.lineTo(footX + 5, footY + 4);
      ctx.stroke();
    }
  }

  private drawHead() {
    const { ctx, pet } = this;
    ctx.save();
    ctx.translate(pet.headX, pet.headY);
    ctx.rotate(pet.headAngle);

    const headCoat = ctx.createLinearGradient(-48, -49, 42, 44);
    headCoat.addColorStop(0, '#edc991');
    headCoat.addColorStop(0.55, '#d7a36d');
    headCoat.addColorStop(1, '#ad7349');

    // Ears
    ctx.fillStyle = '#8e5b3d';
    ctx.beginPath();
    ctx.ellipse(-35, -31, 19, 34, -0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(35, -31, 19, 34, 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ca8e67';
    ctx.beginPath();
    ctx.ellipse(-35, -29, 10, 23, -0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(35, -29, 10, 23, 0.48, 0, Math.PI * 2);
    ctx.fill();

    // Head Base
    ctx.fillStyle = headCoat;
    ctx.beginPath();
    ctx.ellipse(0, 0, 48, 45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes tracking cursor smoothly
    const aimX = this.fetchActive ? this.ball.x : this.smoothedTarget.x;
    const aimY = this.fetchActive ? this.ball.y : this.smoothedTarget.y;
    const gazeX = Math.max(-4, Math.min(4, (aimX - pet.headX) * 0.025));
    const gazeY = Math.max(-3, Math.min(3, (aimY - pet.headY) * 0.02));

    for (const side of [-1, 1]) {
      ctx.fillStyle = '#fff4df';
      ctx.beginPath();
      ctx.ellipse(side * 18, -9, 8, 10, side * -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b2a23';
      ctx.beginPath();
      ctx.ellipse(side * 18 + gazeX, -8 + gazeY, 4.3, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(side * 18 + gazeX - 1.2, -10 + gazeY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Snout & Nose
    ctx.fillStyle = '#f0d2a5';
    ctx.beginPath();
    ctx.ellipse(0, 18, 29, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#50352b';
    ctx.beginPath();
    ctx.ellipse(0, 8, 10, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#241d1b';
    ctx.beginPath();
    ctx.ellipse(0, 7, 6.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mouth
    ctx.strokeStyle = 'rgba(102, 63, 45, 0.72)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 14);
    ctx.lineTo(0, 25);
    ctx.quadraticCurveTo(-9, 31, -15, 25);
    ctx.moveTo(0, 25);
    ctx.quadraticCurveTo(9, 31, 15, 25);
    ctx.stroke();

    if (this.fetchActive && this.fetchElapsed > 1.0) {
      ctx.fillStyle = '#dc8a82';
      ctx.beginPath();
      ctx.ellipse(0, 30, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawBall() {
    const { ctx, ball } = this;
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rotation);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#fff0c2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(-2, 0, 7, -Math.PI * 0.7, Math.PI * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(2, 0, 7, Math.PI * 0.3, Math.PI * 1.7);
    ctx.stroke();
    ctx.restore();
  }

  private drawStatus() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.8)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(this.fetchActive ? 'FETCH!' : this.activeBehavior.toUpperCase(), 16, 23);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('FOLLOW THE CURSOR', 16, 39);
  }

  public destroy() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.canvas.removeEventListener('mousemove', this.onPointerMove);
    this.canvas.removeEventListener('mouseleave', this.onPointerLeave);
  }
}